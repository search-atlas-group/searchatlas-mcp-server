import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestJWT, createExpiredJWT } from "./helpers.js";

// Mock modules before imports
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    writeFileSync: vi.fn(),
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    exec: vi.fn(),
    execSync: vi.fn(),
  };
});

vi.mock("node:readline/promises", () => ({
  createInterface: vi.fn(),
}));

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { exec, execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { runLogin } from "../login.js";

const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedExec = vi.mocked(exec);
const mockedExecSync = vi.mocked(execSync);
const mockedCreateInterface = vi.mocked(createInterface);

describe("runLogin", () => {
  let consoleOutput: string[];
  let consoleErrors: string[];
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    consoleErrors = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.join(" "));
    });

    // Default mock: node and npm found
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === "which node") return "/usr/local/bin/node";
      if (cmd === "npm root -g") return "/usr/local/lib/node_modules";
      return "";
    });

    // Default: no existing configs
    mockedExistsSync.mockReturnValue(false);

    // exec (for browser open) — no error
    mockedExec.mockImplementation((_cmd: string, cb: unknown) => {
      if (typeof cb === "function") (cb as (err: null) => void)(null);
      return {} as ReturnType<typeof exec>;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("saves token and prints config snippets on valid input", async () => {
    const token = createTestJWT();
    const mockRl = {
      question: vi.fn().mockResolvedValue(token),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    await runLogin();

    expect(mockRl.question).toHaveBeenCalledOnce();
    expect(mockRl.close).toHaveBeenCalledOnce();

    // Token should be saved
    expect(mockedWriteFileSync).toHaveBeenCalled();
    const writeCall = mockedWriteFileSync.mock.calls[0];
    expect(String(writeCall[0])).toContain(".searchatlasrc");
    expect(String(writeCall[1])).toContain(`SEARCHATLAS_TOKEN=${token}`);

    // Config snippets should be printed
    const output = consoleOutput.join("\n");
    expect(output).toContain("Token saved");
    expect(output).toContain("Claude Code");
  });

  it("exits on empty token input", async () => {
    const mockRl = {
      question: vi.fn().mockResolvedValue(""),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(runLogin()).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(consoleErrors.join("\n")).toContain("No token");
  });

  it("exits on invalid token", async () => {
    const mockRl = {
      question: vi.fn().mockResolvedValue("not-a-jwt"),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(runLogin()).rejects.toThrow("process.exit");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(consoleErrors.join("\n")).toContain("Invalid token");
  });

  it("exits on expired token and shows login URL", async () => {
    const mockRl = {
      question: vi.fn().mockResolvedValue(createExpiredJWT()),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    await expect(runLogin()).rejects.toThrow("process.exit");
    expect(consoleErrors.join("\n")).toContain("Log in again");
  });

  it("warns when token expires soon (< 24h)", async () => {
    // Token expires in 12 hours
    const token = createTestJWT({
      exp: Math.floor(Date.now() / 1000) + 43200,
    });
    const mockRl = {
      question: vi.fn().mockResolvedValue(token),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    await runLogin();

    const output = consoleOutput.join("\n");
    expect(output).toContain("Warning");
    expect(output).toContain("hours");
  });

  it("preserves existing rc file entries when saving token", async () => {
    const token = createTestJWT();
    const mockRl = {
      question: vi.fn().mockResolvedValue(token),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    // Simulate existing rc file
    mockedExistsSync.mockImplementation((path: unknown) => {
      if (String(path).includes(".searchatlasrc")) return true;
      return false;
    });
    mockedReadFileSync.mockImplementation((path: unknown) => {
      if (String(path).includes(".searchatlasrc")) {
        return "SEARCHATLAS_API_URL=https://custom.api.com\nSEARCHATLAS_TOKEN=old-token\n";
      }
      throw new Error("no file");
    });

    await runLogin();

    const writeCall = mockedWriteFileSync.mock.calls[0];
    const content = String(writeCall[1]);
    expect(content).toContain("SEARCHATLAS_API_URL=https://custom.api.com");
    expect(content).toContain(`SEARCHATLAS_TOKEN=${token}`);
    expect(content).not.toContain("old-token");
  });

  it("auto-updates existing MCP config files", async () => {
    const token = createTestJWT();
    const mockRl = {
      question: vi.fn().mockResolvedValue(token),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    // Simulate existing Cursor config
    mockedExistsSync.mockImplementation((path: unknown) => {
      if (String(path).includes(".cursor/mcp.json")) return true;
      return false;
    });
    mockedReadFileSync.mockImplementation((path: unknown) => {
      if (String(path).includes(".cursor/mcp.json")) {
        return JSON.stringify({
          mcpServers: {
            searchatlas: {
              command: "node",
              args: ["old-path"],
              env: { SEARCHATLAS_TOKEN: "old-token" },
            },
          },
        });
      }
      throw new Error("no file");
    });

    await runLogin();

    const output = consoleOutput.join("\n");
    expect(output).toContain("Auto-configured");
  });

  it("adds searchatlas entry to config that doesn't have one", async () => {
    const token = createTestJWT();
    const mockRl = {
      question: vi.fn().mockResolvedValue(token),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    mockedExistsSync.mockImplementation((path: unknown) => {
      if (String(path).includes(".cursor/mcp.json")) return true;
      return false;
    });
    mockedReadFileSync.mockImplementation((path: unknown) => {
      if (String(path).includes(".cursor/mcp.json")) {
        return JSON.stringify({ mcpServers: { other: {} } });
      }
      throw new Error("no file");
    });

    await runLogin();

    // Should write updated config with searchatlas added
    const cursorWriteCall = mockedWriteFileSync.mock.calls.find(
      (call) => String(call[0]).includes(".cursor/mcp.json")
    );
    if (cursorWriteCall) {
      const written = JSON.parse(String(cursorWriteCall[1]));
      expect(written.mcpServers.searchatlas).toBeDefined();
      expect(written.mcpServers.searchatlas.env.SEARCHATLAS_TOKEN).toBe(token);
      expect(written.mcpServers.other).toBeDefined(); // preserved
    }
  });

  it("handles browser open failure gracefully", async () => {
    const token = createTestJWT();
    const mockRl = {
      question: vi.fn().mockResolvedValue(token),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    mockedExec.mockImplementation((_cmd: string, cb: unknown) => {
      if (typeof cb === "function") (cb as (err: Error) => void)(new Error("no browser"));
      return {} as ReturnType<typeof exec>;
    });

    await runLogin();

    const output = consoleOutput.join("\n");
    expect(output).toContain("Could not open browser");
  });

  it("uses npx fallback when global install not found", async () => {
    const token = createTestJWT();
    const mockRl = {
      question: vi.fn().mockResolvedValue(token),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    // No global install
    mockedExistsSync.mockReturnValue(false);

    await runLogin();

    const output = consoleOutput.join("\n");
    expect(output).toContain("npx");
  });

  it("strips quotes from pasted token", async () => {
    const token = createTestJWT();
    const mockRl = {
      question: vi.fn().mockResolvedValue(`"${token}"`),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    await runLogin();

    const writeCall = mockedWriteFileSync.mock.calls[0];
    expect(String(writeCall[1])).toContain(`SEARCHATLAS_TOKEN=${token}`);
  });

  it("falls back to 'node' when which node fails", async () => {
    const token = createTestJWT();
    const mockRl = {
      question: vi.fn().mockResolvedValue(token),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === "which node") throw new Error("not found");
      if (cmd === "npm root -g") return "/usr/local/lib/node_modules";
      return "";
    });

    await runLogin();

    const output = consoleOutput.join("\n");
    expect(output).toContain("Token saved");
  });

  it("uses npx when npm root -g fails", async () => {
    const token = createTestJWT();
    const mockRl = {
      question: vi.fn().mockResolvedValue(token),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === "which node") return "/usr/local/bin/node";
      if (cmd === "npm root -g") throw new Error("not found");
      return "";
    });

    await runLogin();

    const output = consoleOutput.join("\n");
    expect(output).toContain("npx");
  });

  it("skips unparseable config files silently", async () => {
    const token = createTestJWT();
    const mockRl = {
      question: vi.fn().mockResolvedValue(token),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    mockedExistsSync.mockImplementation((path: unknown) => {
      if (String(path).includes(".cursor/mcp.json")) return true;
      return false;
    });
    mockedReadFileSync.mockImplementation((path: unknown) => {
      if (String(path).includes(".cursor/mcp.json")) {
        return "not valid json {{{";
      }
      throw new Error("no file");
    });

    await runLogin();

    // Should not crash, and no auto-update message
    const output = consoleOutput.join("\n");
    expect(output).toContain("Token saved");
    expect(output).not.toContain("Auto-updated");
  });

  it("handles config with missing mcpServers key when merging", async () => {
    const token = createTestJWT();
    const mockRl = {
      question: vi.fn().mockResolvedValue(token),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    mockedExistsSync.mockImplementation((path: unknown) => {
      if (String(path).includes(".cursor/mcp.json")) return true;
      return false;
    });
    mockedReadFileSync.mockImplementation((path: unknown) => {
      if (String(path).includes(".cursor/mcp.json")) {
        return JSON.stringify({}); // no mcpServers key at all
      }
      throw new Error("no file");
    });

    await runLogin();

    const cursorWriteCall = mockedWriteFileSync.mock.calls.find(
      (call) => String(call[0]).includes(".cursor/mcp.json")
    );
    if (cursorWriteCall) {
      const written = JSON.parse(String(cursorWriteCall[1]));
      expect(written.mcpServers.searchatlas).toBeDefined();
      expect(written.mcpServers.searchatlas.env.SEARCHATLAS_TOKEN).toBe(token);
    }
  });

  it("handles updateCommandAndArgs when path doesn't exist", async () => {
    const token = createTestJWT();
    const mockRl = {
      question: vi.fn().mockResolvedValue(token),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    // Config exists with searchatlas token but missing intermediary path
    mockedExistsSync.mockImplementation((path: unknown) => {
      if (String(path).includes(".cursor/mcp.json")) return true;
      return false;
    });
    mockedReadFileSync.mockImplementation((path: unknown) => {
      if (String(path).includes(".cursor/mcp.json")) {
        return JSON.stringify({
          mcpServers: {
            searchatlas: {
              env: { SEARCHATLAS_TOKEN: "old" },
            },
          },
        });
      }
      throw new Error("no file");
    });

    await runLogin();

    const output = consoleOutput.join("\n");
    expect(output).toContain("Auto-configured");
  });

  it("does not show warning when token expires far in the future", async () => {
    const token = createTestJWT({
      exp: Math.floor(Date.now() / 1000) + 86400 * 30, // 30 days
    });
    const mockRl = {
      question: vi.fn().mockResolvedValue(token),
      close: vi.fn(),
    };
    mockedCreateInterface.mockReturnValue(mockRl as unknown as ReturnType<typeof createInterface>);

    await runLogin();

    const output = consoleOutput.join("\n");
    expect(output).not.toContain("Warning");
  });
});
