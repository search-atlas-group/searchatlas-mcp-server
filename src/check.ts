/**
 * Health check CLI — validates the full authentication chain.
 *
 * Usage: searchatlas check
 *
 * Steps:
 *   1. Credential source found?
 *   2. Config loads without error?
 *   3. JWT valid + not expired?
 *   4. API reachable?
 *   5. Auth accepted?
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadConfig, type Config } from "./config.js";
import { validateToken } from "./utils/token.js";
import { getAuthHeaders } from "./utils/auth.js";

const PASS = "  ✓";
const FAIL = "  ✗";

function pass(msg: string): void {
  console.log(`${PASS} ${msg}`);
}

function fail(msg: string, fix?: string): void {
  console.log(`${FAIL} ${msg}`);
  if (fix) console.log(`    → ${fix}`);
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
    pass("Config loaded successfully");
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

  // Step 4 & 5: API reachable + auth accepted
  try {
    const url = `${config.apiUrl}/api/agent/projects/?page=1&page_size=1`;
    const res = await fetch(url, {
      method: "GET",
      headers: getAuthHeaders(config),
    });

    if (res.status === 401 || res.status === 403) {
      fail(
        `API returned ${res.status} — authentication rejected`,
        "Your token may be expired. Run: npx searchatlas-mcp-server login",
      );
      allPassed = false;
    } else if (res.ok) {
      pass("API reachable and authenticated");
    } else {
      fail(
        `API returned unexpected status ${res.status}`,
        "Check your network or try again later",
      );
      allPassed = false;
    }
  } catch (err) {
    fail(
      "API unreachable",
      err instanceof Error ? err.message : "Check your network connection",
    );
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
