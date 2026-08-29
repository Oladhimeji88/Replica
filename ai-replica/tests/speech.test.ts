import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";

import { createTestApp } from "./helpers.js";

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe("POST /api/tts", () => {
  it("returns audio bytes for text", async () => {
    const harness = await createTestApp();
    cleanup = harness.cleanup;

    const response = await request(harness.app)
      .post("/api/tts")
      .send({ text: "say something" })
      // Without this superagent discards a binary body instead of buffering it.
      .responseType("blob")
      .expect(200)
      .expect("Content-Type", /audio\/mpeg/);

    expect(Buffer.from(response.body).toString()).toBe("audio:say something");
  });

  it("rejects empty text", async () => {
    const harness = await createTestApp();
    cleanup = harness.cleanup;

    await request(harness.app).post("/api/tts").send({ text: "   " }).expect(400);
  });

  it("reports 503 when no voice provider is configured", async () => {
    const harness = await createTestApp({ tts: null });
    cleanup = harness.cleanup;

    const response = await request(harness.app)
      .post("/api/tts")
      .send({ text: "hello" })
      .expect(503);

    expect(response.body.error.code).toBe("provider_unavailable");
  });
});

describe("POST /api/transcribe", () => {
  it("transcribes an uploaded clip", async () => {
    const harness = await createTestApp();
    cleanup = harness.cleanup;

    const response = await request(harness.app)
      .post("/api/transcribe")
      .attach("audio", Buffer.from("fake audio"), {
        filename: "clip.webm",
        contentType: "audio/webm",
      })
      .expect(200);

    expect(response.body.text).toBe("what do you think about testing");
  });

  it("rejects a non-audio upload", async () => {
    const harness = await createTestApp();
    cleanup = harness.cleanup;

    await request(harness.app)
      .post("/api/transcribe")
      .attach("audio", Buffer.from("MZ"), {
        filename: "payload.exe",
        contentType: "application/octet-stream",
      })
      .expect(400);
  });

  it("requires a file", async () => {
    const harness = await createTestApp();
    cleanup = harness.cleanup;

    await request(harness.app).post("/api/transcribe").expect(400);
  });

  it("reports 503 when transcription is left to the browser", async () => {
    const harness = await createTestApp({ stt: null });
    cleanup = harness.cleanup;

    await request(harness.app)
      .post("/api/transcribe")
      .attach("audio", Buffer.from("fake audio"), {
        filename: "clip.webm",
        contentType: "audio/webm",
      })
      .expect(503);
  });
});
