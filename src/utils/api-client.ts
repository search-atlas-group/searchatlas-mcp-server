/**
 * API client — generic JSON requests + SSE stream collector.
 * Mirrors the fetch patterns in lib/general-agent-api.ts and lib/streaming-utils.ts.
 */

import type { Config } from "../config.js";
import type { SSEChunk } from "../types/api.js";
import { getAuthHeaders } from "./auth.js";
import { ApiError, AuthError } from "./errors.js";
import { createSessionId, getUserId } from "./session.js";

// ─── Concurrency limiter (semaphore) ─────────────────────────────────────────

/** Maximum concurrent in-flight API/SSE requests per process. */
const MAX_CONCURRENT_REQUESTS = 5;

/**
 * Semaphore-based concurrency limiter. Uses an acquire/release pattern
 * so the count is always consistent — no non-atomic read-then-write race.
 */
class Semaphore {
  private _available: number;
  private readonly _queue: Array<() => void> = [];

  constructor(permits: number) {
    this._available = permits;
  }

  async acquire(): Promise<void> {
    if (this._available > 0) {
      this._available--;
      return;
    }
    await new Promise<void>((resolve) => this._queue.push(resolve));
  }

  release(): void {
    const next = this._queue.shift();
    if (next) {
      // Hand the permit directly to the next waiter (no increment needed)
      next();
    } else {
      this._available++;
    }
  }
}

const _semaphore = new Semaphore(MAX_CONCURRENT_REQUESTS);

async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  await _semaphore.acquire();
  try {
    return await fn();
  } finally {
    _semaphore.release();
  }
}

/** Default request timeout: 30 seconds. */
const REQUEST_TIMEOUT_MS = 30_000;

/** SSE stream idle timeout: 5 minutes. */
const SSE_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Maximum SSE response buffer size: 10 MB. */
const MAX_SSE_BUFFER_BYTES = 10 * 1024 * 1024;

/** Maximum number of SSE messages per stream (prevents flood of tiny messages). */
const MAX_SSE_MESSAGES = 50_000;

/** Maximum error body length forwarded to MCP clients. */
const MAX_ERROR_BODY_LENGTH = 500;

/**
 * Truncate and sanitize an error response body before forwarding to MCP clients.
 * Strips stack traces, internal paths, and sensitive details that may leak from
 * backend debug/error pages. Returns a generic message if nothing useful remains.
 */
function sanitizeErrorBody(text: string): string {
  if (!text) return text;
  let cleaned = text;
  // Strip Python tracebacks
  cleaned = cleaned.replace(/Traceback \(most recent call last\)[\s\S]*/i, "[internal error]");
  // Strip Node/JS stack frames
  cleaned = cleaned.replace(/at [\w./<>]+ \([\w/.:-]+\)/g, "");
  // Strip Java-style stack traces
  cleaned = cleaned.replace(/^\s*at\s+[\w$.]+\([\w.:]+\)\s*$/gm, "");
  // Strip file paths (Unix + Windows)
  cleaned = cleaned.replace(/(?:\/[\w.\-]+){2,}/g, "[path]");
  cleaned = cleaned.replace(/[A-Z]:\\[\w.\-\\]+/g, "[path]");
  // Strip IP addresses
  cleaned = cleaned.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?\b/g, "[addr]");
  // Strip environment variable values that may leak
  cleaned = cleaned.replace(/(?:password|secret|token|key|auth)\s*[:=]\s*\S+/gi, "[redacted]");
  // Collapse excessive whitespace from removals
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  if (cleaned.length > MAX_ERROR_BODY_LENGTH) {
    cleaned = cleaned.slice(0, MAX_ERROR_BODY_LENGTH) + "… [truncated]";
  }
  // If stripping left nothing useful, return a generic message
  if (!cleaned || cleaned.length < 5) {
    return "An internal error occurred.";
  }
  return cleaned;
}

// ─── JSON requests ──────────────────────────────────────────────────────────

export async function apiRequest<T>(
  config: Config,
  path: string,
  options: { method?: string; body?: unknown; params?: Record<string, string> } = {}
): Promise<T> {
  return withConcurrencyLimit(() => _apiRequest(config, path, options));
}

async function _apiRequest<T>(
  config: Config,
  path: string,
  options: { method?: string; body?: unknown; params?: Record<string, string> } = {}
): Promise<T> {
  const url = new URL(`${config.apiUrl}${path}`);
  if (options.params) {
    for (const [k, v] of Object.entries(options.params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers: getAuthHeaders(config),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
  });

  if (res.status === 401 || res.status === 403) {
    throw new AuthError();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(
      sanitizeErrorBody(text) || `${res.status} ${res.statusText}`,
      res.status,
      res.statusText
    );
  }

  // Handle 204 No Content
  if (res.status === 204) return undefined as T;

  return (await res.json()) as T;
}

// ─── SSE stream collector ───────────────────────────────────────────────────

/**
 * Sends a message to an agent endpoint via SSE and collects the full response.
 * SSE parsing mirrors frontend/lib/streaming-utils.ts:43-86.
 */
export async function streamAgentMessage(
  config: Config,
  endpoint: string,
  body: Record<string, unknown>
): Promise<string> {
  return withConcurrencyLimit(() => _streamAgentMessage(config, endpoint, body));
}

async function _streamAgentMessage(
  config: Config,
  endpoint: string,
  body: Record<string, unknown>
): Promise<string> {
  const url = `${config.apiUrl}${endpoint}`;

  const res = await fetch(url, {
    method: "POST",
    headers: getAuthHeaders(config),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      ...body,
      stream: true,
      session_id: body.session_id ?? createSessionId(),
      user_id: body.user_id ?? getUserId(config),
    }),
  });

  if (res.status === 401 || res.status === 403) {
    throw new AuthError();
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(
      sanitizeErrorBody(text) || `${res.status} ${res.statusText}`,
      res.status,
      res.statusText
    );
  }

  if (!res.body) {
    throw new ApiError("Response body is empty", 500);
  }

  return collectSSEStream(res.body);
}

/** Read an SSE ReadableStream and return the concatenated content. */
async function collectSSEStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bufferBytes = 0;
  let result = "";
  let resultBytes = 0;
  let messageCount = 0;
  let lastChunkTime = Date.now();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Cancel the reader and clean up resources before throwing or returning. */
  async function cleanup(): Promise<void> {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    try {
      await reader.cancel();
    } catch { /* best effort */ }
    reader.releaseLock();
  }

  try {
    while (true) {
      const elapsed = Date.now() - lastChunkTime;
      if (elapsed > SSE_IDLE_TIMEOUT_MS) {
        throw new ApiError(
          `SSE stream idle timeout (${SSE_IDLE_TIMEOUT_MS / 1000}s without data)`,
          504
        );
      }

      // Create a timeout that we can cancel when data arrives
      const timeoutMs = SSE_IDLE_TIMEOUT_MS - elapsed;
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          idleTimer = setTimeout(
            () => reject(new ApiError(`SSE stream idle timeout (${SSE_IDLE_TIMEOUT_MS / 1000}s without data)`, 504)),
            timeoutMs
          );
        }),
      ]);

      // Data received — clear the idle timer
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }

      if (done) break;

      lastChunkTime = Date.now();

      const decoded = decoder.decode(value, { stream: true });
      buffer += decoded;
      bufferBytes += Buffer.byteLength(decoded, "utf-8");

      // Guard the pre-parse buffer against unbounded growth (no \n\n delimiter)
      if (bufferBytes > MAX_SSE_BUFFER_BYTES) {
        throw new ApiError(
          `SSE pre-parse buffer exceeded maximum size (${MAX_SSE_BUFFER_BYTES / 1024 / 1024}MB)`,
          500
        );
      }

      // Process complete SSE messages iteratively (avoids split() array explosion on malicious streams)
      let delimIdx: number;
      while ((delimIdx = buffer.indexOf("\n\n")) !== -1) {
        const msg = buffer.slice(0, delimIdx);
        buffer = buffer.slice(delimIdx + 2);
        bufferBytes = Buffer.byteLength(buffer, "utf-8");

        const chunk = parseSSEChunk(msg);
        if (!chunk) continue;

        messageCount++;
        if (messageCount > MAX_SSE_MESSAGES) {
          throw new ApiError(
            `SSE stream exceeded maximum message count (${MAX_SSE_MESSAGES})`,
            500
          );
        }

        if (chunk.error) {
          throw new ApiError(sanitizeErrorBody(chunk.error), 500);
        }

        if (typeof chunk.content === "string") {
          const chunkBytes = Buffer.byteLength(chunk.content, "utf-8");
          if (resultBytes + chunkBytes > MAX_SSE_BUFFER_BYTES) {
            throw new ApiError(
              `Response exceeded maximum size (${MAX_SSE_BUFFER_BYTES / 1024 / 1024}MB)`,
              500
            );
          }
          result += chunk.content;
          resultBytes += chunkBytes;
        }

        if (chunk.is_complete) {
          await cleanup();
          return result;
        }
      }
    }
  } catch (err) {
    await cleanup();
    throw err;
  }

  await cleanup();
  return result;
}

function parseSSEChunk(line: string): SSEChunk | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data: ")) return null;

  try {
    return JSON.parse(trimmed.slice(6)) as SSEChunk;
  } catch {
    return null;
  }
}
