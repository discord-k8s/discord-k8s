import fastify from "fastify";
import { Server } from "socket.io";
import { parseConfig, type ConfigInput } from "./config.js";
import { IdentityQueue } from "./IdentityQueue.js";
import type { OrchestratorSocket } from "@discord-k8s/types";
import { getShardingDetails } from "./sharder.js";
import { Logger } from "./Logger.js";
import { createKubeConfig } from "./kube.js";

const log = new Logger("Orchestrator");

export const startOrchestrator = async (configIn: ConfigInput | string) => {
  const config = parseConfig(configIn);

  const kube = createKubeConfig(config.kube);

  const gateway = await getShardingDetails(config);
  // const workerCount = await getWorkerCount(config, gateway.shardCount);

  log.info(
    `Generated basic config :: shardCount=${gateway.shardCount}, maxConcurrency=${gateway.maxConcurrency}`,
  );

  const app = fastify();
  const io = new Server<
    OrchestratorSocket.ClientToServerEvents,
    OrchestratorSocket.ServerToClientEvents
  >(app.server);

  app.get("/health", (req, res) => {
    res.send({ healthy: true });
  });

  const workers = io.of("/orchestrator/ws");
  const identityQueue = new IdentityQueue(
    gateway.maxConcurrency,
    config.sharding.identifyInterval,
    (shardId) => identifyShard(shardId),
  );

  const identifyShard = async (shardId: number) => {
    return new Promise<boolean>((resolve, reject) => {
      workers
        .to(`workers-0`)
        .timeout(30e3)
        .emit("identifyShard", shardId, (err) => {
          if (err) {
            return reject(err);
          }
          resolve(true);
        });
    });
  };

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
        log.warn(
          `Rejecting socket ${socket.id} requesting worker ${requestedWorkerId}, worker already registered`,
        );
        return callback(
          "Socket already exists for worker " + requestedWorkerId,
        );
      }

      log.info(`Socket ${socket.id} connected as worker ${requestedWorkerId}`);
      workerId = requestedWorkerId;
      socket.join(`workers-${requestedWorkerId}`);
      callback({ shards: [1, 2, 3, 4] });
    });

    socket.on("requestIdentify", (shardId) => {
      identityQueue.register(shardId);
    });
  });

  app
    .listen({
      port: config.port,
      host: config.hostname,
    })
    .then(() => {
      log.info(`Listening on ${config.hostname}:${config.port}`);
    });
};
