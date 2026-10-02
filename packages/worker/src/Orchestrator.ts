import { io, Socket } from "socket.io-client";
import {
  isWorkerDataEqual,
  Logger,
  type LogLevel,
  type OrchestratorSocket,
  type WorkerData,
} from "@discord-k8s/common";
import { EventEmitter } from "@jpbberry/typed-emitter";

export interface OrchestratorOptions {
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
  logLevel: LogLevel;
}

export class Orchestrator extends EventEmitter<{
  SHARD_IDENTIFY: number;
  OPEN: WorkerData;
  SHARDS_CHANGED: WorkerData;
  ERROR: string;
}> {
  private log: Logger;

  private socket: Socket<
    OrchestratorSocket.ServerToClientEvents,
    OrchestratorSocket.ClientToServerEvents
  >;

  private workerData: WorkerData | null = null;

  private workerId: number;

  constructor(private readonly options: OrchestratorOptions) {
    super();

    this.workerId = options.workerId;

    this.log = new Logger("discord-k8s/worker:" + this.workerId);
    if (options.logLevel) {
      this.log.setLogLevel(options.logLevel);
    }

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

    this.workerData = await this.hello();

    this.setupListeners();
    this.emit("OPEN", this.workerData);

    return this.workerData;
  }

  async hello() {
    this.log.debug(`Sending hello to orchestrator...`);
    const ack = await this.socket.emitWithAck("hello", this.workerId);
    if (typeof ack === "string") {
      this.emit("ERROR", ack);
      this.log.error(ack);
      throw new Error(ack);
    }

    this.log.debug(
      `Received hello ack from orchestrator: ${JSON.stringify(ack)}`,
    );

    return ack;
  }

  private setupListeners() {
    this.socket.on("identifyShard", (shardId, callback) => {
      this.log.debug(
        `Received identifyShard for shard ${shardId} from orchestrator...`,
      );
      this.emit("SHARD_IDENTIFY", shardId);
      const listener = this.identifyListeners.get(shardId);
      if (listener) {
        this.log.debug(
          `Found identify listener for shard ${shardId}, resolving...`,
        );
        listener.resolve();
        this.identifyListeners.delete(shardId);
      } else {
        this.log.debug(
          `No identify listener found for shard ${shardId}, ignoring...`,
        );
      }
      callback();
    });

    this.socket.on("connect", async () => {
      if (!this.workerData) return;

      this.log.warn(
        `Worker ${this.workerId} reconnected to orchestrator, could indicate a restart...`,
      );
      const ack = await this.hello();
      this.emit("OPEN", ack);

      if (!isWorkerDataEqual(this.workerData, ack)) {
        this.log.warn(
          `Worker ${this.workerId} data changed during a orchestrator reopen, this should lead to a reshard (kill process?)`,
        );
        this.emit("SHARDS_CHANGED", ack);
        this.options.onReshard(ack);
        this.workerData = ack;
        return;
      }

      const inFlightIdentifes = this.identifyListeners.keys().toArray();
      if (inFlightIdentifes.length > 0) {
        this.log.info(
          `Worker ${this.workerId} has ${inFlightIdentifes.length} in-flight shard identifies, re-requesting them...`,
        );
        for (const shardId of inFlightIdentifes) {
          this.requestIdentify(shardId);
        }
      }
    });
  }

  public requestIdentify(shardId: number) {
    this.log.debug(
      `Sending identify request for shard ${shardId} from orchestrator...`,
    );
    this.socket.emit("requestIdentify", shardId);
  }

  private identifyListeners: Map<
    number,
    { resolve: () => void; reject: (reason?: any) => void }
  > = new Map();

  public async waitForIdentify(shardId: number) {
    const existingListener = this.identifyListeners.get(shardId);
    if (existingListener) {
      this.log.warn(
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
