/**
 * Playbook tools — list available playbooks and execute them.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { PaginatedResponse, PlaybookListItem } from '../types/api.js';
import { apiRequest, streamAgentMessage } from '../utils/api-client.js';
import { formatError } from '../utils/errors.js';
import { AGENT_ENDPOINTS } from '../types/agents.js';

export function registerPlaybookTools(server: McpServer, config: Config): void {
  server.tool(
    'searchatlas_list_playbooks',
    'List available playbooks (automation recipes), optionally filtered by agent or ownership',
    {
      filter: z
        .enum(['all', 'my', 'community'])
        .optional()
        .default('all')
        .describe('Ownership filter'),
      agent_namespace: z
        .string()
        .optional()
        .describe(
          'Filter by agent namespace (e.g. otto, content_genius, orchestrator)',
        ),
      search: z
        .string()
        .optional()
        .describe('Search playbooks by name or description'),
      page: z.number().optional().default(1).describe('Page number'),
      page_size: z.number().int().min(1).max(100).optional().default(20).describe('Results per page (max 100)'),
    },
    async ({ filter, agent_namespace, search, page, page_size }) => {
      try {
        const params: Record<string, string> = {
          page: String(page ?? 1),
        };
        if (filter && filter !== 'all') params.filter = filter;
        if (page_size) params.page_size = String(page_size);
        if (agent_namespace) params.agent_namespace = agent_namespace;
        if (search) params.search = search;

        const data = await apiRequest<PaginatedResponse<PlaybookListItem>>(
          config,
          '/api/playbooks/',
          { params },
        );

        return {
          content: [
            { type: 'text' as const, text: JSON.stringify(data, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'searchatlas_run_playbook',
    'Execute a playbook (automation recipe) on a project using the appropriate agent',
    {
      playbook_id: z.string().describe('UUID of the playbook to run'),
      project_id: z.number().int().positive().describe('Project ID to run the playbook against'),
      message: z
        .string()
        .optional()
        .default('Run this playbook')
        .describe('Optional instruction message to the agent'),
      agent_namespace: z
        .string()
        .optional()
        .describe(
          'Agent namespace to execute in (default: orchestrator). ' +
            'Use the agent_namespace from the playbook listing.',
        ),
    },
    async ({ playbook_id, project_id, message, agent_namespace }) => {
      try {
        // Resolve the endpoint from namespace, defaulting to orchestrator.
        const ns = agent_namespace ?? 'orchestrator';
        const agent = AGENT_ENDPOINTS.find((a) => a.historyNamespace === ns);
        const endpoint = agent?.endpoint ?? '/api/agent/orchestrator/';

        const content = await streamAgentMessage(config, endpoint, {
          message: message ?? 'Run this playbook',
          project_id,
          playbook_id,
          plan_mode: false,
        });

        return { content: [{ type: 'text' as const, text: content }] };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: formatError(err) }],
          isError: true,
        };
      }
    },
  );
}
