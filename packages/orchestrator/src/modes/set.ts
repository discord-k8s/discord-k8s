import { AppsV1Api } from "@kubernetes/client-node";
import type { ModeCreator } from "./index.js";
import { setReplicatedResourceScale } from "../kube.js";
import { Logger } from "@discord-k8s/common";

const log = new Logger('Mode: set');

export const createSet: ModeCreator<'set'> = (config, kc, ns) => {
  const apps = kc.makeApiClient(AppsV1Api);

  return {
    async getWorkerCount(shardCount) {
      const workerCount = Math.ceil(shardCount / config.shardsPerWorker);

      log.info(`Setting replicas for ${config.kind}/${config.name} to ${workerCount}`)

      await setReplicatedResourceScale(apps, config, ns, workerCount);

      return workerCount;
    }
  }
}