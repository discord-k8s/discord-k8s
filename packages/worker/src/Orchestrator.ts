import { io, Socket } from "socket.io-client";
import { isWorkerDataEqual, Logger, type OrchestratorSocket, type WorkerData } from "@discord-k8s/common";
import { EventEmitter } from "@jpbberry/typed-emitter";

const log = new Logger('discord-k8s/worker')

export interface OrchestratorOptions {
  url: string
  /**
   * Worker ID for this orchestrator to manage
   */
  workerId: number
  /**
   * Event fired when the orchestrators shards don't line up with the current worker shards
   * Either implement reshard logic, or a simple process.exit(1)
   */
  onReshard: (data: WorkerData) => void
}

export class Orchestrator extends EventEmitter<{
  SHARD_IDENTIFY: number;
  OPEN: WorkerData;
  SHARDS_CHANGED: WorkerData;
  ERROR: string;
}> {
  private socket: Socket<
    OrchestratorSocket.ServerToClientEvents,
    OrchestratorSocket.ClientToServerEvents
  >;

  private workerData: WorkerData | null = null;

  private workerId: number

  constructor(private readonly options: OrchestratorOptions) {
    super();
    this.workerId = options.workerId;

    let orchestratorUrl = options.url;

    if (!orchestratorUrl.startsWith("ws")) {
      orchestratorUrl = "ws://" + orchestratorUrl;
    }
    const url = new URL(orchestratorUrl);
    if (!url.port) url.port = "8080";
    url.pathname = "/orchestrator/ws";

    this.socket = io(url.toString(), { autoConnect: false });
  }

  async open(): Promise<WorkerData> {
    this.socket.connect();

    this.workerData = await this.hello()

    this.setupListeners();
    this.emit("OPEN", this.workerData);

    return this.workerData;
  }

  async hello() {
    const ack = await this.socket.emitWithAck("hello", this.workerId);
    if (typeof ack === "string") {
      this.emit("ERROR", ack);
      console.error(ack);
      throw new Error(ack);
    }

    return ack
  }

  private setupListeners() {
    this.socket.on("identifyShard", (shardId, callback) => {
      this.emit("SHARD_IDENTIFY", shardId);
      const listener = this.identifyListeners.get(shardId);
      if (listener) {
        listener.resolve();
        this.identifyListeners.delete(shardId);
      }
      callback();
    });

    this.socket.on('connect', async () => {
      if (!this.workerData) return;

      log.warn(`Worker ${this.workerId} reconnected to orchestrator, could indicate a restart...`);
      const ack = await this.hello();
      this.emit("OPEN", ack);

      if (!isWorkerDataEqual(this.workerData, ack)) {
        log.warn(`Worker ${this.workerId} data changed during a orchestrator reopen, this should lead to a reshard (kill process?)`);
        this.emit("SHARDS_CHANGED", ack);
        this.options.onReshard(ack)
        this.workerData = ack;
        return
      }

      const inFlightIdentifes = this.identifyListeners.keys().toArray();
      if (inFlightIdentifes.length > 0) {

        log.info(`Worker ${this.workerId} has ${inFlightIdentifes.length} in-flight shard identifies, re-requesting them...`);
        for (const shardId of inFlightIdentifes) {
          this.requestIdentify(shardId);
        }
      }
    })
  }

  public requestIdentify(shardId: number) {
    this.socket.emit("requestIdentify", shardId);
  }

  private identifyListeners: Map<
    number,
    { resolve: () => void; reject: (reason?: any) => void }
  > = new Map();

  public async waitForIdentify(shardId: number) {
    const existingListener = this.identifyListeners.get(shardId);
    if (existingListener) {
      log.warn(
        `Erroring out previous identify listener for shard ${shardId} as it's been overtaken`,
      );
      existingListener.reject(
        `Another request for shard ${shardId} has taken precedence over this one`,
      );
    }
    return await new Promise<void>((resolve, reject) => {
      this.identifyListeners.set(shardId, { resolve, reject });
      this.requestIdentify(shardId);
    });
  }
}
