/**
 * Project tools — list and create SearchAtlas projects.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import type { PaginatedResponse, Project } from "../types/api.js";
import { apiRequest } from "../utils/api-client.js";
import { formatError } from "../utils/errors.js";

export function registerProjectTools(server: McpServer, config: Config): void {
  server.tool(
    "searchatlas_list_projects",
    "List SearchAtlas projects for the authenticated user",
    {
      page: z.number().optional().default(1).describe("Page number"),
      page_size: z.number().int().min(1).max(100).optional().default(20).describe("Results per page (max 100)"),
      search: z.string().optional().describe("Filter projects by domain"),
    },
    async ({ page, page_size, search }) => {
      try {
        const params: Record<string, string> = {
          page: String(page ?? 1),
          page_size: String(page_size ?? 20),
        };
        if (search) params.search = search;

        const data = await apiRequest<PaginatedResponse<Project> | Project[]>(
          config,
          "/api/agent/projects/",
          { params }
        );

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(data, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: formatError(err) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "searchatlas_create_project",
    "Create a new SearchAtlas project",
    {
      domain: z.string().regex(/^[a-z0-9]([a-z0-9\-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9\-]*[a-z0-9])?)*\.[a-z]{2,}$/i, "Must be a valid domain (e.g. example.com)").describe("Project domain (e.g. example.com)"),
      country_code: z
        .string()
        .optional()
        .default("US")
        .describe("ISO country code (default: US)"),
    },
    async ({ domain, country_code }) => {
      try {
        const data = await apiRequest<Project>(config, "/api/agent/projects/", {
          method: "POST",
          body: {
            domain,
            country_code: country_code ?? "US",
            competitors: [],
          },
        });

        return {
          content: [
            { type: "text" as const, text: JSON.stringify(data, null, 2) },
          ],
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
