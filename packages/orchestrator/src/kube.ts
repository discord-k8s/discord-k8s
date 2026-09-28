import type { Config, ReplicatedResource } from "./config.js";
import * as k8s from "@kubernetes/client-node";
import { Logger } from "./Logger.js";

const log = new Logger("Kube");

export const createKubeConfig = async (config: Config["kube"]) => {
  const kc = new k8s.KubeConfig();
  kc.setCurrentContext;
  if ("loadFromCluster" in config) {
    log.info("Initiating kubeconfig with loadFromCluster...");
    kc.loadFromCluster();
  } else if ("loadFromDefault" in config) {
    log.info("Initiating kubeconfig with loadFromDefault...");
    kc.loadFromDefault();
  } else if ("loadFromFile" in config) {
    log.info("Initiating kubeconfig with loadFromFile...");
    kc.loadFromFile(config.loadFromFile);
  }
  if (config.context) {
    kc.setCurrentContext(config.context);
  }

  log.info(
    `Configured Kubernetes :: context=${kc.getCurrentContext()}, user=${kc.getCurrentUser()?.name}, cluster=${kc.getCurrentCluster()?.name}`,
  );

  const client = kc.makeApiClient(k8s.CoreV1Api);

  try {
    await client.readNamespace({ name: config.namespace });
  } catch (err) {
    if (err instanceof k8s.ApiException) {
      try {
        log.error(
          `Couldn't connect to namespace ${config.namespace}, error = ` +
            JSON.parse(err.body).message,
        );
      } catch (_e) {}
    }
    throw err;
  }

  log.info(
    `Successfully connected to Kubernetes with namespace ${config.namespace}`,
  );

  return kc;
};

export const getReplicatedResourceScale = async (
  api: k8s.AppsV1Api,
  resource: ReplicatedResource,
  namespace: string,
) => {
  const request = { name: resource.name, namespace };

  switch (resource.kind) {
    case "statefulset":
      return await api.readNamespacedStatefulSetScale(request);
    case "deployment":
      return await api.readNamespacedDeploymentScale(request);
    case "replicaset":
      return await api.readNamespacedReplicaSetScale(request);
  }
};

export const setReplicatedResourceScale = async (
  api: k8s.AppsV1Api,
  resource: ReplicatedResource,
  namespace: string,
  replicas: number,
) => {
  const request = {
    name: resource.name,
    namespace,
    body: [
      {
        op: "replace",
        path: "/spec/replicas",
        value: replicas,
      },
    ],
  };

  const options = k8s.setHeaderOptions(
    "Content-Type",
    k8s.PatchStrategy.JsonPatch,
  );

  switch (resource.kind) {
    case "statefulset":
      return await api.patchNamespacedStatefulSetScale(request, options);
    case "deployment":
      return await api.patchNamespacedDeploymentScale(request, options);
    case "replicaset":
      return await api.patchNamespacedReplicaSetScale(request, options);
  }
};

export const replicatedResourceScaleOp = (
  api: k8s.AppsV1Api,
  resourceDef: ReplicatedResource,
) => {
  if (resourceDef.kind === "statefulset") {
    return {
      get: api.readNamespacedStatefulSetScale,
      patch: api.patchNamespacedStatefulSetScale,
    };
  } else if (resourceDef.kind == "deployment") {
    return {
      get: api.readNamespacedDeploymentScale,
      patch: api.patchNamespacedDeploymentScale,
    };
  } else if (resourceDef.kind == "replicaset") {
    return {
      get: api.readNamespacedReplicaSetScale,
      patch: api.patchNamespacedReplicaSetScale,
    };
  }
};
