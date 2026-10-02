import { Logger } from "@discord-k8s/common";
import type { Config } from "./config.js";

const log = new Logger("Sharder");

export const getShardingDetails = async (
  config: Config,
): Promise<{ shardCount: number; maxConcurrency: number }> => {
  if (!("token" in config.sharding)) {
    return {
      shardCount: config.sharding.shardCount,
      maxConcurrency: config.sharding.maxConcurrency,
    };
  }

  const gatewayResponse = await fetch(`${config.discord.baseUrl}/gateway/bot`, {
    headers: {
      Authorization: `Bot ${config.sharding.token}`,
    },
  }).catch((err) => {
    throw new Error(
      `Failed to fetch gateway information while trying to fill sharding details`,
      { cause: err },
    );
  });

  if (!gatewayResponse.ok) {
    log.error(
      `Failed to fetch gateway information: ${gatewayResponse.status} ${gatewayResponse.statusText} ${await gatewayResponse.text()}`,
    );
    throw new Error(
      `Failed to fetch gateway information: ${gatewayResponse.status} ${gatewayResponse.statusText}`,
    );
  }

  const gatewayData = (await gatewayResponse.json()) as any;

  log.debug(
    `Fetched gateway information: ${JSON.stringify(gatewayData)} and overriding with config: ${JSON.stringify(config.sharding.override)}`,
  );

  return {
    shardCount: config.sharding.override?.shardCount ?? gatewayData.shards,
    maxConcurrency:
      config.sharding.override?.maxConcurrency ??
      gatewayData.session_start_limit?.max_concurrency,
  };
};
