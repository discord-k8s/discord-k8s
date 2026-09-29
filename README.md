# discord-k8s

An attempt to make running high-scale Discord bots on Kubernetes easier

## Orchestrator

The orchestrator is a service that manages the coordination required to run a sharded Discord bot across multiple pods. It handles shard to worker assignment, identify rate limiting, in a framework-agnostic and straightforward way.

It attempts to handle the only tasks that require a centralized coordinator. Everything else is left to the worker pods, which allows for a restart-resilient and horizontally scalable architecture. It is specifically designed to allow for the restarting of itself and worker pods with minimal disruption to bot operations.

### Getting Started

First you'll need a Discord bot setup in some type of replicated resource. I generally use `StatefulSet`, but others like `Deployment` or `ReplicaSet` will work as well. This will be your worker nodes, acting as clusters of shards. The orchestrator can either listen to the replica count from this set, or it can also set the replica count for you automatically. For now create a set that has replicas 1 or your desired number of workers.

```yaml
kind: StatefulSet
apiVersion: apps/v1
metadata:
  name: censorbot-worker
  namespace: censorbot
spec:
  serviceName: "censorbot"
  replicas: 1 # The number of workers you want to run
  selector:
    matchLabels:
      app: censorbot-worker
  template:
    metadata:
      labels:
        app: censorbot-worker
    spec:
      containers:
        - name: worker
          image: # [your worker image]
          env:
            - name: WORKER_ID
              valueFrom: # up to you
                fieldRef:
                  fieldPath: metadata.labels['apps.kubernetes.io/pod-index']
          ...
```

Create a Kubernetes `Deployment` in the namespace you'll be running your bots. Referencing the official discord-k8s image, also configuring a `ConfigMap` with the [configuration](#Configuration) for the orchestrator. We'll use the name `censorbot` as an example Discord bot.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: censorbot-orchestrator
  namespace: censorbot
spec:
  replicas: 1 # The orchestrator must only be a single instance for state
  selector:
    matchLabels:
      app: censorbot-orchestrator
  template:
    metadata:
      labels:
        app: censorbot-orchestrator
    spec:
      containers:
        - name: orchestrator
          image: ghcr.io/discord-k8s/orchestrator:latest
          ports:
            - containerPort: 8080
          env:
            - name: BOT_TOKEN
              valueFrom:
                secretKeyRef:
                  name: censorbot-secrets
                  key: bot-token
          volumeMounts:
            - name: config
              # location can be changed with ORCHESTRATION_CONFIG env var. default is /config/config.yaml
              mountPath: /config
              readOnly: true
      volumes:
        - name: config
          configMap:
            name: censorbot-orchestrator-config
---
apiVersion: v1
kind: Service
metadata:
  name: censorbot-orchestrator
spec:
  type: ClusterIP
  selector:
    app: censorbot-orchestrator
  ports:
    - name: http
      port: 8080
      targetPort: 8080
      protocol: TCP
---
kind: ConfigMap
apiVersion: v1
metadata:
  name: censorbot-orchestrator-config
  namespace: censorbot
data:
  config.yaml: |
    workers:
      mode: set
      name: censorbot-worker
      shardsPerWorker: 5
```

> This basic configuration will pull your shard count from the Discord Gateway API, split them by the shardsPerWorker, and set the `replicas` key on `StatefulSet/censorbot-worker`. Look more into the [modes](#modes) before deciding to use the `set` mode. Also check the rest of the [configuration](#Configuration) options.

#### Inside the worker

Now in your worker code, install the `@discord-k8s/worker` package and use the `Orchestrator` class to connect to the orchestrator service. On this will be a bunch of utility functions that you should use to match with the orchestrator.

```ts
import { Orchestrator } from "@discord-k8s/worker";

const workerId = parseInt(process.env.WORKER_ID!);

const orchestrator = new Orchestrator({
  url: 'censorbot-orchestrator.censorbot.svc' // defaults to :8080 and ws://
  workerId,
  onReshard() { // required function. This will be called when there's been a change in the shard assignments, or counts, which will necesitate a full re-identify of the shards in this worker.
    process.exit(0) // the easiest option is just to exit the process and let Kubernetes restart it, which will re-run the worker with the new shard assignments. But more complicated logic can be implemented here if you want to handle the resharding without restarting the process.
  }
})

const workerData = await orchestrator.open() // returns the shard list and other data for this worker, can and will error (you should let it restart the process) if, for example a worker with this id is already running.

workerData.shards // list of shard ids assigned to this worker
workerData.totalShards // total number of shards for this bot (across all workers)
```

Check the docs for all the functions that make the Orchestrator a useful structure. Here's an example of a worker that uses the orchestrator with Discordeno. The `waitForIdentify()` function.

```ts
import { DiscordenoShard } from "@discordeno/gateway";

workerData.shards.forEach((shardId) => {
  const shard = new DiscordenoShard({
    /// ...
    id: shardId,
    connection: {
      totalShards: workerData.totalShards, // from the orchestrator
      // ...
    },
    async requestIdentify() {
      await orchestrator.waitForIdentify(shardId); // this will wait for the orchestrator to tell us that we can identify this shard, which will be rate limited by the orchestrator to avoid hitting Discord's identify rate limit.
    },
  });

  shard.identify(); // we do not need to wait for an identify to be allowed because it'll be handled by the requestIdentify instead, so just start the shard straight away
});
```

### Modes and chunking

There are two pre-built decision that should be picked between before letting the orchestrator choose how to schedule your pods.

#### Modes

Modes are the way that the orchestrator decides how to handle your scheduling of workers with it's shards. There are two modes, `set` and `fit`.

##### Mode: set

This mode will override the `replicas` key of your existing kubernetes resource (e.g a `StatefulSet`) to match the number of workers calculated by the orchestrator. It will be set as the number of workers required to fit the `shardsPerWorker` into the total shard count. For example:

```yaml
workers:
  mode: set
  shardsPerWorker: 5
  kind: StatefulSet
  name: censorbot-worker
```

This will take the number of shards for the bot (configured or automatic), and divide it by 5 (shardsPerWorker) to get the number of workers required. E.g 100 shards = 20 workers. It will then make a patch to `/scale` for the defined resource, with the new `replicas` value. When using this mode, the orchestrator will require the `[kind]/scale - [patch, get]` RBAC permissions.

This means that your worker pods can be scaled automatically when Discord changes the number of shards for your bot (if using the gateway), and is super convenient to just leave alone, while still giving you direct control over your deployment pattern.

##### Mode: fit

This mode will not change the number of replicas, and instead will take the shard count (configured or automatic) and divide it evenly among the number of workers. This can lead to large amounts of shards per worker as there would be no maximum shards, but a maximum number of workers.

There are two options here, either you can set the `count` field directly to let the orchestrator know how many workers you want.

```yaml
workers:
  mode: fit
  count: 5
```

Or you can define the `count` as an object with a dynamic puller, here's an example of `fromReplicas`.

```yaml
workers:
  mode: fit
  count:
    fromReplicas:
      kind: StatefulSet
      name: censorbot-worker
```

This will automatically pull the number of replicas from the defined resource, and use that as the number of workers. This allows you to manually (or another automatic process) to control the number of workers and the orchestrator will simply adapt.

By default the `fromReplicas` strategy will restart the orchestrator when the number of replicas changes, which will cause a reshard and re-identify of all shards. This is preferred behavior because simply starting a new worker after a replica change will cause all kinds of strange issue.

```yaml
workers:
  mode: fit
  count:
    fromReplicas:
      kind: StatefulSet
      name: censorbot-worker
      onChange: # set .onChange to false to disable the listening behavior
        action: restart
        interval: 10000
```

#### Chunking

Chunking allows you to change the behavior for individual shard placement among the workers. The default is `round-robin`

##### Chunking: round-robin

The default behavior, will assign shards to workers in a round-robin fashion via modulo. For example, if you have 3 workers and 9 shards, the assignment will be: `[[0, 3, 6], [1, 4, 7], [2, 5, 8]]`

This is preferred behavior as it will allow the order of shards that starts to be more evenly distributed across the workers. This is even more important if you have a `max_concurrency` other than 1, as it will be more evenly spread the identifes in the different concurrency buckets, which all spawn at the exact same time.

It will also evenly spread the last few shards among the last workers. E.g `[[0, 1, 2], [3, 4], [5, 6]]` instead of `[[0, 1, 2], [3, 4, 5], [6]]` which would be the case with sequential chunking.

##### Chunking: sequential

This is the more traditional chunking behavior. Simply dividing the shards into chunks that get continually filled up the entire way for each worker. It does a `floor(shardId / shardsPerWorker)`. For example, if you have 3 workers and 9 shards, the assignment will be `[[0, 1, 2], [3, 4, 5], [6, 7, 8]]`

This can leave uneven workers, especially if the number of shards is not divisible by the number of workers. But is convenient if you are clustering for the sake of network locality instead of performance.

### Configuration

A full config spec can be found in [config.md](./config.md).

Most string values can be filled in with environment variables by prefixing the value with a `$`. For example, `$BOT_TOKEN` will be replaced with the value of the `BOT_TOKEN` environment variable. This is useful for secrets and other values that you don't want to hardcode into your config.

Here's some quick documentation for specific config options that the spec might not fully describe well.

#### sharding

By default the orchestrator will pull the shard count from the Discord Gateway API. This is the preferred behavior, as it will automatically adapt to changes in the shard count for your bot. However, if you want to manually set the shard count, you can do so by setting the `shardCount` option in the `sharding` config.

This will override the automatic shard count and use the value you provide instead. A config option for `maxConcurrency` is also available. If this is passed then a token is not required and will not be used in the config, safely remove the env variable if preferred.

```yaml
sharding:
  shardCount: 10
  maxConcurrency: 2
```

Setting the `shardCount` directly will skip the gateway request entirely and also not set concurrency. Instead if you want to make the request but override a specific value, you can use the `override` option. E.g

```yaml
sharding:
  override: # (neither of these need to be defined if you only want to override one of them)
    shardCount: 10
    maxConcurrency: 2
```

You can also change your token variable if you want

```yaml
sharding:
  token: $DISCORD_TOKEN
```

#### port

By default the port will be pulled from the `PORT` environment variable. Which is defaulted to `8080` specifically in the `Dockerfile`. You can override this environment variable, or you can set the `port` option in the config. Also hostname, which defaults to `0.0.0.0` for all-access.

```yaml
port: 8081
hostname: "0.0.0.0"
```

#### namespace

By default the orchestrator will use the namespace that it is running in. This is pulled from the `/var/run/secrets/kubernetes.io/serviceaccount/namespace` file, or the `$NAMESPACE` environment variable if that file doesn't exist. You can override this by setting the `kube.namespace` option in the config, especially if not running directly in a Kubernetes pod.

```yaml
kube:
  namespace: censorbot
```
