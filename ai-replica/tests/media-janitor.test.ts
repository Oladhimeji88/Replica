import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MediaJanitor } from "../src/core/media-janitor.js";
import { testLogger } from "./helpers.js";

let directory: string | undefined;

afterEach(async () => {
  if (directory) await fsp.rm(directory, { recursive: true, force: true });
  directory = undefined;
});

async function writeClip(dir: string, name: string, ageMs: number): Promise<string> {
  const file = path.join(dir, name);
  await fsp.writeFile(file, "not really a video");
  const when = new Date(Date.now() - ageMs);
  await fsp.utimes(file, when, when);
  return file;
}

describe("media janitor", () => {
  it("deletes expired clips and keeps fresh ones", async () => {
    directory = await fsp.mkdtemp(path.join(tmpdir(), "ai-replica-media-"));
    await writeClip(directory, "old.mp4", 60 * 60 * 1000);
    await writeClip(directory, "new.mp4", 1000);

    const janitor = new MediaJanitor({
      directory,
      retentionMs: 10 * 60 * 1000,
      logger: testLogger(),
    });

    expect(await janitor.sweep()).toBe(1);
    expect(await fsp.readdir(directory)).toEqual(["new.mp4"]);
  });

  it("leaves non-video files alone", async () => {
    directory = await fsp.mkdtemp(path.join(tmpdir(), "ai-replica-media-"));
    await writeClip(directory, "old.mp4", 60 * 60 * 1000);
    await writeClip(directory, ".gitkeep", 60 * 60 * 1000);

    const janitor = new MediaJanitor({
      directory,
      retentionMs: 1000,
      logger: testLogger(),
    });
    await janitor.sweep();

    expect(await fsp.readdir(directory)).toEqual([".gitkeep"]);
  });

  it("does nothing when the directory is missing", async () => {
    const janitor = new MediaJanitor({
      directory: path.join(tmpdir(), "ai-replica-does-not-exist"),
      retentionMs: 1000,
      logger: testLogger(),
    });

    expect(await janitor.sweep()).toBe(0);
  });
});
