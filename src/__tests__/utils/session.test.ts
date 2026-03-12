import { describe, it, expect } from "vitest";
import { getUserId, createSessionId } from "../../utils/session.js";
import { createTestJWT } from "../helpers.js";

describe("getUserId", () => {
  it("extracts user_id from JWT token", () => {
    const token = createTestJWT({ user_id: "abc_123" });
    const userId = getUserId({ apiUrl: "https://example.com", token });
    expect(userId).toBe("abc_123");
  });

  it("extracts numeric user_id as string", () => {
    const token = createTestJWT({ user_id: 42 });
    const userId = getUserId({ apiUrl: "https://example.com", token });
    expect(userId).toBe("42");
  });

  it("extracts sub claim as fallback", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "user-sub" })).toString("base64url");
    const token = `${header}.${payload}.sig`;
    const userId = getUserId({ apiUrl: "https://example.com", token });
    expect(userId).toBe("user-sub"); // hyphens preserved, other non-word chars replaced with _
  });

  it("sanitizes non-word characters", () => {
    const token = createTestJWT({ user_id: "user@example.com" });
    const userId = getUserId({ apiUrl: "https://example.com", token });
    expect(userId).toBe("user_example_com");
  });

  it("returns stable mcp_ prefixed ID when no token", () => {
    const userId = getUserId({ apiUrl: "https://example.com" });
    expect(userId).toMatch(/^mcp_[a-f0-9]{32}$/);

    // Same value on repeated calls (stable per-process)
    const userId2 = getUserId({ apiUrl: "https://example.com" });
    expect(userId2).toBe(userId);
  });

  it("returns fallback for malformed token", () => {
    const userId = getUserId({ apiUrl: "https://example.com", token: "bad-token" });
    expect(userId).toMatch(/^mcp_/);
  });

  it("returns fallback for token with no user_id or sub", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url");
    const token = `${header}.${payload}.sig`;
    const userId = getUserId({ apiUrl: "https://example.com", token });
    expect(userId).toMatch(/^mcp_/);
  });
});

describe("createSessionId", () => {
  it("returns a UUID", () => {
    const sessionId = createSessionId();
    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("returns unique values on each call", () => {
    const id1 = createSessionId();
    const id2 = createSessionId();
    expect(id1).not.toBe(id2);
  });
});
