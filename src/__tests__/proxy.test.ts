import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  CompleteRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { createUpstreamTransport, registerProxyHandlers } from "../proxy.js";

// A minimal Client double that records every method the proxy forwards to.
type MockClient = {
  getServerCapabilities: () => Record<string, unknown>;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
  listPrompts: ReturnType<typeof vi.fn>;
  getPrompt: ReturnType<typeof vi.fn>;
  listResources: ReturnType<typeof vi.fn>;
  listResourceTemplates: ReturnType<typeof vi.fn>;
  readResource: ReturnType<typeof vi.fn>;
  complete: ReturnType<typeof vi.fn>;
};

function makeClient(caps: Record<string, unknown>): MockClient {
  return {
    getServerCapabilities: () => caps,
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    callTool: vi.fn().mockResolvedValue({ content: [] }),
    listPrompts: vi.fn().mockResolvedValue({ prompts: [] }),
    getPrompt: vi.fn().mockResolvedValue({ messages: [] }),
    listResources: vi.fn().mockResolvedValue({ resources: [] }),
    listResourceTemplates: vi.fn().mockResolvedValue({ resourceTemplates: [] }),
    readResource: vi.fn().mockResolvedValue({ contents: [] }),
    complete: vi.fn().mockResolvedValue({ completion: { values: [] } }),
  };
}

// A Server double that records the handlers the proxy registers so we can
// invoke them directly without spinning up a transport.
function makeServer(): {
  server: Server;
  handlers: Map<unknown, (req: unknown) => Promise<unknown>>;
} {
  const handlers = new Map<unknown, (req: unknown) => Promise<unknown>>();
  const server = {
    setRequestHandler: vi.fn((schema: unknown, handler: (req: unknown) => Promise<unknown>) => {
      handlers.set(schema, handler);
    }),
  } as unknown as Server;
  return { server, handlers };
}

describe("registerProxyHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers tool handlers when the remote advertises tools", () => {
    const client = makeClient({ tools: {} });
    const { server, handlers } = makeServer();

    registerProxyHandlers(server, client as unknown as Client);

    expect(handlers.has(ListToolsRequestSchema)).toBe(true);
    expect(handlers.has(CallToolRequestSchema)).toBe(true);
    expect(handlers.has(ListPromptsRequestSchema)).toBe(false);
  });

  it("registers prompt and resource handlers when advertised", () => {
    const client = makeClient({ prompts: {}, resources: {}, completions: {} });
    const { server, handlers } = makeServer();

    registerProxyHandlers(server, client as unknown as Client);

    expect(handlers.has(ListPromptsRequestSchema)).toBe(true);
    expect(handlers.has(GetPromptRequestSchema)).toBe(true);
    expect(handlers.has(ListResourcesRequestSchema)).toBe(true);
    expect(handlers.has(ListResourceTemplatesRequestSchema)).toBe(true);
    expect(handlers.has(ReadResourceRequestSchema)).toBe(true);
    expect(handlers.has(CompleteRequestSchema)).toBe(true);
  });

  it("forwards tools/list with the caller's params", async () => {
    const client = makeClient({ tools: {} });
    const { server, handlers } = makeServer();
    registerProxyHandlers(server, client as unknown as Client);

    const handler = handlers.get(ListToolsRequestSchema)!;
    await handler({ method: "tools/list", params: { cursor: "abc" } });

    expect(client.listTools).toHaveBeenCalledWith({ cursor: "abc" });
  });

  it("forwards tools/call with name and arguments", async () => {
    const client = makeClient({ tools: {} });
    client.callTool.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const { server, handlers } = makeServer();
    registerProxyHandlers(server, client as unknown as Client);

    const handler = handlers.get(CallToolRequestSchema)!;
    const params = { name: "otto_list_projects", arguments: { page: 1 } };
    const result = await handler({ method: "tools/call", params });

    expect(client.callTool).toHaveBeenCalledWith(params);
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("forwards prompts/get and resources/read", async () => {
    const client = makeClient({ prompts: {}, resources: {} });
    const { server, handlers } = makeServer();
    registerProxyHandlers(server, client as unknown as Client);

    await handlers.get(GetPromptRequestSchema)!({ method: "prompts/get", params: { name: "p1" } });
    await handlers.get(ReadResourceRequestSchema)!({
      method: "resources/read",
      params: { uri: "s3://bucket/key" },
    });

    expect(client.getPrompt).toHaveBeenCalledWith({ name: "p1" });
    expect(client.readResource).toHaveBeenCalledWith({ uri: "s3://bucket/key" });
  });

  it("forwards pagination cursors on list calls", async () => {
    const client = makeClient({ prompts: {}, resources: {} });
    const { server, handlers } = makeServer();
    registerProxyHandlers(server, client as unknown as Client);

    await handlers.get(ListPromptsRequestSchema)!({
      method: "prompts/list",
      params: { cursor: "page-2" },
    });
    await handlers.get(ListResourcesRequestSchema)!({
      method: "resources/list",
      params: { cursor: "rc-42" },
    });
    await handlers.get(ListResourceTemplatesRequestSchema)!({
      method: "resources/templates/list",
      params: {},
    });

    expect(client.listPrompts).toHaveBeenCalledWith({ cursor: "page-2" });
    expect(client.listResources).toHaveBeenCalledWith({ cursor: "rc-42" });
    expect(client.listResourceTemplates).toHaveBeenCalledWith({});
  });

  it("forwards completion/complete requests", async () => {
    const client = makeClient({ completions: {} });
    const { server, handlers } = makeServer();
    registerProxyHandlers(server, client as unknown as Client);

    const params = {
      ref: { type: "ref/prompt", name: "prompt-x" },
      argument: { name: "query", value: "hello" },
    };
    await handlers.get(CompleteRequestSchema)!({ method: "completion/complete", params });
    expect(client.complete).toHaveBeenCalledWith(params);
  });

  it("propagates upstream errors instead of swallowing them", async () => {
    const client = makeClient({ tools: {} });
    client.callTool.mockRejectedValue(new Error("upstream boom"));
    const { server, handlers } = makeServer();
    registerProxyHandlers(server, client as unknown as Client);

    const handler = handlers.get(CallToolRequestSchema)!;
    await expect(
      handler({ method: "tools/call", params: { name: "x", arguments: {} } })
    ).rejects.toThrow("upstream boom");
  });

  it("returns exactly what the upstream returned (no transformation)", async () => {
    const client = makeClient({ tools: {} });
    const sentinel = { tools: [{ name: "a", description: "A" }], nextCursor: "c" };
    client.listTools.mockResolvedValue(sentinel);
    const { server, handlers } = makeServer();
    registerProxyHandlers(server, client as unknown as Client);

    const result = await handlers.get(ListToolsRequestSchema)!({
      method: "tools/list",
      params: {},
    });
    expect(result).toBe(sentinel);
  });

  it("handles a client with no capabilities at all (registers nothing)", () => {
    const client = {
      getServerCapabilities: () => undefined,
    } as unknown as Client;
    const { server, handlers } = makeServer();

    registerProxyHandlers(server, client);

    expect(handlers.size).toBe(0);
  });
});

describe("createUpstreamTransport", () => {
  it("builds a Streamable HTTP transport at the configured URL", () => {
    const transport = createUpstreamTransport({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: "jwt-token",
    });
    expect(transport).toBeDefined();
    // The transport type carries the URL internally; the public contract we care
    // about is that it implements the Transport interface (start/send/close).
    expect(typeof transport.start).toBe("function");
    expect(typeof transport.send).toBe("function");
    expect(typeof transport.close).toBe("function");
  });

  it("accepts an apiKey-based config without a token", () => {
    const transport = createUpstreamTransport({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      apiKey: "secret-key",
    });
    expect(transport).toBeDefined();
  });
});
