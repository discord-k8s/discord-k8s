# @discord-k8s/orchestrator

The main orchestrator for the [Discord-k8s Orchestrator](https://github.com/discord-k8s/discord-k8s)

This package is intended to be ran through the docker image at `ghcr.io/discord-k8s/orchestrator:latest`

However it can be ran through this package if preferred.

## Usage

```ts
import { startOrchestrator } from "@discord-k8s/orchestrator";

startOrchestrator("/path/to/config.yaml"); // standard config.yaml

// or run with typed object

startOrchestrator({
  workers: {
    mode: "set",
    name: "my-worker",
    shardsPerWorker: 5,
  },
});
```

> See more information about config options: [documentation](https://github.com/discord-k8s/discord-k8s#configuration) or [spec](https://github.com/discord-k8s/discord-k8s/blob/main/config.md)
