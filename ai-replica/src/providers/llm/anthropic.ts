/**
 * Claude, via the official Anthropic SDK.
 *
 * Two things here are deliberate and worth keeping:
 *
 *  - **Prompt caching.** The persona corpus is large, identical on every
 *    request, and sits at the front of the prompt — the textbook case for
 *    caching. The system block is marked `cache_control: ephemeral`, which
 *    drops the cost of the cached prefix to roughly a tenth and cuts latency.
 *    `usage` is surfaced so you can confirm cache hits rather than assume them.
 *  - **Streaming.** Replies are spoken aloud, so the first word matters far
 *    more than the last. `stream()` yields text as it is generated.
 */
import Anthropic from "@anthropic-ai/sdk";

import type { Env } from "../../config/env.js";
import { ProviderUnavailableError, UpstreamError } from "../../core/errors.js";
import type { Logger } from "../../core/logger.js";
import type {
  ChatCompletion,
  ChatRequest,
  LLMProvider,
  TokenUsage,
} from "../types.js";

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function toUsage(usage: Anthropic.Usage | undefined): TokenUsage {
  if (!usage) return EMPTY_USAGE;
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** Translate SDK errors into our HTTP-shaped errors, most specific first. */
function translate(error: unknown): Error {
  if (error instanceof Anthropic.AuthenticationError) {
    return new UpstreamError("Anthropic", "the API key was rejected", 502);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new UpstreamError("Anthropic", "rate limited — try again shortly", 429);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new UpstreamError("Anthropic", error.message, 502);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new UpstreamError("Anthropic", "could not reach the API", 504);
  }
  if (error instanceof Anthropic.APIError) {
    return new UpstreamError("Anthropic", error.message, 502);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic | undefined;
  private readonly log: Logger;

  constructor(
    private readonly env: Env,
    logger: Logger,
  ) {
    this.log = logger.child({ component: "llm", provider: this.name });
    this.client = env.ANTHROPIC_API_KEY
      ? new Anthropic({
          apiKey: env.ANTHROPIC_API_KEY,
          timeout: env.CLAUDE_TIMEOUT_MS,
          maxRetries: 2,
        })
      : undefined;
  }

  get available(): boolean {
    return this.client !== undefined;
  }

  private requireClient(): Anthropic {
    if (!this.client) {
      throw new ProviderUnavailableError("Claude", "ANTHROPIC_API_KEY is not set");
    }
    return this.client;
  }

  /**
   * Shared request body. Building it in one place keeps the cached prefix —
   * model, system block, and their exact byte order — identical between the
   * streaming and non-streaming paths, so both hit the same cache entry.
   */
  private params(request: ChatRequest): Anthropic.MessageCreateParamsNonStreaming {
    return {
      model: this.env.CLAUDE_MODEL,
      max_tokens: this.env.CLAUDE_MAX_TOKENS,
      system: [
        {
          type: "text",
          text: request.system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: request.messages,
      output_config: { effort: this.env.CLAUDE_EFFORT },
      thinking: { type: "adaptive" },
    };
  }

  private finish(message: Anthropic.Message): ChatCompletion {
    const usage = toUsage(message.usage);
    this.log.debug(
      {
        model: message.model,
        stopReason: message.stop_reason,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        outputTokens: usage.outputTokens,
      },
      "claude reply complete",
    );

    if (message.stop_reason === "refusal") {
      throw new UpstreamError(
        "Anthropic",
        "the model declined to answer that request",
        422,
      );
    }

    return {
      text: textOf(message),
      usage,
      model: message.model,
      stopReason: message.stop_reason,
    };
  }

  async complete(request: ChatRequest): Promise<ChatCompletion> {
    const client = this.requireClient();
    try {
      const message = await client.messages.create(this.params(request), {
        signal: request.signal,
      });
      return this.finish(message);
    } catch (error) {
      throw translate(error);
    }
  }

  async *stream(request: ChatRequest): AsyncGenerator<string, ChatCompletion, void> {
    const client = this.requireClient();
    try {
      const stream = client.messages.stream(this.params(request), {
        signal: request.signal,
      });

      for await (const event of stream) {
        // Adaptive thinking also emits deltas; only visible text is forwarded.
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }

      return this.finish(await stream.finalMessage());
    } catch (error) {
      throw translate(error);
    }
  }
}
