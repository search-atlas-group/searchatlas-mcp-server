/**
 * stdio → Streamable HTTP proxy.
 *
 * The SearchAtlas v2 MCP server is hosted at https://mcp.searchatlas.com/mcp/
 * and speaks MCP over Streamable HTTP (JSON-RPC + SSE). Many MCP clients
 * (Claude Desktop, older Cursor, VS Code) only support stdio transports, so
 * this package runs as a local stdio server that forwards every JSON-RPC
 * request to the remote server and streams the response back.
 *
 * Tools, prompts, and resources are discovered dynamically from the remote —
 * there is no hard-coded tool list, which is why the 587-tool catalog stays
 * in sync without a package release.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "./config.js";
import { getAuthHeaders } from "./utils/auth.js";

export interface StartProxyOptions {
  /** Advertised server name in MCP handshakes. */
  name: string;
  /** Advertised server version. */
  version: string;
}

/**
 * Build a StreamableHTTPClientTransport that authenticates with the SearchAtlas
 * token/API key. The transport is responsible for HTTP framing; we only inject
 * the auth headers via requestInit.
 */
export function createUpstreamTransport(config: Config): StreamableHTTPClientTransport {
  // Strip the Content-Type header — the SDK sets its own per request.
  const { "Content-Type": _contentType, ...authHeaders } = getAuthHeaders(config);
  return new StreamableHTTPClientTransport(new URL(config.apiUrl), {
    requestInit: { headers: authHeaders },
  });
}

/**
 * Wire the remote MCP client's capabilities into a local Server so every
 * supported request type is forwarded. Capabilities that the remote does not
 * advertise are simply not registered, which lets the SDK reply with
 * "method not found" naturally.
 */
export function registerProxyHandlers(server: Server, client: Client): void {
  const caps = client.getServerCapabilities() ?? {};

  if (caps.tools) {
    server.setRequestHandler(ListToolsRequestSchema, (req) =>
      client.listTools(req.params)
    );
    server.setRequestHandler(CallToolRequestSchema, (req) =>
      client.callTool(req.params)
    );
  }

  if (caps.prompts) {
    server.setRequestHandler(ListPromptsRequestSchema, (req) =>
      client.listPrompts(req.params)
    );
    server.setRequestHandler(GetPromptRequestSchema, (req) =>
      client.getPrompt(req.params)
    );
  }

  if (caps.resources) {
    server.setRequestHandler(ListResourcesRequestSchema, (req) =>
      client.listResources(req.params)
    );
    server.setRequestHandler(ListResourceTemplatesRequestSchema, (req) =>
      client.listResourceTemplates(req.params)
    );
    server.setRequestHandler(ReadResourceRequestSchema, (req) =>
      client.readResource(req.params)
    );
  }

  if (caps.completions) {
    server.setRequestHandler(CompleteRequestSchema, (req) =>
      client.complete(req.params)
    );
  }
}

/**
 * Start the proxy: connect to the remote MCP, build a stdio server whose
 * capabilities mirror the remote's, and run until the process exits.
 *
 * Returns the created server and client so callers (tests) can inspect or
 * tear them down; production just awaits it and lets the process live.
 */
export async function startProxy(
  config: Config,
  opts: StartProxyOptions
): Promise<{ server: Server; client: Client }> {
  const client = new Client(
    { name: `${opts.name}-proxy`, version: opts.version },
    { capabilities: {} }
  );

  const upstream = createUpstreamTransport(config);
  await client.connect(upstream);

  // Advertise exactly what the remote advertises, so the downstream client
  // knows which capabilities are available.
  const serverCaps = client.getServerCapabilities() ?? {};
  const server = new Server(
    { name: opts.name, version: opts.version },
    { capabilities: serverCaps }
  );

  registerProxyHandlers(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return { server, client };
}
