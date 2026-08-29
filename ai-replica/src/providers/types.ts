/**
 * Provider contracts.
 *
 * Every external capability the app uses — language model, text-to-speech,
 * speech-to-text, talking-face rendering — is reached through one of these
 * interfaces. Routes depend on the interface, never on a vendor SDK, so
 * swapping ElevenLabs for another voice service (or adding D-ID alongside the
 * Colab renderer) is a new file in the relevant folder plus one line in
 * `registry.ts`.
 */

export interface ProviderInfo {
  /** Stable identifier, e.g. "elevenlabs". Shown in /health and logs. */
  readonly name: string;
  /** False when the provider is switched off or missing credentials. */
  readonly available: boolean;
}

// --- Language model --------------------------------------------------------

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from the prompt cache (~10% of input price). */
  cacheReadTokens: number;
  /** Tokens written to the prompt cache (~125% of input price). */
  cacheWriteTokens: number;
}

export interface ChatCompletion {
  text: string;
  usage: TokenUsage;
  model: string;
  stopReason: string | null;
}

export interface ChatRequest {
  messages: ChatMessage[];
  system: string;
  signal?: AbortSignal;
}

export interface LLMProvider extends ProviderInfo {
  complete(request: ChatRequest): Promise<ChatCompletion>;
  /** Yields text fragments as they are generated, then returns the total. */
  stream(request: ChatRequest): AsyncGenerator<string, ChatCompletion, void>;
}

// --- Text to speech --------------------------------------------------------

export interface SpeechAudio {
  audio: Buffer;
  contentType: string;
  /** File extension without the dot, e.g. "mp3". */
  extension: string;
}

export interface TTSProvider extends ProviderInfo {
  synthesize(text: string, signal?: AbortSignal): Promise<SpeechAudio>;
}

// --- Speech to text --------------------------------------------------------

export interface Transcription {
  text: string;
  /** Present when the provider reports it. */
  confidence?: number;
}

export interface STTProvider extends ProviderInfo {
  transcribe(
    audio: Buffer,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<Transcription>;
}

// --- Talking-face avatar ---------------------------------------------------

export interface RenderedVideo {
  /** Path served by this app, e.g. "/generated/abc.mp4". */
  videoUrl: string;
  bytes: number;
}

export interface AvatarProvider extends ProviderInfo {
  render(speech: SpeechAudio, signal?: AbortSignal): Promise<RenderedVideo>;
}
