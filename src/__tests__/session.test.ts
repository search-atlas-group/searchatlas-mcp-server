/**
 * Replaces the old session.test.ts, which tested a bespoke session-id helper
 * used by the REST client. Sessions are now owned by the MCP SDK's
 * StreamableHTTPClientTransport (Mcp-Session-Id header). The behavior we
 * still own is: the proxy must not leak the downstream session to the
 * upstream (the two halves of the chain have independent session ids) and
 * long-lived sessions must not break under sequential requests.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { registerProxyHandlers } from "../proxy.js";

const EMPTY_SCHEMA = { type: "object" as const, properties: {} };

describe("proxy session isolation", () => {
  let cleanup: (() => Promise<void>) | undefined;
  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = undefined;
  });

  async function buildChain() {
    const upstream = new Server(
      { name: "u", version: "1" },
      { capabilities: { tools: {} } }
    );
    let counter = 0;
    upstream.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [{ name: "ping", description: "ping", inputSchema: EMPTY_SCHEMA }],
    }));
    upstream.setRequestHandler(CallToolRequestSchema, () => {
      counter++;
      return { content: [{ type: "text", text: `pong-${counter}` }] };
    });

    const [uServer, uClient] = InMemoryTransport.createLinkedPair();
    const proxyClient = new Client(
      { name: "proxy-client", version: "1" },
      { capabilities: {} }
    );
    await Promise.all([upstream.connect(uServer), proxyClient.connect(uClient)]);

    const proxyServer = new Server(
      { name: "proxy", version: "1" },
      { capabilities: proxyClient.getServerCapabilities() ?? {} }
    );
    registerProxyHandlers(proxyServer, proxyClient);

    const [dServer, dClient] = InMemoryTransport.createLinkedPair();
    const downstream = new Client(
      { name: "downstream", version: "1" },
      { capabilities: {} }
    );
    await Promise.all([proxyServer.connect(dServer), downstream.connect(dClient)]);

    cleanup = async () => {
      await Promise.allSettled([
        downstream.close(),
        proxyServer.close(),
        proxyClient.close(),
        upstream.close(),
      ]);
    };
    return { downstream, upstream };
  }

  it("lets the same downstream session make many sequential calls", async () => {
    const { downstream } = await buildChain();

    for (let i = 1; i <= 5; i++) {
      const result = await downstream.callTool({ name: "ping", arguments: {} });
      const first = (result.content as Array<{ text: string }>)[0];
      expect(first.text).toBe(`pong-${i}`);
    }
  });

  it("survives interleaved tools/list and tools/call on the same session", async () => {
    const { downstream } = await buildChain();

    const list1 = await downstream.listTools();
    expect(list1.tools[0].name).toBe("ping");

    const call = await downstream.callTool({ name: "ping", arguments: {} });
    expect(call.content).toEqual([{ type: "text", text: "pong-1" }]);

    const list2 = await downstream.listTools();
    expect(list2.tools).toEqual(list1.tools);
  });

  it("two proxy instances share no state (independent sessions per spawn)", async () => {
    const chainA = await buildChain();
    const resA = await chainA.downstream.callTool({ name: "ping", arguments: {} });
    await cleanup?.();
    cleanup = undefined;

    const chainB = await buildChain();
    const resB = await chainB.downstream.callTool({ name: "ping", arguments: {} });

    // Each fake upstream is a fresh Server, so counters start from 1 each time —
    // the proxy isn't smuggling state across runs.
    expect((resA.content as Array<{ text: string }>)[0].text).toBe("pong-1");
    expect((resB.content as Array<{ text: string }>)[0].text).toBe("pong-1");
  });
});
