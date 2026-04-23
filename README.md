# SearchAtlas MCP Server

[![npm version](https://img.shields.io/npm/v/searchatlas-mcp-server)](https://www.npmjs.com/package/searchatlas-mcp-server)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

**[npm](https://www.npmjs.com/package/searchatlas-mcp-server)** · **[MCP Registry](https://registry.modelcontextprotocol.io)** · **[GitHub](https://github.com/Search-Atlas-Group/searchatlas-mcp-server)**

Connect any MCP-compatible AI client to the **SearchAtlas v2 MCP server** — 500+ tools covering OTTO SEO, PPC, Content Genius, Site Explorer, Google Business Profile, Local SEO, Link Laboratory, Digital PR, LLM Visibility, keyword research, and more.

This package runs as a thin stdio bridge to the hosted v2 MCP server at `https://mcp.searchatlas.com/mcp/` so it works with clients that only speak stdio. Clients with native Streamable-HTTP support can connect to the remote endpoint directly.

Works with **Claude Code, Cursor, Claude Desktop, VS Code, Windsurf, and Zed**.

---

## Setup (3 steps)

### 1. Install & log in

**With npm:**

```bash
npm install -g searchatlas-mcp-server
searchatlas login
```

**With yarn:**

```bash
yarn global add searchatlas-mcp-server
searchatlas login
```

**With pnpm:**

```bash
pnpm add -g searchatlas-mcp-server
searchatlas login
```

**Without installing (npx):**

```bash
npx searchatlas-mcp-server login
```

This opens your browser. After logging in:

1. Press **F12** (or **Cmd+Option+I** on Mac) to open DevTools
2. Go to **Console** tab
3. Run: `localStorage.getItem("token")`
4. Copy the result and paste it into the terminal

The CLI validates your token, saves it, and **prints ready-to-paste configs with your paths auto-detected**.

### 2. Add to your MCP client

#### Claude Code

**macOS / Linux:**

```bash
claude mcp add searchatlas -e SEARCHATLAS_TOKEN=your-token -- npx -y searchatlas-mcp-server
```

**Windows (PowerShell):**

```powershell
claude mcp add searchatlas -e SEARCHATLAS_TOKEN=your-token -- npx.cmd -y searchatlas-mcp-server
```

> **Windows note:** You must use `npx.cmd` instead of `npx`. This is because Claude Code spawns processes directly and Windows requires the `.cmd` extension.

Done. That's it.

#### Cursor

Create `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` for global):

```json
{
  "mcpServers": {
    "searchatlas": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/opt/homebrew/lib/node_modules/searchatlas-mcp-server/dist/index.js"],
      "env": {
        "SEARCHATLAS_TOKEN": "your-token"
      }
    }
  }
}
```

> **Your paths may differ.** Run `which node` and `npm root -g` to find them, or just copy the config that `searchatlas login` printed — it has your exact paths.

#### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "searchatlas": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/opt/homebrew/lib/node_modules/searchatlas-mcp-server/dist/index.js"],
      "env": {
        "SEARCHATLAS_TOKEN": "your-token"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

<details>
<summary><strong>Windsurf</strong></summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "searchatlas": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/opt/homebrew/lib/node_modules/searchatlas-mcp-server/dist/index.js"],
      "env": {
        "SEARCHATLAS_TOKEN": "your-token"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>VS Code (GitHub Copilot)</strong></summary>

Add to `.vscode/mcp.json` in your project:

```json
{
  "servers": {
    "searchatlas": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/opt/homebrew/lib/node_modules/searchatlas-mcp-server/dist/index.js"],
      "env": {
        "SEARCHATLAS_TOKEN": "your-token"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Zed</strong></summary>

Add to Zed `settings.json`:

```json
{
  "context_servers": {
    "searchatlas": {
      "command": {
        "path": "/opt/homebrew/bin/node",
        "args": ["/opt/homebrew/lib/node_modules/searchatlas-mcp-server/dist/index.js"],
        "env": {
          "SEARCHATLAS_TOKEN": "your-token"
        }
      }
    }
  }
}
```

</details>

### 3. Verify

```bash
searchatlas check
```

```
  SearchAtlas MCP Server — Health Check

  ✓ Credential source: ~/.searchatlasrc
  ✓ Config loaded successfully (endpoint: https://mcp.searchatlas.com/mcp)
  ✓ JWT structure valid (expires in 12 days) — user 42
  ✓ MCP handshake succeeded — 587 tools available

  All checks passed — you're ready to go!
```

---

## Why full paths?

macOS GUI apps (Cursor, Claude Desktop, VS Code, Windsurf, Zed) **don't inherit your shell's PATH**, so they can't find `node` or `npx`. Using the full path to `node` and pointing it directly at the installed package avoids `spawn npx ENOENT` and `env: node: No such file` errors entirely.

`searchatlas login` detects your paths automatically and prints configs you can copy-paste.

| How to find your paths | Command |
|------------------------|---------|
| Full path to `node` | `which node` |
| Global npm modules dir | `npm root -g` |

---

## Usage

Just talk naturally. The AI picks the right tool:

```
"What are the top SEO issues for my site?"
"Run a technical SEO audit on example.com"
"Write a blog post about technical SEO best practices"
"Find long-tail keywords for project management software"
"List my projects"
"Show available playbooks and run one"
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `searchatlas login` | Log in, save token, print MCP configs |
| `searchatlas check` | Validate credentials + API connectivity |
| `searchatlas --version` | Print version |
| `searchatlas --help` | Show help |

> All commands also work via `npx searchatlas-mcp-server <command>`.

---

## Tools

Tools are discovered dynamically from the hosted v2 MCP server — your client sees the live catalogue (currently ~587 tools) without needing a package update when new ones ship. The major groups:

| Prefix | Area | Representative tools |
|--------|------|----------------------|
| `otto_*` | OTTO SEO automation (70 tools) | `otto_list_projects`, `otto_add_site`, `otto_get_dynamic_optimizations` |
| `ppc_*` | Google Ads / PPC (76 tools) | `ppc_list_accounts`, `ppc_create_campaign`, `ppc_get_keyword_performance` |
| `cg_*` | Content Genius (74 tools) | `cg_list_articles`, `cg_edit_article_content`, `cg_generate_content_brief` |
| `se_*` | Site Explorer (46 tools) | `se_list_sites`, `se_get_details`, `se_backlinks_overview` |
| `gbp_*` | Google Business Profile (96 tools) | `gbp_get_business_categories`, `gbp_list_citation_submissions` |
| `local_seo_*` | Local SEO heatmaps (19 tools) | `local_seo_heatmaps_get_heatmap_details`, `local_seo_heatmaps_get_rank` |
| `ll_*` | Link Laboratory (24 tools) | `ll_list_projects`, `ll_create_order` |
| `dpr_*` | Digital PR (20 tools) | `dpr_list_campaigns`, `dpr_create_campaign` |
| `llmv_*` | LLM Visibility (30 tools) | `llmv_list_projects`, `llmv_get_visibility_report` |
| `krt_*` | Keyword Rank Tracking (16 tools) | `krt_list_projects`, `krt_track_keywords` |
| `bv_*` | Brand Vault (25 tools) | `bv_list`, `bv_ask`, `bv_update_business_info` |
| `ws_*` | Website Studio (8 tools) | `ws_list_projects`, `ws_create_project` |
| `gsc_*` | Google Search Console (11 tools) | `gsc_get_sites`, `gsc_get_keyword_performance` |
| `social_hub_*` | Social Hub (19 tools) | `social_hub_list_posts`, `social_hub_create_post` |
| `cs_*` | Content Strategy (12 tools) | `cs_list_templates`, `cs_create` |
| `kg_*` | Knowledge Graph (7 tools) | `kg_list`, `kg_create_entity` |
| `dkn_*` | Domain Knowledge Network (7 tools) | `dkn_list_nodes`, `dkn_create` |
| `indexer_*` | Indexer (6 tools) | `indexer_submit_batch`, `indexer_check_status` |
| `rb_*` | Report Builder (3 tools) | `rb_list_reports`, `rb_get_report_details` |
| `pr_*` | Press Release (14 tools) | `pr_list`, `pr_write`, `pr_update` |

Run `searchatlas check` to see the live count, or ask your MCP client to list tools after connecting.

---

## Configuration

### Token priority (first match wins)

1. `SEARCHATLAS_TOKEN` env var
2. `SEARCHATLAS_API_KEY` env var
3. `~/.searchatlasrc` file (created by `searchatlas login`)

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SEARCHATLAS_TOKEN` | Yes | JWT token from SearchAtlas |
| `SEARCHATLAS_API_KEY` | Alternative | API key auth |
| `SEARCHATLAS_API_URL` | No | Custom v2 MCP endpoint (default: `https://mcp.searchatlas.com/mcp`) |

### Native Streamable-HTTP clients

If your MCP client supports Streamable HTTP directly, you can skip this npm package and connect to the remote server in one step:

- **URL**: `https://mcp.searchatlas.com/mcp/`
- **Transport**: Streamable HTTP (JSON-RPC + SSE)
- **Header**: `Authorization: Bearer <SEARCHATLAS_TOKEN>`

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `spawn npx ENOENT` / `env: node: No such file` | Use full paths (see [Why full paths?](#why-full-paths)) or re-run `searchatlas login` |
| `spawn npx ENOENT` on Windows (Claude Code) | Use `npx.cmd` instead of `npx` — see [Claude Code](#claude-code) setup |
| `No SearchAtlas credentials found` | Run `searchatlas login` |
| `Token expired on ...` | Run `searchatlas login` for a fresh token |
| `Authentication failed` (401) | Token expired — run `searchatlas login` |
| `fetch failed` | Check network; run `searchatlas check` |
| Tools not showing up | Restart your MCP client after adding config |

**Still stuck?** Run `searchatlas check`, make sure Node.js >= 18 (`node --version`), or [open an issue](https://github.com/Search-Atlas-Group/searchatlas-mcp-server/issues).

---

## Development

```bash
git clone https://github.com/Search-Atlas-Group/searchatlas-mcp-server.git
cd searchatlas-mcp-server
npm install && npm run build
```

Test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector npx searchatlas-mcp-server
```

---

## Requirements

- **Node.js** >= 18
- A **SearchAtlas account** — [sign up here](https://dashboard.searchatlas.com)

## License

MIT
