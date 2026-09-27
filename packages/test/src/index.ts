import { Orchestrator } from "@discord-k8s/worker";

const worker = new Orchestrator("localhost");

const data = await worker.openWorker(0);

worker.waitForIdentify(0).then((x) => console.log("identify 0"));
worker.waitForIdentify(1).then((x) => console.log("identify 1"));
worker.waitForIdentify(2).then((x) => console.log("identify 2"));
worker.waitForIdentify(3).then((x) => console.log("identify 3"));

console.log(data);
