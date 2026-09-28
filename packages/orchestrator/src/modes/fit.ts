import { AppsV1Api, type KubeConfig } from "@kubernetes/client-node";
import {
  getReplicatedResourceScale,
  replicatedResourceScaleOp,
} from "../kube.js";
import type { Mode, ModeConfig, ModeCreator } from "./index.js";

export const createFit: ModeCreator = (config, kc) => {
  const apps = kc.makeApiClient(AppsV1Api);

  return {
    async getWorkerCount(shardCount) {
      if (typeof config.count == "number") return config.count;

      const scale = await getReplicatedResourceScale(
        apps,
        config.count.fromReplicas,
        k,
      );
      config.count.fromReplicas;
    },
    getWorkerShardChunks(config, shardCount, workerCount) {},
  };
};
