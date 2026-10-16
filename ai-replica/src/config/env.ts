/**
 * Validated, typed application configuration.
 *
 * Every environment variable the app reads is declared here exactly once and
 * parsed at boot. If the environment is wrong the process refuses to start with
 * a readable report instead of failing later on the first request.
 */
import { z } from "zod";

/**
 * Env vars are always strings. `z.coerce.boolean()` is not usable here because
 * it treats any non-empty string (including "false") as `true`.
 */
const boolish = (defaultValue: boolean) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") return defaultValue;
      return ["1", "true", "yes", "on"].includes(value);
    });

/** A trimmed string, where an empty/whitespace-only var counts as "not set". */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" ? undefined : value));

const httpUrl = optionalString.refine(
  (value) => {
    if (value === undefined) return true;
    try {
      const { protocol } = new URL(value);
      return protocol === "http:" || protocol === "https:";
    } catch {
      return false;
    }
  },
  { message: "must be a valid http(s) URL" },
);

const port = z.coerce.number().int().min(1).max(65_535);
const positiveInt = z.coerce.number().int().positive();

const envSchema = z.object({
  // --- Runtime ------------------------------------------------------------
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: port.default(3000),
  HOST: z.string().trim().default("0.0.0.0"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
    .default("info"),
  /** Comma-separated allowlist. Empty means same-origin only (no CORS header). */
  CORS_ORIGINS: optionalString,
  TRUST_PROXY: boolish(false),

  // --- Language model -----------------------------------------------------
  ANTHROPIC_API_KEY: optionalString,
  CLAUDE_MODEL: z.string().trim().default("claude-opus-5"),
  CLAUDE_MAX_TOKENS: positiveInt.default(2048),
  /**
   * Conversational replies are read aloud, so they are short and latency
   * matters more than depth. `low` is the right default here; raise it if you
   * want the replica to reason harder before answering.
   */
  CLAUDE_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("low"),
  CLAUDE_TIMEOUT_MS: positiveInt.default(60_000),

  // --- Text to speech -----------------------------------------------------
  TTS_PROVIDER: z.enum(["elevenlabs", "edge", "none"]).default("edge"),
  ELEVENLABS_API_KEY: optionalString,
  ELEVENLABS_VOICE_ID: optionalString,
  ELEVENLABS_MODEL_ID: z.string().trim().default("eleven_turbo_v2_5"),
  EDGE_TTS_VOICE: z.string().trim().default("en-US-GuyNeural"),

  // --- Speech to text -----------------------------------------------------
  /** `none` leaves transcription to the browser's own SpeechRecognition API. */
  STT_PROVIDER: z.enum(["deepgram", "openai", "none"]).default("none"),
  DEEPGRAM_API_KEY: optionalString,
  DEEPGRAM_MODEL: z.string().trim().default("nova-3"),
  OPENAI_API_KEY: optionalString,
  OPENAI_STT_MODEL: z.string().trim().default("whisper-1"),
  /** Upper bound on an uploaded audio clip, in megabytes. */
  STT_MAX_UPLOAD_MB: positiveInt.default(20),

  // --- Talking-face avatar ------------------------------------------------
  AVATAR_PROVIDER: z.enum(["colab", "none"]).default("none"),
  COLAB_API_URL: httpUrl,
  AVATAR_TIMEOUT_MS: positiveInt.default(300_000),
  /** Generated clips are deleted after this long. 0 disables the janitor. */
  MEDIA_RETENTION_MS: z.coerce.number().int().min(0).default(3_600_000),

  // --- Persona ------------------------------------------------------------
  PERSONA_DIR: z.string().trim().default("persona"),
  /** Reload persona files when they change on disk, without a restart. */
  PERSONA_WATCH: boolish(true),

  // --- Abuse protection ---------------------------------------------------
  RATE_LIMIT_WINDOW_MS: positiveInt.default(60_000),
  RATE_LIMIT_MAX: positiveInt.default(30),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Cross-field rules: a provider is only selectable if its credentials are
 * present. These are checked at boot so a misconfigured deploy fails loudly.
 */
function checkProviderCredentials(env: Env): string[] {
  const problems: string[] = [];

  if (!env.ANTHROPIC_API_KEY && env.NODE_ENV !== "test") {
    problems.push(
      "ANTHROPIC_API_KEY is required — get one at https://console.anthropic.com/",
    );
  }
  if (env.TTS_PROVIDER === "elevenlabs") {
    if (!env.ELEVENLABS_API_KEY) {
      problems.push("TTS_PROVIDER=elevenlabs requires ELEVENLABS_API_KEY");
    }
    if (!env.ELEVENLABS_VOICE_ID) {
      problems.push(
        "TTS_PROVIDER=elevenlabs requires ELEVENLABS_VOICE_ID (the id of your cloned voice)",
      );
    }
  }
  if (env.STT_PROVIDER === "deepgram" && !env.DEEPGRAM_API_KEY) {
    problems.push("STT_PROVIDER=deepgram requires DEEPGRAM_API_KEY");
  }
  if (env.STT_PROVIDER === "openai" && !env.OPENAI_API_KEY) {
    problems.push("STT_PROVIDER=openai requires OPENAI_API_KEY");
  }
  if (env.AVATAR_PROVIDER === "colab" && !env.COLAB_API_URL) {
    problems.push(
      "AVATAR_PROVIDER=colab requires COLAB_API_URL (the ngrok URL your notebook prints)",
    );
  }

  return problems;
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new ConfigError(problems);
  }

  const problems = checkProviderCredentials(parsed.data);
  if (problems.length > 0) throw new ConfigError(problems);

  return parsed.data;
}

export function corsOrigins(env: Env): string[] {
  if (!env.CORS_ORIGINS) return [];
  return env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
