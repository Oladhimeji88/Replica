/**
 * Stream helpers.
 *
 * Vendor SDKs are inconsistent about what they hand back — some return a web
 * `ReadableStream`, some a Node `Readable`, some an `ArrayBuffer`. These
 * helpers normalise all of it to a `Buffer` so provider code stays readable.
 */
import { Readable } from "node:stream";

type AnyStream =
  | ReadableStream<Uint8Array>
  | Readable
  | AsyncIterable<Uint8Array>
  | ArrayBuffer
  | Uint8Array;

function isWebStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ReadableStream).getReader === "function"
  );
}

export async function collectStream(source: AnyStream): Promise<Buffer> {
  if (source instanceof ArrayBuffer) return Buffer.from(source);
  if (source instanceof Uint8Array) return Buffer.from(source);

  // `Readable.fromWeb` needs the exact web stream type; converting through the
  // async iterator instead works for both stream flavours and keeps types simple.
  const iterable = isWebStream(source)
    ? (Readable.fromWeb(source as Parameters<typeof Readable.fromWeb>[0]) as AsyncIterable<Uint8Array>)
    : (source as AsyncIterable<Uint8Array>);

  const chunks: Buffer[] = [];
  for await (const chunk of iterable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
