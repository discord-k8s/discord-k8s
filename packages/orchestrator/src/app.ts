import fastify from "fastify";
import { Orchestrator } from "./Orchestrator.js";
import { Server } from "socket.io";

const orchestrator = new Orchestrator(1, 5300);

const app = fastify();
const socket = new Server(app.server);

orchestrator.createServer(socket);

app.get("/hello", (req, res) => {
  res.send({ hello: true });
});

app
  .listen({
    port: 8080,
    host: "0.0.0.0",
  })
  .then(() => {
    console.log("Listening on :8080");
  });
