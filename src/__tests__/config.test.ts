import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestJWT } from "./helpers.js";

// We need to mock fs before importing config
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

import { readFileSync } from "node:fs";
import { loadConfig } from "../config.js";

const mockedReadFileSync = vi.mocked(readFileSync);

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    // Clear relevant env vars
    delete process.env.SEARCHATLAS_TOKEN;
    delete process.env.SEARCHATLAS_API_KEY;
    delete process.env.SEARCHATLAS_API_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("loads token from environment variable", () => {
    process.env.SEARCHATLAS_TOKEN = createTestJWT();
    mockedReadFileSync.mockImplementation(() => { throw new Error("no file"); });

    const config = loadConfig();
    expect(config.token).toBeDefined();
    expect(config.apiUrl).toBe("https://mcp.searchatlas.com");
  });

  it("loads API key from environment variable", () => {
    process.env.SEARCHATLAS_API_KEY = "test-api-key";
    mockedReadFileSync.mockImplementation(() => { throw new Error("no file"); });

    const config = loadConfig();
    expect(config.apiKey).toBe("test-api-key");
  });

  it("loads token from rc file", () => {
    const token = createTestJWT();
    mockedReadFileSync.mockReturnValue(`SEARCHATLAS_TOKEN=${token}\n`);

    const config = loadConfig();
    expect(config.token).toBe(token);
  });

  it("loads custom API URL from env", () => {
    process.env.SEARCHATLAS_TOKEN = createTestJWT();
    process.env.SEARCHATLAS_API_URL = "https://staging.searchatlas.com/";
    mockedReadFileSync.mockImplementation(() => { throw new Error("no file"); });

    const config = loadConfig();
    expect(config.apiUrl).toBe("https://staging.searchatlas.com"); // trailing slash stripped
  });

  it("loads custom API URL from rc file", () => {
    const token = createTestJWT();
    mockedReadFileSync.mockReturnValue(
      `SEARCHATLAS_TOKEN=${token}\nSEARCHATLAS_API_URL=https://api.searchatlas.com\n`
    );

    const config = loadConfig();
    expect(config.apiUrl).toBe("https://api.searchatlas.com");
  });

  it("rejects non-searchatlas API URLs", () => {
    process.env.SEARCHATLAS_TOKEN = createTestJWT();
    process.env.SEARCHATLAS_API_URL = "https://evil.example.com/";
    mockedReadFileSync.mockImplementation(() => { throw new Error("no file"); });

    expect(() => loadConfig()).toThrow("must point to *.searchatlas.com");
  });

  it("allows localhost API URL when SEARCHATLAS_DEV_MODE=1", () => {
    process.env.SEARCHATLAS_TOKEN = createTestJWT();
    process.env.SEARCHATLAS_API_URL = "http://localhost:8000";
    process.env.SEARCHATLAS_DEV_MODE = "1";
    mockedReadFileSync.mockImplementation(() => { throw new Error("no file"); });

    const config = loadConfig();
    expect(config.apiUrl).toBe("http://localhost:8000");
  });

  it("rejects localhost API URL without SEARCHATLAS_DEV_MODE", () => {
    process.env.SEARCHATLAS_TOKEN = createTestJWT();
    process.env.SEARCHATLAS_API_URL = "http://localhost:8000";
    delete process.env.SEARCHATLAS_DEV_MODE;
    mockedReadFileSync.mockImplementation(() => { throw new Error("no file"); });

    expect(() => loadConfig()).toThrow("SEARCHATLAS_DEV_MODE=1");
  });

  it("throws when no credentials found", () => {
    mockedReadFileSync.mockImplementation(() => { throw new Error("no file"); });

    expect(() => loadConfig()).toThrow("No SearchAtlas credentials found");
  });

  it("skips comment lines and empty lines in rc file", () => {
    const token = createTestJWT();
    mockedReadFileSync.mockReturnValue(
      `# This is a comment\n\nSEARCHATLAS_TOKEN=${token}\n`
    );

    const config = loadConfig();
    expect(config.token).toBe(token);
  });

  it("env vars take priority over rc file", () => {
    const envToken = createTestJWT({ user_id: "env-user" });
    const rcToken = createTestJWT({ user_id: "rc-user" });

    process.env.SEARCHATLAS_TOKEN = envToken;
    mockedReadFileSync.mockReturnValue(`SEARCHATLAS_TOKEN=${rcToken}\n`);

    const config = loadConfig();
    expect(config.token).toBe(envToken);
  });

  it("rejects garbage token values (null string)", () => {
    mockedReadFileSync.mockReturnValue("SEARCHATLAS_TOKEN=null\n");

    expect(() => loadConfig()).toThrow("No SearchAtlas credentials found");
  });

  it("handles rc file with spaces around equals", () => {
    const token = createTestJWT();
    mockedReadFileSync.mockReturnValue(`SEARCHATLAS_TOKEN = ${token}\n`);

    // Note: the current implementation doesn't trim around =, so this tests actual behavior
    // The key becomes "SEARCHATLAS_TOKEN " and value becomes token
    // Actually looking at the code: key = trimmed.slice(0, eqIdx).trim() — it DOES trim
    const config = loadConfig();
    expect(config.token).toBe(token);
  });
});
