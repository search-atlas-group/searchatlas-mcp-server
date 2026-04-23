#!/usr/bin/env node
/**
 * End-to-end smoke test for the stdio proxy.
 *
 * Spawns `node dist/index.js`, performs a real MCP handshake over stdio,
 * runs tools/list and one read-only tools/call, and reports results.
 *
 * Usage:
 *   SEARCHATLAS_TOKEN=... node scripts/smoke-test.mjs
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function loadToken() {
  if (process.env.SEARCHATLAS_TOKEN) return process.env.SEARCHATLAS_TOKEN;
  try {
    const rc = readFileSync(join(homedir(), ".searchatlasrc"), "utf8");
    const m = rc.match(/^SEARCHATLAS_TOKEN=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* fall through */ }
  throw new Error("no SEARCHATLAS_TOKEN in env or ~/.searchatlasrc");
}

const TOKEN = loadToken();

const child = spawn(process.execPath, ["dist/index.js"], {
  env: { ...process.env, SEARCHATLAS_TOKEN: TOKEN },
  stdio: ["pipe", "pipe", "pipe"],
});

const pending = new Map();
let nextId = 1;
const rl = createInterface({ input: child.stdout });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id != null && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

let stderr = "";
child.stderr.on("data", (b) => { stderr += b.toString(); });

function send(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolve) => pending.set(id, resolve));
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

let exitCode = 0;
try {
  const init = await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke-test", version: "1.0" },
  });
  if (init.error) throw new Error(`initialize failed: ${JSON.stringify(init.error)}`);
  console.log(`✓ initialize: server=${init.result.serverInfo.name} v${init.result.serverInfo.version}`);
  console.log(`  capabilities: ${Object.keys(init.result.capabilities ?? {}).join(", ") || "(none)"}`);

  notify("notifications/initialized", {});

  const list = await send("tools/list", {});
  if (list.error) throw new Error(`tools/list failed: ${JSON.stringify(list.error)}`);
  const tools = list.result.tools;
  console.log(`✓ tools/list: ${tools.length} tools`);
  console.log(`  first five: ${tools.slice(0, 5).map((t) => t.name).join(", ")}`);

  // Pick a known read-only tool; bv_list takes no required arguments.
  const call = await send("tools/call", {
    name: "bv_list",
    arguments: { page: 1, page_size: 1 },
  });
  if (call.error) throw new Error(`tools/call failed: ${JSON.stringify(call.error)}`);
  const content = call.result.content ?? [];
  console.log(`✓ tools/call bv_list: ${content.length} content item(s), isError=${call.result.isError ?? false}`);
  if (content[0]?.type === "text") {
    const preview = content[0].text.slice(0, 200).replace(/\s+/g, " ");
    console.log(`  preview: ${preview}${content[0].text.length > 200 ? "…" : ""}`);
  }

  // Unknown tool: expect an MCP-level error response (tool-level error is fine).
  const bad = await send("tools/call", {
    name: "this_tool_does_not_exist_xyz",
    arguments: {},
  });
  if (bad.error || bad.result?.isError) {
    console.log("✓ unknown tool call surfaced as an error (as expected)");
  } else {
    console.log("✗ unknown tool call unexpectedly succeeded");
    exitCode = 1;
  }

  console.log("\nAll smoke checks passed.");
} catch (err) {
  console.error(`\nFAIL: ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  child.stdin.end();
  child.kill();
  if (stderr.trim()) {
    console.error(`\n--- proxy stderr ---\n${stderr.trim()}`);
  }
  process.exit(exitCode);
}
