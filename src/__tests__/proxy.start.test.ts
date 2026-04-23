import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the constructors' URLs and options so we can assert wiring.
const transportCtor = vi.fn();
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => {
  class MockTransport {
    start = vi.fn().mockResolvedValue(undefined);
    send = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    constructor(url: URL, opts: unknown) {
      transportCtor(url.toString(), opts);
    }
  }
  return { StreamableHTTPClientTransport: MockTransport };
});

const clientConnect = vi.fn().mockResolvedValue(undefined);
const clientListTools = vi.fn().mockResolvedValue({ tools: [] });
const serverConnect = vi.fn().mockResolvedValue(undefined);
const setRequestHandler = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  class MockClient {
    connect = clientConnect;
    listTools = clientListTools;
    getServerCapabilities = () => ({ tools: {}, prompts: {}, resources: {}, completions: {} });
    callTool = vi.fn();
    listPrompts = vi.fn();
    getPrompt = vi.fn();
    listResources = vi.fn();
    listResourceTemplates = vi.fn();
    readResource = vi.fn();
    complete = vi.fn();
  }
  return { Client: MockClient };
});

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
  class MockServer {
    constructor(public info: unknown, public opts: unknown) {}
    setRequestHandler = setRequestHandler;
    connect = serverConnect;
  }
  return { Server: MockServer };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
  class MockStdioTransport {
    marker = "stdio";
  }
  return { StdioServerTransport: MockStdioTransport };
});

import { startProxy } from "../proxy.js";

describe("startProxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("connects upstream, advertises upstream caps, and starts stdio", async () => {
    const { server, client } = await startProxy(
      { apiUrl: "https://mcp.searchatlas.com/mcp", token: "jwt" },
      { name: "searchatlas", version: "9.9.9" }
    );

    // Transport was created with the configured URL and an auth header.
    expect(transportCtor).toHaveBeenCalledTimes(1);
    const [url, opts] = transportCtor.mock.calls[0];
    expect(url).toBe("https://mcp.searchatlas.com/mcp");
    expect((opts as { requestInit: { headers: Record<string, string> } }).requestInit.headers.Authorization)
      .toBe("Bearer jwt");

    // Client connected before we registered proxy handlers.
    expect(clientConnect).toHaveBeenCalledTimes(1);

    // Server was connected to the stdio transport after handlers were registered.
    expect(serverConnect).toHaveBeenCalledTimes(1);
    expect((serverConnect.mock.calls[0][0] as { marker: string }).marker).toBe("stdio");

    // Each advertised capability produced a registration (tools:2, prompts:2, resources:3, completions:1 = 8).
    expect(setRequestHandler).toHaveBeenCalledTimes(8);

    // Returned objects are the ones we just wired.
    expect(server).toBeDefined();
    expect(client).toBeDefined();
  });

  it("uses X-API-Key when token is absent", async () => {
    await startProxy(
      { apiUrl: "https://mcp.searchatlas.com/mcp", apiKey: "my-key" },
      { name: "searchatlas", version: "1.0.0" }
    );
    const [, opts] = transportCtor.mock.calls[0];
    const headers = (opts as { requestInit: { headers: Record<string, string> } }).requestInit.headers;
    expect(headers["X-API-Key"]).toBe("my-key");
    expect(headers.Authorization).toBeUndefined();
  });
});
