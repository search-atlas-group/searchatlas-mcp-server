/**
 * Test helpers — shared utilities for creating test fixtures.
 */

/** Create a valid JWT token for testing. */
export function createTestJWT(
  payload: Record<string, unknown> = {},
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" }
): string {
  const enc = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64url");

  const defaultPayload = {
    user_id: "42",
    exp: Math.floor(Date.now() / 1000) + 86400, // +24h
    ...payload,
  };

  return `${enc(header)}.${enc(defaultPayload)}.fakesignature`;
}

/** Create an expired JWT token. */
export function createExpiredJWT(payload: Record<string, unknown> = {}): string {
  return createTestJWT({
    exp: Math.floor(Date.now() / 1000) - 3600, // -1h
    ...payload,
  });
}

/** Create a test Config object. */
export function createTestConfig(overrides: Record<string, unknown> = {}) {
  return {
    apiUrl: "https://mcp.searchatlas.com/mcp",
    token: createTestJWT(),
    ...overrides,
  };
}

/** Create a mock McpServer that captures tool registrations. */
export function createMockServer() {
  const tools: Map<string, {
    name: string;
    description: string;
    schema: unknown;
    handler: (...args: unknown[]) => Promise<unknown>;
  }> = new Map();

  return {
    tools,
    tool(name: string, description: string, schema: unknown, handler: (...args: unknown[]) => Promise<unknown>) {
      tools.set(name, { name, description, schema, handler });
    },
  };
}
