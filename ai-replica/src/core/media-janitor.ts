/**
 * Deletes generated talking-face clips once they are old enough.
 *
 * Without this the `public/generated` directory grows without bound — each
 * reply leaves an MP4 behind, and they are personal video of your face, so
 * keeping them around indefinitely is a privacy problem as much as a disk one.
 */
import fsp from "node:fs/promises";
import path from "node:path";

import type { Logger } from "./logger.js";

export interface MediaJanitorOptions {
  directory: string;
  retentionMs: number;
  /** How often to sweep. Defaults to a tenth of the retention window. */
  intervalMs?: number;
  logger: Logger;
}

export class MediaJanitor {
  private timer: NodeJS.Timeout | undefined;
  private readonly log: Logger;
  private readonly intervalMs: number;

  constructor(private readonly options: MediaJanitorOptions) {
    this.log = options.logger.child({ component: "media-janitor" });
    this.intervalMs =
      options.intervalMs ?? Math.max(60_000, Math.floor(options.retentionMs / 10));
  }

  start(): void {
    if (this.options.retentionMs <= 0) {
      this.log.debug("retention disabled — generated clips will be kept indefinitely");
      return;
    }

    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), this.intervalMs);
    // Never hold the event loop open just to run a cleanup pass.
    this.timer.unref();
    this.log.debug(
      { retentionMs: this.options.retentionMs, intervalMs: this.intervalMs },
      "media janitor started",
    );
  }

  async sweep(): Promise<number> {
    const cutoff = Date.now() - this.options.retentionMs;
    let removed = 0;

    let entries: string[];
    try {
      entries = await fsp.readdir(this.options.directory);
    } catch {
      return 0;
    }

    for (const name of entries) {
      if (path.extname(name).toLowerCase() !== ".mp4") continue;
      const full = path.join(this.options.directory, name);

      try {
        const stat = await fsp.stat(full);
        if (stat.mtimeMs >= cutoff) continue;
        await fsp.unlink(full);
        removed += 1;
      } catch (error) {
        this.log.debug({ err: error, file: name }, "could not remove generated clip");
      }
    }

    if (removed > 0) this.log.info({ removed }, "expired clips deleted");
    return removed;
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
