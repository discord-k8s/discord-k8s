import { startOrchestrator } from "./index.js";

startOrchestrator(process.env.ORCHESTRATOR_CONFIG ?? "/config/config.yaml");
