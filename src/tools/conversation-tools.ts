/**
 * Conversation tools — list chat sessions.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import { apiRequest } from "../utils/api-client.js";
import { formatError } from "../utils/errors.js";

export function registerConversationTools(server: McpServer, config: Config): void {
  server.tool(
    "searchatlas_list_conversations",
    "List conversation sessions, optionally filtered by agent",
    {
      agent_namespace: z
        .string()
        .optional()
        .describe("Filter by agent namespace (e.g. orchestrator, otto, content_genius)"),
      page: z.number().optional().default(1).describe("Page number"),
      page_size: z.number().int().min(1).max(100).optional().default(20).describe("Results per page (max 100)"),
      search: z.string().optional().describe("Search conversations by title"),
    },
    async ({ agent_namespace, page, page_size, search }) => {
      try {
        const params: Record<string, string> = {
          page: String(page ?? 1),
        };
        if (page_size) params.page_size = String(page_size);
        if (agent_namespace) params.agent_namespace = agent_namespace;
        if (search) params.search = search;

        const data = await apiRequest<unknown>(
          config,
          "/api/agent/sessions/",
          { params }
        );

        return {
          content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: formatError(err) }],
          isError: true,
        };
      }
    }
  );
}
