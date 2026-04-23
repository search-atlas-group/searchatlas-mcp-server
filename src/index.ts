#!/usr/bin/env node

/**
 * SearchAtlas MCP Server — CLI entry point.
 *
 * Commands:
 *   (default)          Start the MCP server (stdio transport)
 *   login              Interactive login + config helper
 *   check              Validate credentials and API connectivity
 *   --help / -h        Show usage information
 *   --version / -v     Print version
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json") as { version: string };

const args = process.argv.slice(2);

// --help / -h / help
if (args.includes("--help") || args.includes("-h") || args.includes("help")) {
  console.log(`
  ✦ SearchAtlas MCP Server v${VERSION}

  Usage:
    searchatlas-mcp-server              Start the MCP server (stdio)
    searchatlas-mcp-server login        Interactive login + save token
    searchatlas-mcp-server check        Verify credentials and API connection
    searchatlas-mcp-server --version    Print version
    searchatlas-mcp-server --help       Show this help

  Environment variables:
    SEARCHATLAS_TOKEN     JWT token (preferred)
    SEARCHATLAS_API_KEY   API key (alternative)
    SEARCHATLAS_API_URL   API base URL (default: https://mcp.searchatlas.com/mcp)

  Config file:
    ~/.searchatlasrc      Auto-read on startup (created by 'login' command)

  More info: https://www.npmjs.com/package/searchatlas-mcp-server
`);
  process.exit(0);
}

// --version / -v
if (args.includes("--version") || args.includes("-v")) {
  console.log(VERSION);
  process.exit(0);
}

// login
if (args.includes("login")) {
  try {
    const { runLogin } = await import("./login.js");
    await runLogin();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== "process.exit") {
      process.stderr.write(`\nLogin failed:\n\n${msg}\n\n`);
      process.exit(1);
    }
  }
}
// check
else if (args.includes("check")) {
  try {
    const { runCheck } = await import("./check.js");
    await runCheck();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\nHealth check failed:\n\n${msg}\n\n`);
    process.exit(1);
  }
}
// default: start MCP proxy (stdio → Streamable HTTP → v2 remote server)
else {
  try {
    const { loadConfig } = await import("./config.js");
    const { startProxy } = await import("./proxy.js");

    const config = loadConfig();
    await startProxy(config, { name: "searchatlas", version: VERSION });
  } catch (err) {
    // Write to stderr — stdout is reserved for MCP protocol transport
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\nSearchAtlas MCP Server failed to start:\n\n${msg}\n\n`);
    process.exit(1);
  }
}
