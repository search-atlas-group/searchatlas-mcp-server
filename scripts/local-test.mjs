#!/usr/bin/env node
/**
 * Broader local test for the stdio proxy.
 *
 * Spawns `node dist/index.js` exactly like Claude Code / Cursor would, then
 * exercises a realistic series of MCP calls across multiple tool categories.
 * This is the highest-fidelity local test we can run without shipping the
 * package to an MCP client.
 *
 * Usage:
 *   node scripts/local-test.mjs
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function loadToken() {
  if (process.env.SEARCHATLAS_TOKEN) return process.env.SEARCHATLAS_TOKEN;
  const rc = readFileSync(join(homedir(), ".searchatlasrc"), "utf8");
  const m = rc.match(/^SEARCHATLAS_TOKEN=(.+)$/m);
  if (!m) throw new Error("no SEARCHATLAS_TOKEN");
  return m[1].trim();
}

const TOKEN = loadToken();
const REPO_ROOT = new URL("..", import.meta.url).pathname;

const child = spawn(process.execPath, [join(REPO_ROOT, "dist/index.js")], {
  env: { ...process.env, SEARCHATLAS_TOKEN: TOKEN },
  stdio: ["pipe", "pipe", "pipe"],
});

const pending = new Map();
let nextId = 1;

createInterface({ input: child.stdout }).on("line", (line) => {
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

function send(method, params, timeoutMs = 30_000) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return Promise.race([
    new Promise((resolve) => pending.set(id, resolve)),
    delay(timeoutMs).then(() => {
      throw new Error(`timeout after ${timeoutMs}ms on ${method}`);
    }),
  ]);
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

const checks = [];
function record(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${name}${detail ? " — " + detail : ""}`);
}
function section(title) {
  console.log(`\n▶ ${title}`);
}

let exitCode = 0;
try {
  // ── 1. MCP handshake ────────────────────────────────────────────────────
  section("Handshake");
  const init = await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "local-test", version: "1.0" },
  });
  record(
    "initialize",
    !init.error && init.result?.serverInfo?.name === "searchatlas",
    `server=${init.result?.serverInfo?.name} v${init.result?.serverInfo?.version}`
  );
  record(
    "advertises tools capability",
    !!init.result?.capabilities?.tools
  );
  record(
    "advertises prompts capability",
    !!init.result?.capabilities?.prompts
  );
  record(
    "advertises resources capability",
    !!init.result?.capabilities?.resources
  );
  notify("notifications/initialized", {});

  // ── 2. tools/list ───────────────────────────────────────────────────────
  section("Tool discovery");
  const list = await send("tools/list", {});
  const tools = list.result?.tools ?? [];
  record("tools/list returns a catalog", tools.length > 100, `${tools.length} tools`);

  // Count tools per prefix (same grouping as README/server.json)
  const byPrefix = {};
  for (const t of tools) {
    const prefix = t.name.split("_")[0];
    byPrefix[prefix] = (byPrefix[prefix] ?? 0) + 1;
  }
  const expectedPrefixes = ["otto", "ppc", "cg", "se", "gbp", "bv", "ll", "dpr", "llmv", "krt"];
  for (const p of expectedPrefixes) {
    record(`${p}_* tools present`, (byPrefix[p] ?? 0) > 0, `${byPrefix[p] ?? 0} tools`);
  }

  // Every tool must have an inputSchema object
  const missingSchema = tools.filter((t) => !t.inputSchema || typeof t.inputSchema !== "object");
  record("every tool has an inputSchema", missingSchema.length === 0, `${missingSchema.length} missing`);

  // ── 3. Real read-only tool calls ────────────────────────────────────────
  section("Read-only tool calls");
  const readOnlyCalls = [
    { name: "bv_list", arguments: { page: 1, page_size: 2 } },
    { name: "otto_list_projects", arguments: { page: 1, page_size: 2 } },
    { name: "ll_list_projects", arguments: { page: 1, page_size: 2 } },
    { name: "krt_list_projects", arguments: { page: 1, page_size: 2 } },
    { name: "llmv_list_projects", arguments: { page: 1, page_size: 2 } },
  ];
  for (const call of readOnlyCalls) {
    try {
      const res = await send("tools/call", call);
      const content = res.result?.content ?? [];
      const isError = res.result?.isError === true;
      if (res.error) {
        record(`call ${call.name}`, false, `RPC error ${JSON.stringify(res.error).slice(0, 120)}`);
      } else if (isError) {
        const first = content[0];
        const txt = (first && typeof first === "object" && "text" in first) ? first.text : "";
        record(`call ${call.name}`, false, `tool error: ${String(txt).slice(0, 120)}`);
      } else {
        record(`call ${call.name}`, true, `${content.length} content item(s)`);
      }
    } catch (err) {
      record(`call ${call.name}`, false, err.message);
    }
  }

  // ── 4. Unknown tool handling ────────────────────────────────────────────
  section("Error handling");
  const bad = await send("tools/call", {
    name: "this_does_not_exist_xyz",
    arguments: {},
  });
  const errored = !!bad.error || bad.result?.isError === true;
  record("unknown tool produces an error", errored);

  // Missing required argument (bv_get_details needs a UUID or hostname)
  const missingArg = await send("tools/call", {
    name: "bv_get_details",
    arguments: {},
  });
  record(
    "missing-argument call is rejected, not crashed",
    !!missingArg.error || missingArg.result?.isError === true
  );

  // ── 5. Concurrent calls ─────────────────────────────────────────────────
  section("Concurrency");
  const parallel = await Promise.all(
    Array.from({ length: 5 }, () =>
      send("tools/call", { name: "bv_list", arguments: { page: 1, page_size: 1 } })
    )
  );
  const allOk = parallel.every((r) => !r.error && r.result?.isError !== true);
  record("5 parallel tool calls succeed", allOk);

  // ── 6. Prompts and resources (proxied through to v2) ────────────────────
  section("Prompts + resources");
  try {
    const prompts = await send("prompts/list", {});
    record(
      "prompts/list succeeds",
      !prompts.error,
      `${prompts.result?.prompts?.length ?? 0} prompts`
    );
  } catch (err) {
    record("prompts/list succeeds", false, err.message);
  }
  try {
    const resources = await send("resources/list", {});
    record(
      "resources/list succeeds",
      !resources.error,
      `${resources.result?.resources?.length ?? 0} resources`
    );
  } catch (err) {
    record("resources/list succeeds", false, err.message);
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  section("Summary");
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`  ${passed}/${checks.length} checks passed, ${failed} failed`);
  if (failed > 0) {
    exitCode = 1;
    console.log("\nFailures:");
    for (const c of checks.filter((c) => !c.ok)) {
      console.log(`  ✗ ${c.name}: ${c.detail}`);
    }
  } else {
    console.log("\n  ✦ All local checks passed — ready to publish / connect real clients.\n");
  }
} catch (err) {
  console.error(`\nFATAL: ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  child.stdin.end();
  child.kill();
  if (stderr.trim()) {
    console.error(`\n--- proxy stderr ---\n${stderr.trim()}`);
  }
  process.exit(exitCode);
}
