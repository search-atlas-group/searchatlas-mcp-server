/**
 * Replaces the old api-client.test.ts.
 *
 * The HTTP framing used to live in src/utils/api-client.ts (JSON + SSE). It's
 * now owned by @modelcontextprotocol/sdk's StreamableHTTPClientTransport.
 * What we still own — and must test — is how we build that transport:
 *   - it aims at the configured URL
 *   - it carries the right auth header (Bearer vs X-API-Key)
 *   - it doesn't pin Content-Type (the SDK manages that per request)
 */
import { describe, it, expect, vi } from "vitest";

// Capture transport constructor arguments for assertion.
const capture = vi.fn();
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => {
  class MockStreamableHTTPClientTransport {
    constructor(url: URL, opts: unknown) {
      capture(url, opts);
    }
    start = vi.fn();
    send = vi.fn();
    close = vi.fn();
    onmessage?: unknown;
    onclose?: unknown;
    onerror?: unknown;
  }
  return { StreamableHTTPClientTransport: MockStreamableHTTPClientTransport };
});

import { createUpstreamTransport } from "../proxy.js";

describe("createUpstreamTransport", () => {
  it("targets the apiUrl verbatim (keeps the /mcp path)", () => {
    capture.mockClear();
    createUpstreamTransport({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: "abc",
    });
    const [url] = capture.mock.calls[0];
    expect((url as URL).toString()).toBe("https://mcp.searchatlas.com/mcp");
    expect((url as URL).pathname).toBe("/mcp");
  });

  it("sends Bearer auth when a token is present", () => {
    capture.mockClear();
    createUpstreamTransport({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: "my-jwt",
    });
    const [, opts] = capture.mock.calls[0];
    const headers = (opts as { requestInit: { headers: Record<string, string> } }).requestInit.headers;
    expect(headers.Authorization).toBe("Bearer my-jwt");
    expect(headers["X-API-Key"]).toBeUndefined();
  });

  it("sends X-API-Key when only an API key is present", () => {
    capture.mockClear();
    createUpstreamTransport({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      apiKey: "my-key",
    });
    const [, opts] = capture.mock.calls[0];
    const headers = (opts as { requestInit: { headers: Record<string, string> } }).requestInit.headers;
    expect(headers["X-API-Key"]).toBe("my-key");
    expect(headers.Authorization).toBeUndefined();
  });

  it("prefers Bearer token over API key when both are set", () => {
    capture.mockClear();
    createUpstreamTransport({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: "jwt",
      apiKey: "key",
    });
    const [, opts] = capture.mock.calls[0];
    const headers = (opts as { requestInit: { headers: Record<string, string> } }).requestInit.headers;
    expect(headers.Authorization).toBe("Bearer jwt");
    expect(headers["X-API-Key"]).toBeUndefined();
  });

  it("does not pin Content-Type (the SDK sets it per request)", () => {
    capture.mockClear();
    createUpstreamTransport({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: "t",
    });
    const [, opts] = capture.mock.calls[0];
    const headers = (opts as { requestInit: { headers: Record<string, string> } }).requestInit.headers;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers["content-type"]).toBeUndefined();
  });

  it("handles a custom staging endpoint (any *.searchatlas.com is fine — validation is in config)", () => {
    capture.mockClear();
    createUpstreamTransport({
      apiUrl: "https://staging.searchatlas.com/mcp",
      token: "t",
    });
    const [url] = capture.mock.calls[0];
    expect((url as URL).host).toBe("staging.searchatlas.com");
    expect((url as URL).pathname).toBe("/mcp");
  });

  it("passes no body/method overrides — the SDK owns request framing", () => {
    capture.mockClear();
    createUpstreamTransport({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: "t",
    });
    const [, opts] = capture.mock.calls[0] as [
      URL,
      { requestInit?: RequestInit & { method?: string; body?: unknown } }
    ];
    expect(opts.requestInit?.method).toBeUndefined();
    expect(opts.requestInit?.body).toBeUndefined();
  });
});
