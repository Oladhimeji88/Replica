import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";

import { createTestApp } from "./helpers.js";

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

describe("operational endpoints", () => {
  it("reports liveness", async () => {
    const harness = await createTestApp();
    cleanup = harness.cleanup;

    const response = await request(harness.app).get("/health/live").expect(200);
    expect(response.body.status).toBe("ok");
  });

  it("reports readiness with per-provider detail", async () => {
    const harness = await createTestApp();
    cleanup = harness.cleanup;

    const response = await request(harness.app).get("/health/ready").expect(200);

    expect(response.body.status).toBe("ready");
    expect(response.body.providers.llm.available).toBe(true);
    expect(response.body.providers.tts.name).toBe("fake-tts");
  });

  it("advertises only the capabilities that are actually configured", async () => {
    const harness = await createTestApp({ tts: null, avatar: null });
    cleanup = harness.cleanup;

    const response = await request(harness.app).get("/api/capabilities").expect(200);

    expect(response.body.streaming).toBe(true);
    expect(response.body.tts).toBeNull();
    expect(response.body.avatar).toBeNull();
    expect(response.body.stt).toBe("fake-stt");
  });

  it("summarises the loaded persona without dumping all of it", async () => {
    const harness = await createTestApp();
    cleanup = harness.cleanup;

    const response = await request(harness.app).get("/api/persona/status").expect(200);

    expect(response.body.files).toHaveLength(1);
    expect(response.body.bytes).toBeGreaterThan(0);
    expect(response.body.preview.length).toBeLessThanOrEqual(300);
  });

  it("answers unknown routes with a structured 404", async () => {
    const harness = await createTestApp();
    cleanup = harness.cleanup;

    const response = await request(harness.app).get("/api/nope").expect(404);
    expect(response.body.error.code).toBe("not_found");
  });

  it("does not advertise the server implementation", async () => {
    const harness = await createTestApp();
    cleanup = harness.cleanup;

    const response = await request(harness.app).get("/health/live");
    expect(response.headers["x-powered-by"]).toBeUndefined();
  });
});
