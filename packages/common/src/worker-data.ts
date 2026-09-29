export interface WorkerData {
  shards: number[];
  totalShards: number
}

export const isWorkerDataEqual = (a: WorkerData, b: WorkerData) => {
  return (
    a.totalShards === b.totalShards &&
    a.shards.length === b.shards.length &&
    a.shards.every((shardId, index) => shardId === b.shards[index])
  );
}
