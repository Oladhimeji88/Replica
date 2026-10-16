/**
 * Builds the concrete providers from configuration and hands the rest of the
 * app one container of interfaces.
 *
 * This is the only file that knows which vendor is in use. Adding a provider
 * means writing a class in the relevant folder and adding one `case` here.
 */
import { GENERATED_DIR } from "../config/paths.js";
import type { Env } from "../config/env.js";
import type { Logger } from "../core/logger.js";
import { ColabAvatar } from "./avatar/colab.js";
import { AnthropicProvider } from "./llm/anthropic.js";
import { DeepgramSTT } from "./stt/deepgram.js";
import { OpenAISTT } from "./stt/openai.js";
import { EdgeTTS } from "./tts/edge.js";
import { ElevenLabsTTS } from "./tts/elevenlabs.js";
import type { AvatarProvider, LLMProvider, STTProvider, TTSProvider } from "./types.js";

import type { PersonaLoader } from "../persona/loader.js";

export interface Services {
  env: Env;
  logger: Logger;
  persona: PersonaLoader;
  llm: LLMProvider;
  /** Null when `TTS_PROVIDER=none` — the browser speaks the reply instead. */
  tts: TTSProvider | null;
  /** Null when `STT_PROVIDER=none` — the browser transcribes the mic instead. */
  stt: STTProvider | null;
  /** Null when `AVATAR_PROVIDER=none` — replies stay text plus audio. */
  avatar: AvatarProvider | null;
}

function createTTS(env: Env, logger: Logger): TTSProvider | null {
  switch (env.TTS_PROVIDER) {
    case "elevenlabs":
      return new ElevenLabsTTS(env, logger);
    case "edge":
      return new EdgeTTS(env, logger);
    case "none":
      return null;
  }
}

function createSTT(env: Env, logger: Logger): STTProvider | null {
  switch (env.STT_PROVIDER) {
    case "deepgram":
      return new DeepgramSTT(env, logger);
    case "openai":
      return new OpenAISTT(env, logger);
    case "none":
      return null;
  }
}

function createAvatar(env: Env, logger: Logger): AvatarProvider | null {
  switch (env.AVATAR_PROVIDER) {
    case "colab":
      return new ColabAvatar(env, { outputDir: GENERATED_DIR }, logger);
    case "none":
      return null;
  }
}

export function createServices(
  env: Env,
  logger: Logger,
  persona: PersonaLoader,
): Services {
  const services: Services = {
    env,
    logger,
    persona,
    llm: new AnthropicProvider(env, logger),
    tts: createTTS(env, logger),
    stt: createSTT(env, logger),
    avatar: createAvatar(env, logger),
  };

  logger.info(
    {
      llm: services.llm.name,
      model: env.CLAUDE_MODEL,
      tts: services.tts?.name ?? "none",
      stt: services.stt?.name ?? "none",
      avatar: services.avatar?.name ?? "none",
    },
    "providers ready",
  );

  return services;
}
