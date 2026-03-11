/**
 * Session and user identity helpers.
 * Mirrors frontend/lib/jwt-utils.ts — generates session IDs and extracts
 * user_id from the JWT token so the backend can track conversations.
 *
 * NOTE: getUserId() decodes the JWT payload WITHOUT signature verification.
 * This is a UX helper only — the backend validates the token independently.
 */

import { randomUUID } from "node:crypto";
import type { Config } from "../config.js";
import { validateToken } from "./token.js";

/**
 * Extract user_id from a JWT token payload using the shared validateToken() utility.
 * Falls back to a stable random UUID when no token is available.
 */
export function getUserId(config: Config): string {
  if (config.token) {
    const result = validateToken(config.token);
    if (result.userId) {
      return String(result.userId).replace(/\W+/g, "_");
    }
  }
  return getMcpUserId();
}

/** Stable per-process user ID fallback (used when no JWT is available). */
let _mcpUserId: string | undefined;
function getMcpUserId(): string {
  if (!_mcpUserId) _mcpUserId = `mcp_${randomUUID().replace(/-/g, "")}`;
  return _mcpUserId;
}

/** Generate a new session ID (one per tool call). */
export function createSessionId(): string {
  return randomUUID();
}
