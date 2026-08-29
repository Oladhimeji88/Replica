/**
 * Shared test fixtures: a real app instance wired to fake providers, so route
 * behaviour can be tested without a network, an API key, or a bill.
 */
import fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { Express } from "express";

import { createApp } from "../src/app.js";
import { loadConfig, type Env } from "../src/config/env.js";
import { createLogger, type Logger } from "../src/core/logger.js";
import { PersonaLoader } from "../src/persona/loader.js";
import type { Services } from "../src/providers/registry.js";
import type {
  AvatarProvider,
  ChatCompletion,
  LLMProvider,
  RenderedVideo,
  SpeechAudio,
  STTProvider,
  TTSProvider,
} from "../src/providers/types.js";

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadConfig({ NODE_ENV: "test", ...overrides });
}

export function testLogger(): Logger {
  return createLogger({ NODE_ENV: "test", LOG_LEVEL: "silent" });
}

const USAGE = {
  inputTokens: 12,
  outputTokens: 7,
  cacheReadTokens: 900,
  cacheWriteTokens: 0,
};

export class FakeLLM implements LLMProvider {
  readonly name = "fake";
  readonly available = true;
  /** Every request this provider was asked to answer, for assertions. */
  readonly calls: { system: string; messageCount: number }[] = [];

  constructor(
    private readonly chunks: string[] = ["Hello ", "from ", "the replica."],
    private readonly failWith?: Error,
  ) {}

  private completion(): ChatCompletion {
    return {
      text: this.chunks.join(""),
      usage: USAGE,
      model: "fake-model",
      stopReason: "end_turn",
    };
  }

  complete(request: { system: string; messages: unknown[] }): Promise<ChatCompletion> {
    this.calls.push({ system: request.system, messageCount: request.messages.length });
    if (this.failWith) return Promise.reject(this.failWith);
    return Promise.resolve(this.completion());
  }

  // Nothing to await: this stands in for a network stream without being one.
  // eslint-disable-next-line @typescript-eslint/require-await
  async *stream(request: {
    system: string;
    messages: unknown[];
  }): AsyncGenerator<string, ChatCompletion, void> {
    this.calls.push({ system: request.system, messageCount: request.messages.length });
    if (this.failWith) throw this.failWith;
    for (const chunk of this.chunks) yield chunk;
    return this.completion();
  }
}

export class FakeTTS implements TTSProvider {
  readonly name = "fake-tts";
  constructor(readonly available = true) {}

  synthesize(text: string): Promise<SpeechAudio> {
    return Promise.resolve({
      audio: Buffer.from(`audio:${text}`),
      contentType: "audio/mpeg",
      extension: "mp3",
    });
  }
}

export class FakeSTT implements STTProvider {
  readonly name = "fake-stt";
  constructor(readonly available = true) {}

  transcribe(): Promise<{ text: string }> {
    return Promise.resolve({ text: "what do you think about testing" });
  }
}

export class FakeAvatar implements AvatarProvider {
  readonly name = "fake-avatar";
  constructor(
    readonly available = true,
    private readonly failWith?: Error,
  ) {}

  render(): Promise<RenderedVideo> {
    if (this.failWith) return Promise.reject(this.failWith);
    return Promise.resolve({ videoUrl: "/generated/fake.mp4", bytes: 1024 });
  }
}

/** Creates a persona directory on disk and returns a loader pointed at it. */
export async function createPersonaFixture(
  files: Record<string, string>,
): Promise<{ loader: PersonaLoader; dir: string; cleanup: () => Promise<void> }> {
  const dir = await fsp.mkdtemp(path.join(tmpdir(), "ai-replica-persona-"));
  for (const [name, content] of Object.entries(files)) {
    await fsp.writeFile(path.join(dir, name), content, "utf8");
  }

  const loader = new PersonaLoader({ dir, watch: false, logger: testLogger() });
  await loader.init();

  return {
    loader,
    dir,
    cleanup: async () => {
      loader.close();
      await fsp.rm(dir, { recursive: true, force: true });
    },
  };
}

export interface TestAppOptions {
  llm?: LLMProvider;
  tts?: TTSProvider | null;
  stt?: STTProvider | null;
  avatar?: AvatarProvider | null;
  env?: Record<string, string>;
}

export async function createTestApp(
  options: TestAppOptions = {},
): Promise<{ app: Express; services: Services; cleanup: () => Promise<void> }> {
  const fixture = await createPersonaFixture({
    "bio.md": "I am a test subject who enjoys deterministic outputs.",
  });

  const services: Services = {
    env: testEnv(options.env),
    logger: testLogger(),
    persona: fixture.loader,
    llm: options.llm ?? new FakeLLM(),
    tts: options.tts === undefined ? new FakeTTS() : options.tts,
    stt: options.stt === undefined ? new FakeSTT() : options.stt,
    avatar: options.avatar === undefined ? new FakeAvatar() : options.avatar,
  };

  return { app: createApp(services), services, cleanup: fixture.cleanup };
}

/** Parses an SSE response body into events, ignoring keep-alive comments. */
export function parseSSE(body: string): { event: string; data: unknown }[] {
  const frames: { event: string; data: unknown }[] = [];

  for (const block of body.split("\n\n")) {
    const raw = /^data: (.+)$/m.exec(block)?.[1];
    // Keep-alive frames are bare `: comment` lines carrying no data.
    if (!raw) continue;

    frames.push({
      event: /^event: (.+)$/m.exec(block)?.[1] ?? "message",
      data: JSON.parse(raw) as unknown,
    });
  }

  return frames;
}
