/**
 * Interactive login flow — opens the browser, prompts for token, validates it,
 * saves to ~/.searchatlasrc, auto-updates existing MCP config files,
 * and displays config snippets for clients that weren't auto-updated.
 */

import { createInterface } from 'node:readline/promises';
import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { exec, execSync } from 'node:child_process';
import { validateToken } from './utils/token.js';

const RC_PATH = join(homedir(), '.searchatlasrc');
const LOGIN_URL = 'https://dashboard.searchatlas.com/login';

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? `open "${url}"`
      : process.platform === 'win32'
        ? `start "${url}"`
        : `xdg-open "${url}"`;

  exec(cmd, (err) => {
    if (err) {
      console.log(
        `\nCould not open browser automatically. Please visit:\n  ${url}\n`,
      );
    }
  });
}

function resolveNodePath(): string {
  try {
    const cmd = process.platform === 'win32' ? 'where node' : 'which node';
    const result = execSync(cmd, { encoding: 'utf-8' }).trim();
    // `where` on Windows may return multiple lines — take the first
    return result.split('\n')[0].trim();
  } catch {
    return 'node';
  }
}

function resolveGlobalRoot(): string | null {
  try {
    return execSync('npm root -g', { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function saveToken(token: string): void {
  const lines: string[] = [];

  if (existsSync(RC_PATH)) {
    const existing = readFileSync(RC_PATH, 'utf-8');
    for (const line of existing.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('SEARCHATLAS_TOKEN=')) continue;
      if (trimmed) lines.push(trimmed);
    }
  }

  lines.push(`SEARCHATLAS_TOKEN=${token}`);
  writeFileSync(RC_PATH, lines.join('\n') + '\n', { mode: 0o600 });
}

/** Resolve the command + args for GUI app configs. */
function resolveGuiConfig(): { command: string; args: string[] } {
  const nodePath = resolveNodePath();
  const globalRoot = resolveGlobalRoot();
  const sep = process.platform === 'win32' ? '\\' : '/';
  const entryPoint = globalRoot
    ? `${globalRoot}${sep}searchatlas-mcp-server${sep}dist${sep}index.js`
    : null;
  const hasGlobalInstall = entryPoint && existsSync(entryPoint);

  if (hasGlobalInstall) {
    return { command: nodePath, args: [entryPoint!] };
  }

  const npxBin = process.platform === 'win32' ? 'npx.cmd' : `${dirname(nodePath)}/npx`;
  return { command: npxBin, args: ['-y', 'searchatlas-mcp-server'] };
}

/**
 * Auto-update existing MCP config files with the new token.
 * Creates global configs (Cursor, Claude Desktop, Windsurf) if they don't exist.
 * Project-level configs are only updated if they already exist.
 */
function autoUpdateConfigs(token: string): string[] {
  const { command, args } = resolveGuiConfig();
  const updated: string[] = [];
  const cwd = process.cwd();
  const home = homedir();

  // Standard mcpServers shape (Cursor, Claude Desktop, Windsurf)
  const mcpServersConfig = {
    mcpServers: {
      searchatlas: {
        command,
        args,
        env: { SEARCHATLAS_TOKEN: token },
      },
    },
  };

  // VS Code uses "servers" instead of "mcpServers"
  const vscodeConfig = {
    servers: {
      searchatlas: {
        command,
        args,
        env: { SEARCHATLAS_TOKEN: token },
      },
    },
  };

  // All known MCP config file locations
  const configFiles: Array<{
    path: string;
    label: string;
    template: Record<string, unknown>;
    tokenPath: string[];
    global: boolean;
  }> = [
    // Cursor — project-level
    {
      path: join(cwd, '.cursor', 'mcp.json'),
      label: 'Cursor (project)',
      template: mcpServersConfig,
      tokenPath: ['mcpServers', 'searchatlas', 'env', 'SEARCHATLAS_TOKEN'],
      global: false,
    },
    // Cursor — global
    {
      path: join(home, '.cursor', 'mcp.json'),
      label: 'Cursor (global)',
      template: mcpServersConfig,
      tokenPath: ['mcpServers', 'searchatlas', 'env', 'SEARCHATLAS_TOKEN'],
      global: true,
    },
    // Claude Desktop — macOS / Windows
    {
      path: process.platform === 'win32'
        ? join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
        : join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      label: 'Claude Desktop',
      template: mcpServersConfig,
      tokenPath: ['mcpServers', 'searchatlas', 'env', 'SEARCHATLAS_TOKEN'],
      global: true,
    },
    // Windsurf
    {
      path: join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      label: 'Windsurf',
      template: mcpServersConfig,
      tokenPath: ['mcpServers', 'searchatlas', 'env', 'SEARCHATLAS_TOKEN'],
      global: true,
    },
    // VS Code — project-level
    {
      path: join(cwd, '.vscode', 'mcp.json'),
      label: 'VS Code (project)',
      template: vscodeConfig,
      tokenPath: ['servers', 'searchatlas', 'env', 'SEARCHATLAS_TOKEN'],
      global: false,
    },
  ];

  for (const config of configFiles) {
    try {
      if (existsSync(config.path)) {
        // File exists — update searchatlas entry
        const existing = JSON.parse(readFileSync(config.path, 'utf-8'));
        const didUpdate = setNestedToken(existing, config.tokenPath, token);

        if (didUpdate) {
          // Also update command + args in case they changed
          updateCommandAndArgs(existing, config, command, args);
          writeFileSync(config.path, JSON.stringify(existing, null, 2) + '\n');
          updated.push(config.label);
        } else {
          // searchatlas entry doesn't exist yet — add it
          mergeSearchatlasEntry(existing, config, command, args, token);
          writeFileSync(config.path, JSON.stringify(existing, null, 2) + '\n');
          updated.push(`${config.label} (added)`);
        }
      } else if (config.global) {
        // Global config doesn't exist — create directory + file
        mkdirSync(dirname(config.path), { recursive: true });
        writeFileSync(config.path, JSON.stringify(config.template, null, 2) + '\n');
        updated.push(`${config.label} (created)`);
      }
    } catch {
      // Skip files we can't read/parse/create — don't break the login flow
    }
  }

  return updated;
}

/** Walk a nested object path and set the token value. Returns true if path existed. */
function setNestedToken(obj: Record<string, unknown>, path: string[], value: string): boolean {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (current[key] && typeof current[key] === 'object') {
      current = current[key] as Record<string, unknown>;
    } else {
      return false;
    }
  }
  const lastKey = path[path.length - 1];
  if (lastKey in current) {
    current[lastKey] = value;
    return true;
  }
  return false;
}

/** Update command and args for an existing searchatlas entry. */
function updateCommandAndArgs(
  obj: Record<string, unknown>,
  config: { tokenPath: string[] },
  command: string,
  args: string[],
): void {
  // Navigate to the searchatlas server object (2 levels up from SEARCHATLAS_TOKEN)
  const serverPath = config.tokenPath.slice(0, -2); // e.g. ['mcpServers', 'searchatlas']
  let current: Record<string, unknown> = obj;
  for (const key of serverPath) {
    if (current[key] && typeof current[key] === 'object') {
      current = current[key] as Record<string, unknown>;
    } else {
      return;
    }
  }
  current['command'] = command;
  current['args'] = args;
}

/** Add a searchatlas entry to an existing config that doesn't have one. */
function mergeSearchatlasEntry(
  obj: Record<string, unknown>,
  config: { tokenPath: string[] },
  command: string,
  args: string[],
  token: string,
): void {
  const rootKey = config.tokenPath[0]; // 'mcpServers' or 'servers'
  if (!obj[rootKey] || typeof obj[rootKey] !== 'object') {
    obj[rootKey] = {};
  }
  const root = obj[rootKey] as Record<string, unknown>;
  root['searchatlas'] = {
    command,
    args,
    env: { SEARCHATLAS_TOKEN: token },
  };
}

function indent(json: string): string {
  return json
    .split('\n')
    .map((l) => '  ' + l)
    .join('\n');
}

function printConfigSnippets(token: string, updatedFiles: string[]): void {
  const { command, args } = resolveGuiConfig();

  // Show which files were auto-configured
  if (updatedFiles.length > 0) {
    console.log('\n  Auto-configured MCP clients:\n');
    for (const file of updatedFiles) {
      console.log(`    ✓ ${file}`);
    }
    console.log('');
  }

  // Determine which clients were already auto-configured
  const joined = updatedFiles.join(' ');
  const hasCursor = joined.includes('Cursor');
  const hasClaudeDesktop = joined.includes('Claude Desktop');

  // Claude Code — always manual (one-liner, no config file)
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  console.log('  ── Claude Code ──────────────────────────────\n');
  console.log(
    `  claude mcp add searchatlas -e SEARCHATLAS_TOKEN=${token} -- ${npxCmd} -y searchatlas-mcp-server\n`,
  );

  if (!hasCursor) {
    console.log('  ── Cursor (~/.cursor/mcp.json) ──────────────\n');
    console.log(
      `${indent(JSON.stringify(
        { mcpServers: { searchatlas: { command, args, env: { SEARCHATLAS_TOKEN: token } } } },
        null,
        2,
      ))}\n`,
    );
  }

  if (!hasClaudeDesktop) {
    console.log('  ── Claude Desktop ───────────────────────────\n');
    console.log(
      `${indent(JSON.stringify(
        { mcpServers: { searchatlas: { command, args, env: { SEARCHATLAS_TOKEN: token } } } },
        null,
        2,
      ))}\n`,
    );
  }

  console.log('  ✦ Done! Restart your MCP client to pick up the new token.\n');
}

export async function runLogin(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n  ✦ SearchAtlas MCP Server — Login\n');
  console.log('  Opening SearchAtlas in your browser...\n');
  openBrowser(LOGIN_URL);

  console.log('  After logging in, grab your token:');
  console.log('    1. Open DevTools (F12 / Cmd+Option+I) → Console');
  console.log('    2. Run: localStorage.getItem("token")');
  console.log('    3. Copy the result (with or without quotes)\n');

  const raw = (await rl.question('  Paste your token here: ')).trim();
  rl.close();

  if (!raw) {
    console.error('\n  No token provided. Aborting.\n');
    process.exit(1);
  }

  const result = validateToken(raw);

  if (!result.valid) {
    console.error(`\n  Invalid token: ${result.error}`);
    if (result.expiresAt) {
      console.error(`  Log in again at ${LOGIN_URL} to get a fresh token.`);
    }
    console.error('');
    process.exit(1);
  }

  if (result.expiresAt) {
    const hoursLeft = (result.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
    if (hoursLeft < 24) {
      console.log(
        `\n  Warning: Token expires in ${Math.round(hoursLeft)} hours ` +
        `(${result.expiresAt.toLocaleDateString()} ${result.expiresAt.toLocaleTimeString()}).`,
      );
    }
  }

  // 1. Save to ~/.searchatlasrc
  saveToken(result.token!);
  console.log(`\n  ✓ Token saved to ${RC_PATH}`);

  // 2. Auto-update any existing MCP config files
  const updatedFiles = autoUpdateConfigs(result.token!);

  // 3. Print snippets for clients not yet configured
  printConfigSnippets(result.token!, updatedFiles);
}
