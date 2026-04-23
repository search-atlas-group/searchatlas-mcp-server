import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestJWT, createExpiredJWT } from "./helpers.js";

// Mock modules before importing the SUT.
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

vi.mock("../config.js", () => ({
  loadConfig: vi.fn(),
}));

// Stub the proxy transport factory so the test never touches the network.
vi.mock("../proxy.js", () => ({
  createUpstreamTransport: vi.fn(() => ({})),
}));

// Control what the MCP client does during connect() and listTools().
const mockConnect = vi.fn<(transport: unknown) => Promise<void>>();
const mockListTools = vi.fn<() => Promise<{ tools: Array<{ name: string }> }>>();
const mockClose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  class MockClient {
    connect = mockConnect;
    listTools = mockListTools;
    close = mockClose;
  }
  return { Client: MockClient };
});

import { existsSync } from "node:fs";
import { loadConfig } from "../config.js";
import { runCheck } from "../check.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedLoadConfig = vi.mocked(loadConfig);

describe("runCheck", () => {
  const originalEnv = { ...process.env };
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    mockClose.mockResolvedValue(undefined);
    consoleOutput = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.join(" "));
    });
    delete process.env.SEARCHATLAS_TOKEN;
    delete process.env.SEARCHATLAS_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  function successfulProbe(toolCount = 587): void {
    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({
      tools: Array.from({ length: toolCount }, (_, i) => ({ name: `tool_${i}` })),
    });
  }

  it("passes all checks with valid token and a working MCP handshake", async () => {
    process.env.SEARCHATLAS_TOKEN = createTestJWT();
    mockedExistsSync.mockReturnValue(false);
    mockedLoadConfig.mockReturnValue({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: createTestJWT(),
    });
    successfulProbe(587);

    await runCheck();

    const output = consoleOutput.join("\n");
    expect(output).toContain("✓");
    expect(output).toContain("SEARCHATLAS_TOKEN env var");
    expect(output).toContain("Config loaded");
    expect(output).toContain("https://mcp.searchatlas.com/mcp");
    expect(output).toContain("JWT structure valid");
    expect(output).toContain("MCP handshake succeeded");
    expect(output).toContain("587 tools");
    expect(output).toContain("All checks passed");
  });

  it("uses singular 'tool' when exactly one is available", async () => {
    process.env.SEARCHATLAS_TOKEN = createTestJWT();
    mockedExistsSync.mockReturnValue(false);
    mockedLoadConfig.mockReturnValue({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: createTestJWT(),
    });
    successfulProbe(1);

    await runCheck();

    const output = consoleOutput.join("\n");
    expect(output).toContain("1 tool available");
  });

  it("reports credential source from rc file", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedLoadConfig.mockReturnValue({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: createTestJWT(),
    });
    successfulProbe();

    await runCheck();

    const output = consoleOutput.join("\n");
    expect(output).toContain("searchatlasrc");
  });

  it("reports API key credential source", async () => {
    process.env.SEARCHATLAS_API_KEY = "test-key";
    mockedExistsSync.mockReturnValue(false);
    mockedLoadConfig.mockReturnValue({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      apiKey: "test-key",
    });
    successfulProbe();

    await runCheck();

    const output = consoleOutput.join("\n");
    expect(output).toContain("SEARCHATLAS_API_KEY");
    expect(output).toContain("API key authentication");
  });

  it("fails when no credentials found", async () => {
    mockedExistsSync.mockReturnValue(false);
    mockedLoadConfig.mockReturnValue({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: createTestJWT(),
    });
    successfulProbe();

    await runCheck();

    const output = consoleOutput.join("\n");
    expect(output).toContain("✗");
    expect(output).toContain("No credentials found");
  });

  it("fails and returns early when config fails to load", async () => {
    process.env.SEARCHATLAS_TOKEN = "some-token";
    mockedExistsSync.mockReturnValue(false);
    mockedLoadConfig.mockImplementation(() => {
      throw new Error("Config load failed");
    });

    await runCheck();

    const output = consoleOutput.join("\n");
    expect(output).toContain("Config failed to load");
    expect(output).not.toContain("MCP handshake");
  });

  it("reports expired JWT", async () => {
    process.env.SEARCHATLAS_TOKEN = "x";
    mockedExistsSync.mockReturnValue(false);
    mockedLoadConfig.mockReturnValue({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: createExpiredJWT(),
    });
    successfulProbe();

    await runCheck();

    const output = consoleOutput.join("\n");
    expect(output).toContain("JWT invalid");
    expect(output).toContain("expired");
  });

  it("classifies 401 auth errors as auth rejection", async () => {
    process.env.SEARCHATLAS_TOKEN = "x";
    mockedExistsSync.mockReturnValue(false);
    mockedLoadConfig.mockReturnValue({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: createTestJWT(),
    });
    mockConnect.mockRejectedValue(new Error("HTTP 401 Unauthorized"));

    await runCheck();

    const output = consoleOutput.join("\n");
    expect(output).toContain("rejected authentication");
  });

  it("classifies 'Unauthorized' errors as auth rejection", async () => {
    process.env.SEARCHATLAS_TOKEN = "x";
    mockedExistsSync.mockReturnValue(false);
    mockedLoadConfig.mockReturnValue({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: createTestJWT(),
    });
    mockConnect.mockRejectedValue(new Error("Unauthorized session"));

    await runCheck();

    const output = consoleOutput.join("\n");
    expect(output).toContain("rejected authentication");
  });

  it("reports an unreachable server with the underlying message", async () => {
    process.env.SEARCHATLAS_TOKEN = "x";
    mockedExistsSync.mockReturnValue(false);
    mockedLoadConfig.mockReturnValue({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: createTestJWT(),
    });
    mockConnect.mockRejectedValue(new Error("ECONNREFUSED"));

    await runCheck();

    const output = consoleOutput.join("\n");
    expect(output).toContain("MCP server unreachable");
    expect(output).toContain("ECONNREFUSED");
  });

  it("handles non-Error rejection values", async () => {
    process.env.SEARCHATLAS_TOKEN = "x";
    mockedExistsSync.mockReturnValue(false);
    mockedLoadConfig.mockReturnValue({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: createTestJWT(),
    });
    mockConnect.mockRejectedValue("string error");

    await runCheck();

    const output = consoleOutput.join("\n");
    expect(output).toContain("MCP server unreachable");
    expect(output).toContain("string error");
  });

  it("shows JWT expiry days and user ID when token has both", async () => {
    process.env.SEARCHATLAS_TOKEN = "x";
    mockedExistsSync.mockReturnValue(false);
    const token = createTestJWT({
      user_id: "test-user-42",
      exp: Math.floor(Date.now() / 1000) + 30 * 86400,
    });
    mockedLoadConfig.mockReturnValue({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token,
    });
    successfulProbe();

    await runCheck();

    const output = consoleOutput.join("\n");
    expect(output).toContain("JWT structure valid");
    expect(output).toContain("days");
    expect(output).toContain("user");
  });

  it("shows singular 'day' for 1 day expiry", async () => {
    process.env.SEARCHATLAS_TOKEN = "x";
    mockedExistsSync.mockReturnValue(false);
    const token = createTestJWT({
      user_id: "u1",
      exp: Math.floor(Date.now() / 1000) + 86400 + 100,
    });
    mockedLoadConfig.mockReturnValue({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token,
    });
    successfulProbe();

    await runCheck();

    const output = consoleOutput.join("\n");
    expect(output).toContain("1 day)");
  });

  it("shows config load error message from non-Error type", async () => {
    process.env.SEARCHATLAS_TOKEN = "x";
    mockedExistsSync.mockReturnValue(false);
    mockedLoadConfig.mockImplementation(() => {
      throw "string config error";
    });

    await runCheck();

    const output = consoleOutput.join("\n");
    expect(output).toContain("Config failed to load");
    expect(output).toContain("string config error");
  });

  it("does not print expiry when the token has no exp claim", async () => {
    process.env.SEARCHATLAS_TOKEN = "x";
    mockedExistsSync.mockReturnValue(false);
    mockedLoadConfig.mockReturnValue({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: createTestJWT({ exp: undefined }),
    });
    successfulProbe();

    await runCheck();

    const output = consoleOutput.join("\n");
    expect(output).toContain("JWT structure valid");
    expect(output).not.toContain("expires in");
  });

  it("swallows errors from client.close()", async () => {
    process.env.SEARCHATLAS_TOKEN = createTestJWT();
    mockedExistsSync.mockReturnValue(false);
    mockedLoadConfig.mockReturnValue({
      apiUrl: "https://mcp.searchatlas.com/mcp",
      token: createTestJWT(),
    });
    successfulProbe(10);
    mockClose.mockRejectedValue(new Error("close failed"));

    await expect(runCheck()).resolves.not.toThrow();
    const output = consoleOutput.join("\n");
    expect(output).toContain("MCP handshake succeeded");
  });
});
