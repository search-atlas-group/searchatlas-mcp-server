/**
 * End-to-end proxy integration tests.
 *
 * These replace the per-tool, per-endpoint tests that existed for the old
 * REST client. The behavior under test is now dynamic: the proxy must
 * faithfully forward every MCP request/response between a downstream MCP
 * client and an upstream MCP server. We exercise that by wiring both sides
 * to `InMemoryTransport.createLinkedPair()` — no network, no stdio — and
 * asserting real roundtrips.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";
import { registerProxyHandlers } from "../proxy.js";

interface FakeUpstream {
  server: Server;
  /** Records every call the fake upstream received. */
  calls: Array<{ method: string; params: unknown }>;
}

/** Default tool inputSchema required by the MCP wire format. */
const EMPTY_SCHEMA = { type: "object" as const, properties: {} };

/** Normalize a fake tool definition to include a valid MCP inputSchema. */
function withSchema<T extends { name: string; description?: string }>(t: T) {
  return { ...t, inputSchema: EMPTY_SCHEMA };
}

/** Build a fake MCP upstream that records calls and returns configurable responses. */
function makeFakeUpstream(opts: {
  capabilities: ServerCapabilities;
  tools?: Array<{ name: string; description?: string }>;
  onCallTool?: (name: string, args: unknown) => { content: unknown[]; isError?: boolean };
  prompts?: Array<{ name: string; description?: string }>;
  onGetPrompt?: (name: string) => { messages: unknown[] };
  resources?: Array<{ uri: string; name: string }>;
  resourceTemplates?: Array<{ uriTemplate: string; name: string }>;
  onReadResource?: (uri: string) => { contents: unknown[] };
  onComplete?: () => { completion: { values: string[]; total?: number; hasMore?: boolean } };
}): FakeUpstream {
  const server = new Server(
    { name: "fake-upstream", version: "0.0.1" },
    { capabilities: opts.capabilities }
  );
  const calls: FakeUpstream["calls"] = [];

  if (opts.capabilities.tools) {
    server.setRequestHandler(ListToolsRequestSchema, (req) => {
      calls.push({ method: "tools/list", params: req.params });
      return { tools: (opts.tools ?? []).map(withSchema) };
    });
    server.setRequestHandler(CallToolRequestSchema, (req) => {
      calls.push({ method: "tools/call", params: req.params });
      if (opts.onCallTool) {
        return opts.onCallTool(req.params.name, req.params.arguments);
      }
      return { content: [{ type: "text", text: `ok:${req.params.name}` }] };
    });
  }

  if (opts.capabilities.prompts) {
    server.setRequestHandler(ListPromptsRequestSchema, (req) => {
      calls.push({ method: "prompts/list", params: req.params });
      return { prompts: opts.prompts ?? [] };
    });
    server.setRequestHandler(GetPromptRequestSchema, (req) => {
      calls.push({ method: "prompts/get", params: req.params });
      if (opts.onGetPrompt) return opts.onGetPrompt(req.params.name);
      return { messages: [] };
    });
  }

  if (opts.capabilities.resources) {
    server.setRequestHandler(ListResourcesRequestSchema, (req) => {
      calls.push({ method: "resources/list", params: req.params });
      return { resources: opts.resources ?? [] };
    });
    server.setRequestHandler(ListResourceTemplatesRequestSchema, (req) => {
      calls.push({ method: "resources/templates/list", params: req.params });
      return { resourceTemplates: opts.resourceTemplates ?? [] };
    });
    server.setRequestHandler(ReadResourceRequestSchema, (req) => {
      calls.push({ method: "resources/read", params: req.params });
      if (opts.onReadResource) return opts.onReadResource(req.params.uri);
      return { contents: [] };
    });
  }

  if (opts.capabilities.completions) {
    server.setRequestHandler(CompleteRequestSchema, (req) => {
      calls.push({ method: "completion/complete", params: req.params });
      if (opts.onComplete) return opts.onComplete();
      return { completion: { values: [] } };
    });
  }

  return { server, calls };
}

/**
 * Build the full proxy chain:
 *   downstream Client ⇄ (linked pair) ⇄ proxy Server
 *                                     │
 *                                     └── proxy's upstream Client ⇄ (linked pair) ⇄ fake upstream Server
 *
 * This mirrors what happens in production: a user's MCP client talks to our
 * proxy, which talks to the remote SearchAtlas server.
 */
async function buildProxyChain(upstream: FakeUpstream): Promise<{
  downstream: Client;
  teardown: () => Promise<void>;
  proxyServer: Server;
  proxyClient: Client;
}> {
  // Upstream (fake remote) ⇄ proxy's upstream client.
  const [upstreamServerT, upstreamClientT] = InMemoryTransport.createLinkedPair();
  const proxyClient = new Client(
    { name: "searchatlas-proxy", version: "1.4.0" },
    { capabilities: {} }
  );
  await Promise.all([
    upstream.server.connect(upstreamServerT),
    proxyClient.connect(upstreamClientT),
  ]);

  // Proxy Server — advertises exactly what the upstream advertises.
  const serverCaps = proxyClient.getServerCapabilities() ?? {};
  const proxyServer = new Server(
    { name: "searchatlas", version: "1.4.0" },
    { capabilities: serverCaps }
  );
  registerProxyHandlers(proxyServer, proxyClient);

  // Downstream client ⇄ proxy Server.
  const [downstreamServerT, downstreamClientT] = InMemoryTransport.createLinkedPair();
  const downstream = new Client(
    { name: "downstream-test", version: "1.0" },
    { capabilities: {} }
  );
  await Promise.all([
    proxyServer.connect(downstreamServerT),
    downstream.connect(downstreamClientT),
  ]);

  const teardown = async () => {
    await Promise.allSettled([
      downstream.close(),
      proxyServer.close(),
      proxyClient.close(),
      upstream.server.close(),
    ]);
  };

  return { downstream, teardown, proxyServer, proxyClient };
}

describe("proxy integration (downstream → proxy → upstream)", () => {
  let teardown: () => Promise<void>;

  afterEach(async () => {
    if (teardown) await teardown();
  });

  it("forwards tools/list and returns the upstream's exact list", async () => {
    const upstream = makeFakeUpstream({
      capabilities: { tools: {} },
      tools: [
        { name: "otto_list_projects", description: "List OTTO projects" },
        { name: "bv_list", description: "List Brand Vaults" },
        { name: "cg_list_articles", description: "List articles" },
      ],
    });
    const chain = await buildProxyChain(upstream);
    teardown = chain.teardown;

    const { tools } = await chain.downstream.listTools();
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual([
      "otto_list_projects",
      "bv_list",
      "cg_list_articles",
    ]);
    expect(upstream.calls.some((c) => c.method === "tools/list")).toBe(true);
  });

  it("forwards tools/call with name + arguments and returns the result", async () => {
    const upstream = makeFakeUpstream({
      capabilities: { tools: {} },
      tools: [{ name: "bv_list" }],
      onCallTool: (name, args) => ({
        content: [
          { type: "text", text: `called=${name} args=${JSON.stringify(args)}` },
        ],
      }),
    });
    const chain = await buildProxyChain(upstream);
    teardown = chain.teardown;

    const result = await chain.downstream.callTool({
      name: "bv_list",
      arguments: { page: 1, page_size: 5, hostname: "example.com" },
    });

    expect(result.content).toEqual([
      {
        type: "text",
        text: 'called=bv_list args={"page":1,"page_size":5,"hostname":"example.com"}',
      },
    ]);
    // Upstream should see the exact same call
    const toolCall = upstream.calls.find((c) => c.method === "tools/call");
    expect(toolCall?.params).toMatchObject({
      name: "bv_list",
      arguments: { page: 1, page_size: 5, hostname: "example.com" },
    });
  });

  it("preserves tool-level errors (isError=true) from the upstream", async () => {
    const upstream = makeFakeUpstream({
      capabilities: { tools: {} },
      tools: [{ name: "bad_tool" }],
      onCallTool: () => ({
        content: [{ type: "text", text: "Validation failed" }],
        isError: true,
      }),
    });
    const chain = await buildProxyChain(upstream);
    teardown = chain.teardown;

    const result = await chain.downstream.callTool({
      name: "bad_tool",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "Validation failed" }]);
  });

  it("surfaces JSON-RPC protocol errors thrown by the upstream", async () => {
    const upstream = makeFakeUpstream({
      capabilities: { tools: {} },
      tools: [{ name: "explodes" }],
      onCallTool: () => {
        throw new Error("upstream crashed");
      },
    });
    const chain = await buildProxyChain(upstream);
    teardown = chain.teardown;

    await expect(
      chain.downstream.callTool({ name: "explodes", arguments: {} })
    ).rejects.toThrow(/upstream crashed/);
  });

  it("forwards a handful of representative v2 tool names from server.json", async () => {
    // server.json advertises these names to the MCP registry — the proxy
    // must be able to route calls to any of them.
    const representative = [
      "otto_list_projects",
      "ppc_list_accounts",
      "cg_list_articles",
      "se_list_sites",
      "gbp_get_business_categories",
      "ll_list_projects",
      "llmv_list_projects",
      "krt_list_projects",
      "bv_list",
      "gsc_get_sites",
    ];
    const upstream = makeFakeUpstream({
      capabilities: { tools: {} },
      tools: representative.map((name) => ({ name })),
      onCallTool: (name) => ({ content: [{ type: "text", text: name }] }),
    });
    const chain = await buildProxyChain(upstream);
    teardown = chain.teardown;

    for (const name of representative) {
      const r = await chain.downstream.callTool({ name, arguments: {} });
      expect(r.content).toEqual([{ type: "text", text: name }]);
    }
    const seenNames = upstream.calls
      .filter((c) => c.method === "tools/call")
      .map((c) => (c.params as { name: string }).name);
    expect(seenNames).toEqual(representative);
  });

  it("forwards concurrent tool calls independently (no cross-talk)", async () => {
    let counter = 0;
    const upstream = makeFakeUpstream({
      capabilities: { tools: {} },
      tools: [{ name: "increment" }],
      onCallTool: (_name, args) => {
        counter++;
        return {
          content: [{ type: "text", text: `n=${(args as { n: number }).n} seq=${counter}` }],
        };
      },
    });
    const chain = await buildProxyChain(upstream);
    teardown = chain.teardown;

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        chain.downstream.callTool({ name: "increment", arguments: { n: i } })
      )
    );

    // Each response must carry the n that was sent in (i.e. responses didn't get mixed up).
    for (let i = 0; i < 10; i++) {
      const content = results[i].content as Array<{ text: string }>;
      expect(content[0].text).toMatch(new RegExp(`^n=${i} seq=\\d+$`));
    }
    expect(counter).toBe(10);
  });

  it("forwards prompts/list and prompts/get", async () => {
    const upstream = makeFakeUpstream({
      capabilities: { prompts: {} },
      prompts: [{ name: "seo-report", description: "Draft an SEO report" }],
      onGetPrompt: (name) => ({
        messages: [{ role: "user", content: { type: "text", text: `prompt:${name}` } }],
      }),
    });
    const chain = await buildProxyChain(upstream);
    teardown = chain.teardown;

    const list = await chain.downstream.listPrompts();
    expect(list.prompts[0].name).toBe("seo-report");

    const got = await chain.downstream.getPrompt({ name: "seo-report" });
    expect(got.messages).toHaveLength(1);
    expect(upstream.calls.map((c) => c.method)).toEqual(["prompts/list", "prompts/get"]);
  });

  it("forwards resources/list, resources/templates/list, and resources/read", async () => {
    const upstream = makeFakeUpstream({
      capabilities: { resources: {} },
      resources: [{ uri: "searchatlas://project/42", name: "Project 42" }],
      resourceTemplates: [
        { uriTemplate: "searchatlas://project/{id}", name: "Project by id" },
      ],
      onReadResource: (uri) => ({
        contents: [{ uri, mimeType: "text/plain", text: `read:${uri}` }],
      }),
    });
    const chain = await buildProxyChain(upstream);
    teardown = chain.teardown;

    const resources = await chain.downstream.listResources();
    expect(resources.resources[0].uri).toBe("searchatlas://project/42");

    const templates = await chain.downstream.listResourceTemplates();
    expect(templates.resourceTemplates[0].uriTemplate).toBe(
      "searchatlas://project/{id}"
    );

    const read = await chain.downstream.readResource({
      uri: "searchatlas://project/42",
    });
    expect(read.contents).toEqual([
      { uri: "searchatlas://project/42", mimeType: "text/plain", text: "read:searchatlas://project/42" },
    ]);
  });

  it("forwards completion/complete", async () => {
    const upstream = makeFakeUpstream({
      capabilities: { prompts: {}, completions: {} },
      onComplete: () => ({ completion: { values: ["otto", "octopus"], hasMore: false } }),
    });
    const chain = await buildProxyChain(upstream);
    teardown = chain.teardown;

    const result = await chain.downstream.complete({
      ref: { type: "ref/prompt", name: "seo" },
      argument: { name: "term", value: "ot" },
    });
    expect(result.completion.values).toEqual(["otto", "octopus"]);
  });

  it("does not advertise tools if the upstream doesn't advertise them", async () => {
    const upstream = makeFakeUpstream({
      capabilities: { prompts: {} }, // no tools
      prompts: [{ name: "p" }],
    });
    const chain = await buildProxyChain(upstream);
    teardown = chain.teardown;

    expect(chain.proxyClient.getServerCapabilities()?.tools).toBeUndefined();
    expect(chain.proxyServer.getClientCapabilities()).toBeDefined();

    // tools/list should fail since the proxy never registered that handler.
    await expect(chain.downstream.listTools()).rejects.toThrow(/method not found|not implemented|unknown/i);
  });

  it("server info reported downstream is our proxy's identity", async () => {
    const upstream = makeFakeUpstream({
      capabilities: { tools: {} },
      tools: [],
    });
    const chain = await buildProxyChain(upstream);
    teardown = chain.teardown;

    const info = chain.downstream.getServerVersion();
    expect(info?.name).toBe("searchatlas");
    expect(info?.version).toBe("1.4.0");
  });

  it("handles a paginated tools/list cursor through the proxy", async () => {
    let pageCursor: string | undefined;
    const upstream = makeFakeUpstream({
      capabilities: { tools: {} },
    });
    // Override the default handler to return cursors.
    upstream.server.setRequestHandler(ListToolsRequestSchema, (req) => {
      upstream.calls.push({ method: "tools/list", params: req.params });
      const cursor = req.params?.cursor;
      pageCursor = cursor;
      if (!cursor) {
        return {
          tools: [
            withSchema({ name: "page1_a" }),
            withSchema({ name: "page1_b" }),
          ],
          nextCursor: "page-2",
        };
      }
      return { tools: [withSchema({ name: "page2_a" })] };
    });
    const chain = await buildProxyChain(upstream);
    teardown = chain.teardown;

    const first = await chain.downstream.listTools();
    expect(first.tools.map((t) => t.name)).toEqual(["page1_a", "page1_b"]);
    expect(first.nextCursor).toBe("page-2");

    const second = await chain.downstream.listTools({ cursor: "page-2" });
    expect(second.tools.map((t) => t.name)).toEqual(["page2_a"]);
    expect(pageCursor).toBe("page-2"); // proxy preserved the cursor
  });

  it("passes complex arguments (nested objects, arrays, null) through unchanged", async () => {
    let received: unknown;
    const upstream = makeFakeUpstream({
      capabilities: { tools: {} },
      tools: [{ name: "echo" }],
      onCallTool: (_name, args) => {
        received = args;
        return { content: [{ type: "text", text: "ok" }] };
      },
    });
    const chain = await buildProxyChain(upstream);
    teardown = chain.teardown;

    const complexArgs = {
      filters: { status: "active", tags: ["seo", "ppc"], archived: null },
      pagination: { page: 1, page_size: 50 },
      sort: [
        { field: "created_at", direction: "desc" },
        { field: "name", direction: "asc" },
      ],
      meta: null,
    };
    await chain.downstream.callTool({ name: "echo", arguments: complexArgs });
    expect(received).toEqual(complexArgs);
  });
});

describe("capability propagation", () => {
  let teardown: () => Promise<void>;
  afterEach(async () => {
    if (teardown) await teardown();
  });

  it.each([
    { caps: { tools: {} }, label: "tools only" },
    { caps: { tools: {}, prompts: {} }, label: "tools + prompts" },
    { caps: { resources: {} }, label: "resources only" },
    {
      caps: { tools: {}, prompts: {}, resources: {}, completions: {} },
      label: "full capability set",
    },
  ])("propagates $label", async ({ caps }) => {
    const upstream = makeFakeUpstream({ capabilities: caps as ServerCapabilities });
    const chain = await buildProxyChain(upstream);
    teardown = chain.teardown;

    const advertised = chain.downstream.getServerCapabilities() ?? {};
    for (const key of Object.keys(caps)) {
      expect(advertised[key as keyof typeof advertised]).toBeDefined();
    }
  });
});

// Quieten SDK logs during the test run (registering an unknown method
// triggers an error log by design — we expect that in one test).
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
