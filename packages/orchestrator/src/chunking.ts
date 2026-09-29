export const createShardAssigner = (chunking: 'sequential' | 'round-robin', shardCount: number, workerCount: number) => {
  if (chunking === 'sequential') {
    const workersPerShard = Math.ceil(shardCount / workerCount);
    return (shardId: number) => Math.floor(shardId / workersPerShard);
  } else if (chunking === 'round-robin') {
    return (shardId: number) => shardId % workerCount;
  }
  throw new Error('Invalid chunking strategy');
}

export const chunkWorkerShards = (assigner: ReturnType<typeof createShardAssigner>, shardCount: number, workerCount: number): number[][] => {
  const chunks: number[][] = Array.from({ length: workerCount }, () => []);
  for (let i = 0; i < shardCount; i++) {
    chunks[assigner(i)]!.push(i);
  }
  return chunks;
}