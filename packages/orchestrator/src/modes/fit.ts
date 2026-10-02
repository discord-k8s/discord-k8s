import { AppsV1Api, KubeConfig, Watch } from "@kubernetes/client-node";
import { getReplicatedResourceScale } from "../kube.js";
import type { ModeCreator } from "./index.js";
import { Logger } from "@discord-k8s/common";
import type { ReplicatedResource } from "../config.js";

const log = new Logger("Mode: fit");

export const createFit: ModeCreator<"fit"> = (config, kc, ns) => {
  const apps = kc.makeApiClient(AppsV1Api);

  return {
    async getWorkerCount() {
      if (typeof config.count == "number") return config.count;

      log.info(
        `Using replica count from ${config.count.fromReplicas.kind}/${config.count.fromReplicas.name}`,
      );

      const scale = await getReplicatedResourceScale(
        apps,
        config.count.fromReplicas,
        ns,
      );

      const replicas = scale.spec!.replicas!;

      log.debug(
        `Fetched replica count: ${replicas} from ${config.count.fromReplicas.kind}/${config.count.fromReplicas.name}`,
      );

      if (config.count.fromReplicas.onChange) {
        const onChange = config.count.fromReplicas.onChange;
        setupReplicaChangeListener({
          kc,
          resource: config.count.fromReplicas,
          namespace: ns,
          startingReplicaCount: replicas,
          interval: onChange.interval,
          action: () => {
            switch (onChange.action) {
              case "restart":
                log.warn(
                  `Replica count changed, exiting orchestrator to allow for resharding...`,
                );
                process.exit(0);
              case "none":
                break;
            }
          },
        });
      }

      return replicas;
    },
  };
};

interface ReplicaChangeListenerOptions {
  kc: KubeConfig;
  resource: ReplicatedResource;
  interval: number;
  namespace: string;
  startingReplicaCount: number;
  action: () => void;
}

const setupReplicaChangeListener = ({
  kc,
  resource,
  interval,
  namespace,
  startingReplicaCount,
  action,
}: ReplicaChangeListenerOptions) => {
  const apps = kc.makeApiClient(AppsV1Api);

  setInterval(async () => {
    const scale = await getReplicatedResourceScale(apps, resource, namespace);

    const replicas = scale.spec!.replicas!;

    if (replicas !== startingReplicaCount) {
      log.info(
        `Detected replica count change for ${resource.kind}/${resource.name} from ${startingReplicaCount} to ${replicas}...`,
      );
      action();
    } else {
      log.debug(
        `No replica count change detected for ${resource.kind}/${resource.name}, still at ${replicas}`,
      );
    }
  }, interval);

  log.info(
    `Listening for replica count changes for ${resource.kind}/${resource.name} every ${interval}ms...`,
  );
};
