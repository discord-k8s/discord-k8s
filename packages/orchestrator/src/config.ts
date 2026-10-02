import z, { ZodString, type RefinementCtx } from "zod";
import fs from "fs";
import yaml from "yaml";
import { Logger } from "@discord-k8s/common";

const log = new Logger("Config");

const envVarTransform = (
  d: z.core.output<ZodString>,
  ctx: RefinementCtx<z.core.output<ZodString>>,
) => {
  if (!d.startsWith("$")) return d;
  const envVar = process.env[d.slice(1)];
  if (!envVar) {
    log.debug(`Missing environment variable ${d} for config property`);
    ctx.addIssue({
      code: "invalid_value",
      message: `Environment variable is not defined`,
      values: [d],
    });
    return z.NEVER;
  }
  log.debug(`Loaded environment variable ${d} for config property`);
  return envVar;
};

function withDeepDefaults<T extends z.ZodObject<any, any>>(schema: T) {
  return z.transform((input) => input ?? {}).pipe(schema);
}

function withDeepIntersectionDefaults<T extends z.ZodIntersection<any, any>>(
  schema: T,
) {
  return z.transform((input) => input ?? {}).pipe(schema);
}

const ReplicatedResource = z.object({
  kind: z
    .enum(["StatefulSet", "Deployment", "ReplicaSet"])
    .default("StatefulSet")
    .describe("The kind of replica-based resource"),
  name: z
    .string()
    .transform(envVarTransform)
    .describe("The name of the resource"),
});

export type ReplicatedResource = z.infer<typeof ReplicatedResource>;

const WorkersSpec = z
  .object({
    chunking: z
      .enum(["sequential", "round-robin"])
      .default("round-robin")
      .describe(
        "Strategy used to chunk shards among workers\n\n**sequential**: Fill up each worker and then move to the next. `worker = floor(shard / shardsPerWorker)` e.g `[[0, 1, 2], [3, 4, 5], [6, 7, 8]]`\n**round-robin**: Assign shards to workers evenly with interleave. `worker = shard % workerCount` e.g `[[0, 3, 6], [1, 4, 7], [2, 5, 8]]`",
      ),
  })
  .and(
    z.union([
      z.object({
        mode: z
          .literal("fit")
          .describe(
            "Evenly split the number of shards among the numbers of workers. This can lead to a high number of shards in each worker if workers are not properly managed",
          ),

        count: z
          .int()
          .or(
            z.object({
              fromReplicas: ReplicatedResource.extend({
                onChange: withDeepDefaults(
                  z
                    .object({
                      action: z
                        .enum(["none", "restart"])
                        .default("restart")
                        .describe(
                          "Action to do when a change is detected. Restart will restart the orchestrator process when a change is detected. This will likely cause a reshard of all workers, restarting them. But useful for quick rebalancing",
                        ),
                      interval: z
                        .number()
                        .default(10000)
                        .describe(
                          "Interval to check the replica count for changes",
                        ),
                    })
                    .describe(
                      "Listen to changes to the replica count and do specified action.",
                    ),
                ).or(z.literal(false)),
              }).describe(
                "Fetch the number of replicas to use from a static resource that already exists in kubernetes",
              ),
            }),
          )
          .describe(
            "Amount of workers to manager. Can be an object defining a dynamic worker count",
          ),
      }),
      ReplicatedResource.extend({
        mode: z
          .literal("set")
          .describe(
            "Calculate the number of workers based on the number of shards and set the replicas of a resource to that number.",
          ),
        shardsPerWorker: z
          .number()
          .default(5)
          .describe(
            "Baseline number of shards to assign to each worker, shards per worker will never go over this number",
          ),
      }),
    ]),
  );

const ShardingSpec = withDeepIntersectionDefaults(
  z
    .object({
      identifyInterval: z
        .number()
        .default(5300)
        .describe("The time to wait between each identify"),
    })
    .and(
      z.union([
        z.object({
          /**
           * Manual override for the shard count from gateway
           * If defined a gateway request won't be sent, and this value will be used instead.
           */
          shardCount: z
            .number()
            .describe(
              "Manual override for the shard count from gateway. If defined a gateway request won't be sent, and this value will be used instead.",
            ),
          maxConcurrency: z
            .number()
            .default(1)
            .describe("Manual override for the max concurrency from gateway"),
        }),
        z.object({
          token: z
            .string()
            .default("$BOT_TOKEN")
            .transform(envVarTransform)
            .describe(
              "Discord bot token to use for fetching gateway information",
            ),
          override: z
            .object({
              shardCount: z.number().optional(),
              maxConcurrency: z.number().optional(),
            })
            .optional(),
        }),
      ]),
    ),
);

const DiscordSpec = withDeepDefaults(
  z.object({
    baseUrl: z
      .string()
      .default("https://discord.com/api/v10")
      .transform(envVarTransform)
      .describe("Base API URL for Discord"),
  }),
);

const KubeSpec = withDeepIntersectionDefaults(
  z
    .object({
      namespace: z
        .string()
        .default(() => {
          try {
            return fs.readFileSync(
              "/var/run/secrets/kubernetes.io/serviceaccount/namespace",
              "utf-8",
            );
          } catch {
            return "$NAMESPACE";
          }
        })
        .transform(envVarTransform)
        .describe(
          "Namespace to do kube interactions in. Defaults to the content of serviceaccount/namespace file or $NAMESPACE",
        ),
      context: z.string().transform(envVarTransform).optional(),
    })
    .and(
      z.union([
        z.object({
          loadFromFile: z.string(),
        }),
        z.object({
          loadFromCluster: z.boolean(),
        }),
        z.object({
          loadFromDefault: z.boolean().default(true),
        }),
      ]),
    ),
);

export const ConfigSpec = z.object({
  workers: WorkersSpec,
  sharding: ShardingSpec,
  kube: KubeSpec,
  discord: DiscordSpec,
  port: z
    .number()
    .or(
      z.string().default("$PORT").transform(envVarTransform).transform(Number),
    ),
  hostname: z.string().default("0.0.0.0").transform(envVarTransform),
});

export type Config = z.infer<typeof ConfigSpec>;
export type ConfigInput = z.input<typeof ConfigSpec>;

export const parseConfig = (input: ConfigInput | string): Config => {
  if (typeof input === "string") {
    log.info(`Attempting to load config from file: ${input}`);
  }

  const config =
    typeof input === "string"
      ? yaml.parse(fs.readFileSync(input, "utf-8"))
      : input;

  const result = ConfigSpec.safeParse(config);

  if (!result.success) {
    log.error(z.prettifyError(result.error));
    throw result.error;
  }

  if (log.isLogLevel("debug")) {
    const clonedData = structuredClone(result.data);
    if ("token" in clonedData.sharding) {
      clonedData.sharding.token = "[REDACTED]";
    }
    log.debug(`Parsed config: ${JSON.stringify(clonedData)}`);
  }

  return result.data;
};

// echo 'require("fs").writeFileSync("./config-out.json", JSON.stringify(require("./packages/orchestrator/dist/config.js").parseConfig("./example-config.yml"), null, 4))' | PORT=8080 BOT_TOKEN=aaa NAMESPACE=abc node
