/**
 * Health check CLI — validates the full authentication chain against the
 * SearchAtlas v2 MCP server.
 *
 * Usage: searchatlas check
 *
 * Steps:
 *   1. Credential source found?
 *   2. Config loads without error?
 *   3. JWT valid + not expired?
 *   4. MCP handshake succeeds (Streamable HTTP initialize + tools/list)?
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { loadConfig, type Config } from "./config.js";
import { validateToken } from "./utils/token.js";
import { createUpstreamTransport } from "./proxy.js";

const PASS = "  ✓";
const FAIL = "  ✗";

function pass(msg: string): void {
  console.log(`${PASS} ${msg}`);
}

function fail(msg: string, fix?: string): void {
  console.log(`${FAIL} ${msg}`);
  if (fix) console.log(`    → ${fix}`);
}

/** Probe the remote v2 MCP server: connect, list tools, disconnect. */
async function probeRemoteMcp(config: Config): Promise<{ toolCount: number }> {
  const client = new Client(
    { name: "searchatlas-check", version: "1.0" },
    { capabilities: {} }
  );
  const transport = createUpstreamTransport(config);
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    return { toolCount: tools.length };
  } finally {
    await client.close().catch(() => { /* best effort */ });
  }
}

export async function runCheck(): Promise<void> {
  console.log("\n  ✦ SearchAtlas MCP Server — Health Check\n");

  let config: Config;
  let allPassed = true;

  // Step 1: Credential source
  const rcPath = join(homedir(), ".searchatlasrc");
  const hasRc = existsSync(rcPath);
  const hasEnvToken = !!process.env.SEARCHATLAS_TOKEN;
  const hasEnvKey = !!process.env.SEARCHATLAS_API_KEY;

  if (hasEnvToken) {
    pass("Credential source: SEARCHATLAS_TOKEN env var");
  } else if (hasEnvKey) {
    pass("Credential source: SEARCHATLAS_API_KEY env var");
  } else if (hasRc) {
    pass(`Credential source: ${rcPath}`);
  } else {
    fail(
      "No credentials found",
      "Run: npx searchatlas-mcp-server login",
    );
    allPassed = false;
  }

  // Step 2: Config loads
  try {
    config = loadConfig();
    pass(`Config loaded successfully (endpoint: ${config.apiUrl})`);
  } catch (err) {
    fail(
      "Config failed to load",
      err instanceof Error ? err.message.split("\n")[0] : String(err),
    );
    printResult(false);
    return;
  }

  // Step 3: JWT validation (only for token auth, not API key)
  if (config.token) {
    const result = validateToken(config.token);
    if (result.valid) {
      let msg = "JWT structure valid";
      if (result.expiresAt) {
        const daysLeft = Math.floor(
          (result.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        );
        msg += ` (expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""})`;
      }
      if (result.userId) {
        msg += ` — user ${result.userId}`;
      }
      pass(msg);
    } else {
      fail(`JWT invalid: ${result.error}`, "Run: npx searchatlas-mcp-server login");
      allPassed = false;
    }
  } else if (config.apiKey) {
    pass("Using API key authentication (JWT check skipped)");
  }

  // Step 4: MCP handshake + tools/list against the remote v2 server
  try {
    const { toolCount } = await probeRemoteMcp(config);
    pass(`MCP handshake succeeded — ${toolCount} tool${toolCount === 1 ? "" : "s"} available`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The SDK surfaces 401/403 as an UnauthorizedError-like message.
    if (/401|403|unauthor/i.test(msg)) {
      fail(
        "MCP server rejected authentication",
        "Your token may be expired. Run: npx searchatlas-mcp-server login",
      );
    } else {
      fail("MCP server unreachable", msg);
    }
    allPassed = false;
  }

  printResult(allPassed);
}

function printResult(allPassed: boolean): void {
  console.log("");
  if (allPassed) {
    console.log("  ✦ All checks passed — you're ready to go!\n");
  } else {
    console.log("  Some checks failed. Fix the issues above and run again:\n");
    console.log("    npx searchatlas-mcp-server check\n");
  }
}
