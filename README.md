# SearchAtlas MCP Server

[![npm version](https://img.shields.io/npm/v/searchatlas-mcp-server)](https://www.npmjs.com/package/searchatlas-mcp-server)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

**[npm](https://www.npmjs.com/package/searchatlas-mcp-server)** · **[MCP Registry](https://registry.modelcontextprotocol.io)** · **[GitHub](https://github.com/Search-Atlas-Group/searchatlas-mcp-server)**

Connect any MCP-compatible AI client to the **SearchAtlas AI Agent platform** — 10 specialized SEO & marketing agents, project management, playbook automation, and more.

Works with **Claude Code, Cursor, Claude Desktop, VS Code, Windsurf, and Zed**.

---

## Hosted deployment

A hosted deployment is available on [Fronteir AI](https://fronteir.ai/mcp/searchatlas).

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
  ✓ Config loaded successfully
  ✓ JWT structure valid (expires in 12 days) — user 42
  ✓ API reachable and authenticated

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

## Tools (16)

### Agents (10)

| Tool | What It Does |
|------|-------------|
| `searchatlas_orchestrator` | Routes queries to the best specialist agent |
| `searchatlas_otto_seo` | Technical SEO fixes, schema markup, optimizations |
| `searchatlas_ppc` | Google Ads campaigns, bids, performance |
| `searchatlas_content` | Blog posts, landing pages, optimized copy |
| `searchatlas_site_explorer` | Crawl data, backlinks, competitive intelligence |
| `searchatlas_gbp` | Google Business Profile, reviews, local SEO |
| `searchatlas_authority_building` | Link building, digital PR, outreach |
| `searchatlas_llm_visibility` | Track AI model references to your brand |
| `searchatlas_keywords` | Search volume, difficulty, SERP analysis |
| `searchatlas_website_studio` | Page builder, layouts, site structure |

### Management (6)

| Tool | What It Does |
|------|-------------|
| `searchatlas_list_projects` | List projects (paginated, searchable) |
| `searchatlas_create_project` | Create project by domain |
| `searchatlas_list_conversations` | List chat sessions by agent |
| `searchatlas_list_artifacts` | List generated content and reports |
| `searchatlas_list_playbooks` | Browse automation playbooks |
| `searchatlas_run_playbook` | Run a playbook on a project |

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
| `SEARCHATLAS_API_URL` | No | Custom API URL (default: `https://mcp.searchatlas.com`) |

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
