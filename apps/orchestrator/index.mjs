import { startOrchestrator } from "@discord-k8s/orchestrator";

startOrchestrator(process.env.ORCHESTRATOR_CONFIG ?? "/config/config.yaml");
