import { setTimeout } from "timers/promises";
import { Logger } from "@discord-k8s/common";

const log = new Logger("IdentityQueue");

export class IdentityQueue {
  public constructor(
    private readonly maxConcurrency: number,
    private readonly spawnInterval: number,
    /**
     * Inform the scheduler to let a shard continue to identify
     * @param shardId Shard that is ready to identify
     * @returns {Promise<boolean>} Where to wait the shard interval (e.g false if worker cannot be communicated with), resolves successfully after shard has logged in
     */
    private readonly identifyShard: (shardId: number) => Promise<boolean>,
  ) {}

  private buckets: Array<number[] | null> = [];

  register(id: number): void {
    const bucket = id % this.maxConcurrency;

    log.debug(`Registering shard ${id} for bucket #${bucket}`);

    let running = true;

    if (!this.buckets[bucket]) {
      log.debug(`Starting bucket #${bucket} from scratch for shard ${id}`);
      running = false;
      this.buckets[bucket] = [];
    }

    if (!this.buckets[bucket]?.includes(id)) {
      this.buckets[bucket]?.push(id);
    } else {
      log.debug(`Shard ${id} is already registered in bucket #${bucket}`);
    }

    this.buckets[bucket] = this.buckets[bucket]?.sort(
      (a, b) => a - b,
    ) as number[];

    if (!running) void this.loop(bucket);
  }

  async loop(bucket: number): Promise<void> {
    if (!this.buckets[bucket]) return;
    const next = this.buckets[bucket]?.shift();

    if (next === undefined) {
      this.buckets[bucket] = null;
      log.debug(`Reached end of bucket #${bucket}`);
      return;
    }

    log.info(`Allowing identify for shard ${next}`);

    const waiting = await this.identifyShard(next).catch((err) => {
      log.error(
        `Received unexpected error during shard ${next} startup: ${err}`,
      );
      return true;
    });

    log.info(
      `Identify sequence complete for shard ${next}. ${waiting ? `Waiting ${this.spawnInterval}ms for bucket ${bucket}` : `Skipping wait for bucket ${bucket}`}`,
    );

    if (waiting) await setTimeout(this.spawnInterval);

    return await this.loop(bucket);
  }
}
