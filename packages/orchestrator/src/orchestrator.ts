import fastify from "fastify";
import { Server } from "socket.io";
import { parseConfig, type ConfigInput } from "./config.js";
import { IdentityQueue } from "./IdentityQueue.js";
import { getShardingDetails } from "./sharder.js";
import { Logger } from "@discord-k8s/common";
import type { OrchestratorSocket } from "@discord-k8s/common";
import { createKubeConfig } from "./kube.js";
import { createFit, createSet } from "./modes/index.js";
import { chunkWorkerShards, createShardAssigner } from "./chunking.js";

const log = new Logger("Orchestrator");

export const startOrchestrator = async (configIn: ConfigInput | string) => {
  const config = parseConfig(configIn);

  const kube = await createKubeConfig(config.kube);

  log.info(`Using mode: ${config.workers.mode} for worker assignment`);
  const mode =
    config.workers.mode == "fit"
      ? createFit(config.workers, kube, config.kube.namespace)
      : createSet(config.workers, kube, config.kube.namespace);

  const { shardCount, maxConcurrency } = await getShardingDetails(config);
  const workerCount = await mode.getWorkerCount(shardCount);

  log.info(
    `Using chunking mode: ${config.workers.chunking} for shard assignment`,
  );
  const shardAssigner = createShardAssigner(
    config.workers.chunking,
    shardCount,
    workerCount,
  );
  const workerShards = chunkWorkerShards(
    shardAssigner,
    shardCount,
    workerCount,
  );

  log.debug(`Worker shard assignment: ${JSON.stringify(workerShards)}`);

  log.info(
    `Generated basic config :: workerCount=${workerCount}, shardCount=${shardCount}, maxConcurrency=${maxConcurrency}`,
  );

  const app = fastify({ logger: log.isLogLevel("debug") ? true : false });
  const io = new Server<
    OrchestratorSocket.ClientToServerEvents,
    OrchestratorSocket.ServerToClientEvents
  >(app.server);

  app.get("/health", (req, res) => {
    res.send({ healthy: true });
  });

  app.get("/workers", (req, res) => {
    res.send(workerShards);
  });

  const workers = io.of("/orchestrator/ws");
  const identityQueue = new IdentityQueue(
    maxConcurrency,
    config.sharding.identifyInterval,
    (shardId) => identifyShard(shardId),
  );

  const identifyShard = async (shardId: number) => {
    const workerId = shardAssigner(shardId);
    const worker = (
      await workers.to(`workers-${workerId}`).fetchSockets()
    )?.[0];
    if (!worker) {
      log.warn(
        `Attempted to identify shard ${shardId}, but no active worker was found for assigned worker ${workerId}`,
      );
      return false;
    }

    log.debug(
      `Directing identify request for shard ${shardId} to worker ${workerId}`,
    );

    return new Promise<boolean>((resolve, reject) => {
      worker.timeout(30e3).emit("identifyShard", shardId, (err) => {
        if (err) {
          return reject(err);
        }
        resolve(true);
      });
    });
  };

  workers.on("connection", (socket) => {
    log.debug(`Socket ${socket.id} connected to orchestrator namespace`);
    let workerId: number | null = null;

    socket.on("hello", async (requestedWorkerId, callback) => {
      if (workerId !== null) {
        return callback({
          shards: workerShards[workerId]!,
          totalShards: shardCount,
        });
      }

      if (!workerShards[requestedWorkerId]) {
        log.warn(
          `Rejecting socket ${socket.id} requesting worker ${requestedWorkerId}, worker does not exist`,
        );
        return callback("Worker does not exist");
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
      log.info(
        `Worker ${requestedWorkerId} has been assigned shards: ${workerShards[requestedWorkerId]}`,
      );
      callback({
        shards: workerShards[requestedWorkerId],
        totalShards: shardCount,
      });
    });

    socket.on("disconnect", () => {
      if (workerId !== null) {
        log.info(`Socket ${socket.id} disconnected as worker ${workerId}`);
      } else {
        log.debug(
          `Socket ${socket.id} disconnected before registering as a worker`,
        );
      }
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
