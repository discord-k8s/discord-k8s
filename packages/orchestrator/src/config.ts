import z, { ZodString, type RefinementCtx } from "zod";
import fs from "fs";
import yaml from "yaml";
import { Logger } from "./Logger.js";

const envVarTransform = (
  d: z.core.output<ZodString>,
  ctx: RefinementCtx<z.core.output<ZodString>>,
) => {
  if (!d.startsWith("$")) return d;
  const envVar = process.env[d.slice(1)];
  if (!envVar) {
    ctx.addIssue({
      code: "invalid_value",
      message: `Environment variable is not defined`,
      values: [d],
    });
    return z.NEVER;
  }
  return envVar;
};

const ReplicatedResource = z.object({
  /**
   * The kind of replica-based resource, one of statefulset, deployment or replicaset
   * @default statefulset
   */
  kind: z
    .enum(["statefulset", "deployment", "replicaset"])
    .default("statefulset"),
  /**
   * The name of the resource
   */
  name: z.string().transform(envVarTransform),
});

export type ReplicatedResource = z.infer<typeof ReplicatedResource>;

const WorkersSpec = z.union([
  z.object({
    /**
     * **Mode: fit**
     * Evenly split the number of shards among the numbers of workers
     * This can lead to a high number of shards in each worker if workers are not properly managed
     */
    mode: z.literal("fit"),
    /**
     * Amount of workers to manager. Can be an object defining a dynamic worker count
     */
    count: z.int().or(
      z.object({
        /**
         * Fetch the number of replicas to use from a static resource that already exists in kubernetes
         */
        fromReplicas: ReplicatedResource,
      }),
    ),
  }),
  ReplicatedResource.extend({
    /**
     * **M
     */
    mode: z.literal("set"),
    shardsPerWorker: z.number().default(5),
  }),
]);

const ShardingSpec = z
  .object({
    /**
     * The time to wait between each identify
     * @default 5300
     */
    identifyInterval: z.number().default(5300),
  })
  .and(
    z.union([
      z.object({
        /**
         * Manual override for the shard count from gateway
         * If defined a gateway request won't be sent, and this value will be used instead.
         */
        shardCount: z.number(),
        /**
         * Manual override for the max concurrency from gateway
         */
        maxConcurrency: z.number().default(1),
      }),
      z.object({
        /**
         * Discord bot token to use for fetching gateway information.
         * Use $ to reference an environment variable.
         * @default $BOT_TOKEN
         */
        token: z.string().default("$BOT_TOKEN").transform(envVarTransform),
        override: z
          .object({
            shardCount: z.number().optional(),
            maxConcurrency: z.number().optional(),
          })
          .optional(),
      }),
    ]),
  )
  .prefault({} as { token: string | undefined });

const KubeSpec = z
  .object({
    /**
     * Namespace to fetch details from
     * @default Content of serviceaccount/namespace file or $NAMESPACE
     */
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
      .transform(envVarTransform),
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
  )
  .prefault({});

export const ConfigSpec = z.object({
  workers: WorkersSpec,
  sharding: ShardingSpec,
  kube: KubeSpec,
  port: z
    .number()
    .or(
      z.string().default("$PORT").transform(envVarTransform).transform(Number),
    ),
  hostname: z.string().default("0.0.0.0").transform(envVarTransform),
});

export type Config = z.infer<typeof ConfigSpec>;
export type ConfigInput = z.input<typeof ConfigSpec>;

const log = new Logger("Config");

export const parseConfig = (input: ConfigInput | string): Config => {
  const config =
    typeof input === "string"
      ? yaml.parse(fs.readFileSync(input, "utf-8"))
      : input;

  const result = ConfigSpec.safeParse(config);

  if (!result.success) {
    log.error(z.prettifyError(result.error));
    throw result.error;
  }

  console.log(JSON.stringify(result.data));

  return result.data;
};
