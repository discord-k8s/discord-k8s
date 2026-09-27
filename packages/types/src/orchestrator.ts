export namespace OrchestratorSocket {
  export interface ServerToClientEvents {
    identifyShard: (shardId: number, complete: () => void) => void;
  }

  export interface ClientToServerEvents {
    hello: (
      workerId: number,
      callback: (data: WorkerData | string) => void,
    ) => void;
    requestIdentify: (shardId: number) => void;
  }
}

export interface WorkerData {
  shards: number[];
}
