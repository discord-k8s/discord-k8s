import { io, Socket } from "socket.io-client";
import type { OrchestratorSocket, WorkerData } from "@discord-k8s/types";
import { EventEmitter } from "@jpbberry/typed-emitter";

export class Orchestrator extends EventEmitter<{
  SHARD_IDENTIFY: number;
  OPEN: WorkerData;
  ERROR: string;
}> {
  private socket: Socket<
    OrchestratorSocket.ServerToClientEvents,
    OrchestratorSocket.ClientToServerEvents
  >;

  constructor(orchestratorUrl: string) {
    super();

    if (!orchestratorUrl.startsWith("ws")) {
      orchestratorUrl = "ws://" + orchestratorUrl;
    }
    const url = new URL(orchestratorUrl);
    if (!url.port) url.port = "8080";
    url.pathname = "/orchestrator/ws";

    this.socket = io(url.toString(), { autoConnect: false });
  }

  async openWorker(workerId: number): Promise<WorkerData> {
    this.socket.connect();

    const ack = await this.socket.emitWithAck("hello", workerId);
    if (typeof ack === "string") {
      this.emit("ERROR", ack);
      console.error(ack);
      throw new Error(ack);
    }

    this.setupListeners();
    this.emit("OPEN", ack);
    return ack;
  }

  private setupListeners() {
    this.socket.on("identifyShard", (shardId, callback) => {
      this.emit("SHARD_IDENTIFY", shardId);
      const listener = this.identifyListeners.get(shardId);
      if (listener) {
        listener.resolve();
      }
      callback();
    });
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
      console.warn(
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
