import { describe, expect, it } from "vitest";

import { ConfigError, corsOrigins, loadConfig } from "../src/config/env.js";

describe("configuration", () => {
  it("applies documented defaults", () => {
    const env = loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv);

    expect(env.PORT).toBe(3000);
    expect(env.CLAUDE_MODEL).toBe("claude-opus-5");
    expect(env.CLAUDE_EFFORT).toBe("low");
    expect(env.TTS_PROVIDER).toBe("edge");
    expect(env.STT_PROVIDER).toBe("none");
    expect(env.AVATAR_PROVIDER).toBe("none");
  });

  it("requires an Anthropic key outside tests", () => {
    expect(() => loadConfig({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(
      ConfigError,
    );
  });

  it("rejects a provider whose credentials are missing", () => {
    const attempt = () =>
      loadConfig({
        NODE_ENV: "test",
        TTS_PROVIDER: "elevenlabs",
        ELEVENLABS_API_KEY: "key-only-no-voice",
      } as NodeJS.ProcessEnv);

    expect(attempt).toThrow(ConfigError);
    expect(attempt).toThrow(/ELEVENLABS_VOICE_ID/);
  });

  it("accepts a provider once every credential is present", () => {
    const env = loadConfig({
      NODE_ENV: "test",
      TTS_PROVIDER: "elevenlabs",
      ELEVENLABS_API_KEY: "key",
      ELEVENLABS_VOICE_ID: "voice",
    } as NodeJS.ProcessEnv);

    expect(env.TTS_PROVIDER).toBe("elevenlabs");
  });

  it("rejects a Colab URL that is not http(s)", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        AVATAR_PROVIDER: "colab",
        COLAB_API_URL: "not-a-url",
      } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError);
  });

  it("treats 'false' as false rather than as a non-empty string", () => {
    const env = loadConfig({
      NODE_ENV: "test",
      PERSONA_WATCH: "false",
      TRUST_PROXY: "true",
    } as NodeJS.ProcessEnv);

    expect(env.PERSONA_WATCH).toBe(false);
    expect(env.TRUST_PROXY).toBe(true);
  });

  it("rejects a port outside the valid range", () => {
    expect(() =>
      loadConfig({ NODE_ENV: "test", PORT: "70000" } as NodeJS.ProcessEnv),
    ).toThrow(ConfigError);
  });

  it("splits and trims the CORS allowlist", () => {
    const env = loadConfig({
      NODE_ENV: "test",
      CORS_ORIGINS: " https://a.example , https://b.example ",
    } as NodeJS.ProcessEnv);

    expect(corsOrigins(env)).toEqual(["https://a.example", "https://b.example"]);
  });

  it("reports an empty allowlist when none is configured", () => {
    expect(corsOrigins(loadConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv))).toEqual([]);
  });
});
