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

const VERSION = "1.3.0";

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
    SEARCHATLAS_API_URL   API base URL (default: https://mcp.searchatlas.com)

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
  const { runLogin } = await import("./login.js");
  await runLogin();
}
// check
else if (args.includes("check")) {
  const { runCheck } = await import("./check.js");
  await runCheck();
}
// default: start MCP server
else {
  try {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    const { loadConfig } = await import("./config.js");
    const { registerAllTools } = await import("./tools/register-all.js");

    const config = loadConfig();

    const server = new McpServer({
      name: "searchatlas",
      version: VERSION,
    });

    registerAllTools(server, config);

    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (err) {
    // Write to stderr — stdout is reserved for MCP protocol transport
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\nSearchAtlas MCP Server failed to start:\n\n${msg}\n\n`);
    process.exit(1);
  }
}
