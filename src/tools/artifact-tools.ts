/**
 * Artifact tools — list generated artifacts across sessions.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import type { ArtifactListResponse } from "../types/api.js";
import { apiRequest } from "../utils/api-client.js";
import { formatError } from "../utils/errors.js";

export function registerArtifactTools(server: McpServer, config: Config): void {
  server.tool(
    "searchatlas_list_artifacts",
    "List artifacts (code, content, reports) across all sessions",
    {
      page: z.number().optional().default(1).describe("Page number"),
      page_size: z.number().int().min(1).max(100).optional().default(20).describe("Results per page (max 100)"),
      type: z
        .string()
        .optional()
        .describe("Filter by artifact type (e.g. code, text, html)"),
      search: z.string().optional().describe("Search artifacts by title or content"),
      namespace: z
        .string()
        .optional()
        .describe("Filter by agent namespace (e.g. otto, content_genius)"),
    },
    async ({ page, page_size, type, search, namespace }) => {
      try {
        const params: Record<string, string> = {
          page: String(page ?? 1),
        };
        if (page_size) params.page_size = String(page_size);
        if (type) params.type = type;
        if (search) params.search = search;
        if (namespace) params.namespace = namespace;

        const data = await apiRequest<ArtifactListResponse>(
          config,
          "/api/agent/artifacts/",
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
