/**
 * Loads the persona corpus (`persona/*.md`, `*.txt`) into a single stable
 * string.
 *
 * Two properties matter here:
 *
 *  1. **Stability.** The corpus becomes the cached prefix of every Claude
 *     request, and prompt caching is a byte-for-byte prefix match. So the
 *     content is read once, sorted deterministically, and handed out from
 *     cache — never re-read per request, never stamped with a timestamp.
 *  2. **Freshness.** While you are writing your persona files you want edits
 *     to land without restarting the server, so the directory is watched and
 *     the cache invalidated on change (which intentionally busts the prompt
 *     cache — correct, since the prefix genuinely changed).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../core/logger.js";

const PERSONA_EXTENSIONS = new Set([".md", ".txt"]);
const WATCH_DEBOUNCE_MS = 250;

export interface PersonaFile {
  name: string;
  bytes: number;
}

export interface PersonaSnapshot {
  /** The concatenated corpus, ready to embed in a system prompt. */
  content: string;
  files: PersonaFile[];
  bytes: number;
  /** Short content hash — changes exactly when the prompt cache should miss. */
  hash: string;
  loadedAt: string;
}

export interface PersonaLoaderOptions {
  dir: string;
  watch: boolean;
  logger: Logger;
}

const EMPTY: PersonaSnapshot = {
  content: "",
  files: [],
  bytes: 0,
  hash: "empty",
  loadedAt: new Date(0).toISOString(),
};

export class PersonaLoader {
  private snapshot: PersonaSnapshot = EMPTY;
  private watcher: fs.FSWatcher | undefined;
  private debounce: NodeJS.Timeout | undefined;
  private readonly log: Logger;

  constructor(private readonly options: PersonaLoaderOptions) {
    this.log = options.logger.child({ component: "persona" });
  }

  /** Reads the corpus and, if requested, starts watching for edits. */
  async init(): Promise<PersonaSnapshot> {
    const snapshot = await this.reload();
    if (this.options.watch) this.startWatching();
    return snapshot;
  }

  /** The cached corpus. Cheap — safe to call on every request. */
  current(): PersonaSnapshot {
    return this.snapshot;
  }

  async reload(): Promise<PersonaSnapshot> {
    const dir = path.resolve(this.options.dir);

    let entries: string[];
    try {
      entries = await fsp.readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.log.warn(
          { dir },
          "persona directory does not exist — replying with no persona",
        );
        this.snapshot = EMPTY;
        return this.snapshot;
      }
      throw error;
    }

    // Sorted so the corpus — and therefore the cached prompt prefix — does not
    // depend on the order the filesystem happens to return entries in.
    const names = entries
      .filter((name) => PERSONA_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, "en"));

    const files: PersonaFile[] = [];
    const sections: string[] = [];

    for (const name of names) {
      const full = path.join(dir, name);
      const stat = await fsp.stat(full);
      if (!stat.isFile()) continue;

      const text = await fsp.readFile(full, "utf8");
      files.push({ name, bytes: Buffer.byteLength(text, "utf8") });
      sections.push(`--- ${name} ---\n${text.trim()}`);
    }

    const content = sections.join("\n\n");
    this.snapshot = {
      content,
      files,
      bytes: Buffer.byteLength(content, "utf8"),
      hash: createHash("sha256").update(content).digest("hex").slice(0, 12),
      loadedAt: new Date().toISOString(),
    };

    this.log.info(
      { files: files.length, bytes: this.snapshot.bytes, hash: this.snapshot.hash },
      "persona loaded",
    );
    return this.snapshot;
  }

  private startWatching(): void {
    const dir = path.resolve(this.options.dir);
    if (!fs.existsSync(dir)) return;

    try {
      this.watcher = fs.watch(dir, { persistent: false }, () => {
        // Editors write several times per save; collapse the burst.
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => {
          void this.reload().catch((error: unknown) => {
            this.log.error(
              { err: error },
              "persona reload failed — keeping previous copy",
            );
          });
        }, WATCH_DEBOUNCE_MS);
      });
      this.log.debug({ dir }, "watching persona directory for changes");
    } catch (error) {
      this.log.warn(
        { err: error },
        "could not watch persona directory — edits need a restart",
      );
    }
  }

  close(): void {
    clearTimeout(this.debounce);
    this.watcher?.close();
    this.watcher = undefined;
  }
}
