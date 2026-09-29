import type { KubeConfig } from "@kubernetes/client-node";
import type { Config } from "../config.js";

export type ModeConfig = {
  [key in Config["workers"]["mode"]]: Config["workers"] & { mode: key };
};

export type ModeCreator<T extends keyof ModeConfig> = (
  config: ModeConfig[T],
  kc: KubeConfig,
  namespace: string
) => Mode;

export interface Mode {
  getWorkerCount: (shardCount: number) => Promise<number>;
}

export * from './fit.js'
export * from './set.js'