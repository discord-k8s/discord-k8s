# @discord-k8s/worker

Worker utilities to interact with the [Discord-k8s Orchestrator](https://github.com/discord-k8s/discord-k8s).

Install via `npm i @discord-k8s/worker`

## Usage

Be sure to read the main orchestrator documentation [here](https://github.com/discord-k8s/discord-k8s#orchestrator) first.

Open a worker like so:

```js
import { Orchestrator } from '@discord-k8s/worker'

const orchestrator = new Orchestrator({
  url: 'orchestrator' // defaults to :8080 and ws://
  workerId // your process worker id,
  onReshard() {
    process.exit(0)
  }
})

const workerData = await orchestrator.open()
// Results in { shards: [x, x, x, x], totalShards: x }
```

Use this data to open shards from that shard array. E.g

```js
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

### Config

```ts
interface OrchestratorOptions {
  /**
   * Orchestrator WebSocket URL to connect with.
   *
   * If not provided, protocol will be set to ws:// and port set to :8080
   */
  url: string;
  /**
   * Worker ID for this orchestrator to manage
   */
  workerId: number;
  /**
   * Event fired when the orchestrators shards don't line up with the current worker shards
   * Either implement reshard logic, or a simple process.exit(1)
   */
  onReshard: (data: WorkerData) => void;
  /**
   * Logging level for all orchestrator processes.
   * @values One of: `debug`, `info`, `warn`, `error`
   */
  logLevel: LogLevel;
}
```

### Available functions

`waitForIdentify`: Sends a request for identify to the orchestrator, and returns a promise which only resolves once we get a response allowing the shard to identify

`requestIdentify`: Requests an identify (synchronously) for a specific shard. This will let the orchestrator know, to let us know, when the shard can identify. However, this will not wait for that, the orchestrator will send another event some other time letting us know.

### Events

`orchestrator.on('EVENT', (data) => {...})`

`SHARD_IDENTIFY` `(number) => {}`: Fired when we're told by the orchestrator to identify a shard (typically after a request)

`OPEN` `(workerData) => {}`: Fired when the orchestrator has allowed our request to open as a given worker ID. Can be called multiple times as connections go in and out.

`SHARDS_CHANGED` `(workerData) => {}`: Equivalent to onReshard(), letting us know that after a recent OPEN there was a meaningful change to the shards or shard count where it is pertinent that shards are disconnected and recreated (or process restarted).

`ERROR` `(message) => {}`: An error occured
