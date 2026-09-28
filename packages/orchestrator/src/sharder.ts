import type { Config } from "./config.js";

export const getShardingDetails = async (
  config: Config,
): Promise<{ shardCount: number; maxConcurrency: number }> => {
  if (!("token" in config.sharding)) {
    return {
      shardCount: config.sharding.shardCount,
      maxConcurrency: config.sharding.maxConcurrency,
    };
  }

  const gateway = { shardCount: 10, maxConcurrency: 1 }; // TODO: fetch from gateway
  return {
    shardCount: config.sharding.override?.shardCount ?? gateway.shardCount,
    maxConcurrency:
      config.sharding.override?.maxConcurrency ?? gateway.maxConcurrency,
  };
};

// export const getWorkerCount = async (
//   config: Config,
//   shardCount: number,
// ): Promise<number> => {
//   if (typeof config.workers.count === "number") {
//     return config.workers.count;
//   }

//   if ("fromReplicas" in config.workers.count) {
//     const res = await fetch(
//       `http://kubernetes.default.svc/apis/apps/v1/namespaces/${config.kube.namespace}/deployments/${config.workers.count.fromReplicas}`,
//       {
//         headers: {
//           Authorization: `Bearer ${process.env.KUBERNETES_SERVICE_ACCOUNT_TOKEN}`,
//         },
//       },
//     );

//     if (!res.ok) {
//       throw new Error(
//         `Failed to fetch resource ${config.workers.count.fromReplicas} from Kubernetes API: ${res.status} ${res.statusText}`,
//       );
//     }

//     const resource = (await res.json()) as { spec?: { replicas?: number } };
//     if (!resource?.spec?.replicas) {
//       throw new Error(
//         `Failed to fetch replicas from resource ${config.workers.count.fromReplicas}. Expected a Deployment or ReplicaSet`,
//       );
//     }

//     return resource.spec.replicas;
//   }

//   return Math.ceil(shardCount / config.workers.count.shardDenominator);
// };

export const createWorkerShards = (
  workerCount: number,
  shardCount: number,
) => {};
