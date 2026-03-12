/**
 * Agent chat tools — factory-generated from AGENT_ENDPOINTS.
 * Each tool sends a message to a specific SearchAtlas agent via SSE.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import { AGENT_ENDPOINTS } from "../types/agents.js";
import { streamAgentMessage } from "../utils/api-client.js";
import { formatError } from "../utils/errors.js";

const agentInputSchema = {
  message: z.string().describe("The message to send to the agent"),
  project_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Project ID to scope the request (recommended)"),
  playbook_id: z
    .string()
    .optional()
    .describe("Playbook ID to execute within this agent"),
  plan_mode: z
    .boolean()
    .optional()
    .default(false)
    .describe("Enable plan mode — agent proposes steps before executing"),
};

export function registerAgentTools(server: McpServer, config: Config): void {
  for (const agent of AGENT_ENDPOINTS) {
    server.tool(
      agent.toolName,
      agent.description,
      agentInputSchema,
      async ({ message, project_id, playbook_id, plan_mode }) => {
        try {
          const body: Record<string, unknown> = {
            message,
            plan_mode: plan_mode ?? false,
          };
          if (project_id !== undefined) body.project_id = project_id;
          if (playbook_id) body.playbook_id = playbook_id;

          const content = await streamAgentMessage(
            config,
            agent.endpoint,
            body
          );
          return { content: [{ type: "text" as const, text: content }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: formatError(err) }],
            isError: true,
          };
        }
      }
    );
  }
}
