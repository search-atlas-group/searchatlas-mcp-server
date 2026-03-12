/**
 * API client — generic JSON requests + SSE stream collector.
 * Mirrors the fetch patterns in lib/general-agent-api.ts and lib/streaming-utils.ts.
 */

import type { Config } from "../config.js";
import type { SSEChunk } from "../types/api.js";
import { getAuthHeaders } from "./auth.js";
import { ApiError, AuthError } from "./errors.js";
import { createSessionId, getUserId } from "./session.js";

// ─── Concurrency limiter ─────────────────────────────────────────────────────

/** Maximum concurrent in-flight API/SSE requests per process. */
const MAX_CONCURRENT_REQUESTS = 5;

let _inFlight = 0;
const _queue: Array<() => void> = [];

async function withConcurrencyLimit<T>(fn: () => Promise<T>): Promise<T> {
  if (_inFlight >= MAX_CONCURRENT_REQUESTS) {
    await new Promise<void>((resolve) => _queue.push(resolve));
  }
  _inFlight++;
  try {
    return await fn();
  } finally {
    _inFlight--;
    const next = _queue.shift();
    if (next) next();
  }
}

/** Default request timeout: 30 seconds. */
const REQUEST_TIMEOUT_MS = 30_000;

/** SSE stream idle timeout: 5 minutes. */
const SSE_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Maximum SSE response buffer size: 10 MB. */
const MAX_SSE_BUFFER_BYTES = 10 * 1024 * 1024;

/** Maximum error body length forwarded to MCP clients. */
const MAX_ERROR_BODY_LENGTH = 500;

/**
 * Truncate and sanitize an error response body before forwarding to MCP clients.
 * Strips stack traces and internal details that may leak from backend debug pages.
 */
function sanitizeErrorBody(text: string): string {
  if (!text) return text;
  // Strip common stack trace patterns
  let cleaned = text.replace(/Traceback \(most recent call last\)[\s\S]*/i, "[stack trace removed]");
  cleaned = cleaned.replace(/at [\w./<>]+ \([\w/.:-]+\)/g, "[frame]");
  if (cleaned.length > MAX_ERROR_BODY_LENGTH) {
    cleaned = cleaned.slice(0, MAX_ERROR_BODY_LENGTH) + "… [truncated]";
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
  let lastChunkTime = Date.now();

  try {
    while (true) {
      // Enforce idle timeout — abort if no data received within the limit
      const elapsed = Date.now() - lastChunkTime;
      if (elapsed > SSE_IDLE_TIMEOUT_MS) {
        throw new ApiError(
          `SSE stream idle timeout (${SSE_IDLE_TIMEOUT_MS / 1000}s without data)`,
          504
        );
      }

      const { done, value } = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new ApiError(`SSE stream idle timeout (${SSE_IDLE_TIMEOUT_MS / 1000}s without data)`, 504)),
            SSE_IDLE_TIMEOUT_MS - elapsed
          )
        ),
      ]);
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
          return result;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

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
