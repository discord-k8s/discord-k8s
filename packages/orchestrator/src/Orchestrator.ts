import { Namespace, Server, Socket } from "socket.io";
import { IdentityQueue } from "./IdentityQueue.js";
import type { OrchestratorSocket } from "@discord-k8s/types";

export class Orchestrator extends IdentityQueue {
  private workers: Namespace<
    OrchestratorSocket.ClientToServerEvents,
    OrchestratorSocket.ServerToClientEvents
  > = null!;

  public createServer(
    io: Server<
      OrchestratorSocket.ClientToServerEvents,
      OrchestratorSocket.ServerToClientEvents
    >,
  ) {
    const workers = io.of("/orchestrator/ws");
    this.workers = workers;

    workers.on("connection", (socket) => {
      let workerId: number | null = null;

      socket.on("hello", async (requestedWorkerId, callback) => {
        if (workerId !== null) {
          return callback({ shards: [1, 2, 3, 4] });
        }

        const existingSockets = await workers
          .in(`workers-${requestedWorkerId}`)
          .fetchSockets();

        if (existingSockets.length > 0) {
          console.log(
            `Rejecting socket ${socket.id} requesting worker ${requestedWorkerId}, worker already registered`,
          );
          return callback(
            "Socket already exists for worker " + requestedWorkerId,
          );
        }

        console.log(
          `Socket ${socket.id} connected as worker ${requestedWorkerId}`,
        );
        workerId = requestedWorkerId;
        socket.join(`workers-${requestedWorkerId}`);
        callback({ shards: [1, 2, 3, 4] });
      });

      socket.on("requestIdentify", (shardId) => {
        this.register(shardId);
      });
    });
  }

  async identifyShard(shardId: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.workers
        .to(`workers-0`)
        .timeout(30e3)
        .emit("identifyShard", shardId, (err) => {
          if (err) {
            return reject(err);
          }
          resolve(true);
        });
    });
  }
}
