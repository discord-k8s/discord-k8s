import type { KubeConfig } from "@kubernetes/client-node";
import type { Config } from "../config.js";

export type ModeConfig = {
  [key in Config["workers"]["mode"]]: Config["workers"] & { mode: key };
};

export type ModeCreator<T extends keyof ModeConfig> = (
  config: Config & { workers: ModeConfig[T] },
  kc: KubeConfig,
) => Mode;

export interface Mode {
  getWorkerCount: (shardCount: number) => Promise<number>;
  getWorkerShardChunks: (
    shardCount: number,
    workerCount: number,
  ) => Promise<number[][]>;
}
