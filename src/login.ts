/**
 * Interactive login flow — opens the browser, prompts for token, validates it,
 * saves to ~/.searchatlasrc, auto-updates existing MCP config files,
 * and displays config snippets for clients that weren't auto-updated.
 */

import { createInterface } from 'node:readline/promises';
import { writeFileSync, existsSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { validateToken } from './utils/token.js';

/** Reject paths containing shell metacharacters or non-printable chars. Spaces disallowed to prevent shell splitting. */
const SAFE_PATH_RE = /^[a-zA-Z0-9/_.\-\\:]+$/;

const RC_PATH = join(homedir(), '.searchatlasrc');
const LOGIN_URL = 'https://dashboard.searchatlas.com/login';

function openBrowser(url: string): void {
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start'
        : 'xdg-open';

  const args = process.platform === 'win32' ? ['', url] : [url];

  const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
  child.unref();
  child.on('error', () => {
    console.log(
      `\nCould not open browser automatically. Please visit:\n  ${url}\n`,
    );
  });
}

/**
 * Validate that a resolved path is safe to write into IDE config files.
 * Must be absolute, exist on disk, and contain no shell metacharacters.
 */
function validateResolvedPath(p: string): string | null {
  const trimmed = p.trim();
  if (!trimmed) return null;
  if (!isAbsolute(trimmed)) return null;
  if (!SAFE_PATH_RE.test(trimmed)) return null;
  if (!existsSync(trimmed)) return null;
  return trimmed;
}

function resolveNodePath(): string {
  // Use the current process's own Node binary — avoids PATH manipulation attacks entirely.
  // Never fall back to which/where (shell-based PATH lookup).
  const execPath = process.execPath;
  if (execPath && isAbsolute(execPath) && SAFE_PATH_RE.test(execPath)) {
    return execPath;
  }
  return 'node';
}

function resolveGlobalRoot(): string | null {
  try {
    // Use execFileSync with explicit args to avoid shell injection.
    // execFileSync does NOT invoke a shell — the command and args are passed directly.
    const raw = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf-8',
      timeout: 5_000,
    }).trim();
    if (!raw || !isAbsolute(raw) || !SAFE_PATH_RE.test(raw)) return null;
    return raw;
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

  if (process.platform === 'win32') {
    return { command: 'npx.cmd', args: ['-y', 'searchatlas-mcp-server'] };
  }

  // Validate dirname(nodePath) to prevent PATH injection into npx binary reference
  const nodeDir = dirname(nodePath);
  const npxCandidate = `${nodeDir}/npx`;
  if (isAbsolute(nodeDir) && SAFE_PATH_RE.test(npxCandidate) && existsSync(npxCandidate)) {
    return { command: npxCandidate, args: ['-y', 'searchatlas-mcp-server'] };
  }

  return { command: 'npx', args: ['-y', 'searchatlas-mcp-server'] };
}

/**
 * Auto-update existing MCP config files with the new token.
 * Creates global configs (Cursor, Claude Desktop, Windsurf) if they don't exist.
 * Project-level configs are only updated if they already exist.
 */
function autoUpdateConfigs(token: string): string[] {
  const { command, args } = resolveGuiConfig();
  const updated: string[] = [];
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

  // Global MCP config file locations only.
  // Project-local configs (.cursor/mcp.json, .vscode/mcp.json) are intentionally
  // excluded to prevent tokens from being committed to git repositories.
  const configFiles: Array<{
    path: string;
    label: string;
    template: Record<string, unknown>;
    tokenPath: string[];
  }> = [
    // Cursor — global
    {
      path: join(home, '.cursor', 'mcp.json'),
      label: 'Cursor (global)',
      template: mcpServersConfig,
      tokenPath: ['mcpServers', 'searchatlas', 'env', 'SEARCHATLAS_TOKEN'],
    },
    // Claude Desktop — macOS / Windows
    // On Windows, only trust APPDATA if it's under the user's home directory
    {
      // Always use a fixed path under the user's home dir — never trust APPDATA env var
      // which could be manipulated to point to an attacker-controlled directory.
      path: process.platform === 'win32'
        ? join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json')
        : join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      label: 'Claude Desktop',
      template: mcpServersConfig,
      tokenPath: ['mcpServers', 'searchatlas', 'env', 'SEARCHATLAS_TOKEN'],
    },
    // Windsurf
    {
      path: join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      label: 'Windsurf',
      template: mcpServersConfig,
      tokenPath: ['mcpServers', 'searchatlas', 'env', 'SEARCHATLAS_TOKEN'],
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
        // Ensure token-bearing config files are owner-readable only
        try { chmodSync(config.path, 0o600); } catch { /* best effort */ }
      } else {
        // Global config doesn't exist — create directory + file with secure permissions
        mkdirSync(dirname(config.path), { recursive: true, mode: 0o700 });
        writeFileSync(config.path, JSON.stringify(config.template, null, 2) + '\n', { mode: 0o600 });
        updated.push(`${config.label} (created)`);
      }
    } catch (err) {
      // Log failure to stderr so the user knows, but don't break the login flow
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`  Warning: Could not update ${config.label} (${config.path}): ${msg}\n`);
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

/** Mask a token for display, showing only the last 4 characters. */
function maskToken(token: string): string {
  if (token.length <= 8) return '****';
  return '****' + token.slice(-4);
}

function printConfigSnippets(token: string, updatedFiles: string[]): void {
  const { command, args } = resolveGuiConfig();
  const masked = maskToken(token);

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
  // Token is referenced as $SEARCHATLAS_TOKEN to avoid exposing it in shell history
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  console.log('  ── Claude Code ──────────────────────────────\n');
  console.log(
    `  claude mcp add searchatlas -e SEARCHATLAS_TOKEN=$SEARCHATLAS_TOKEN -- ${npxCmd} -y searchatlas-mcp-server\n`,
  );
  console.log(
    `  (Token saved to ~/.searchatlasrc — set the env var first:\n` +
    `   export SEARCHATLAS_TOKEN=$(grep SEARCHATLAS_TOKEN ~/.searchatlasrc | cut -d= -f2))\n`,
  );

  if (!hasCursor) {
    console.log('  ── Cursor (~/.cursor/mcp.json) ──────────────\n');
    console.log(
      `${indent(JSON.stringify(
        { mcpServers: { searchatlas: { command, args, env: { SEARCHATLAS_TOKEN: masked } } } },
        null,
        2,
      ))}\n`,
    );
    console.log('  (Replace the masked token with your actual token from ~/.searchatlasrc)\n');
  }

  if (!hasClaudeDesktop) {
    console.log('  ── Claude Desktop ───────────────────────────\n');
    console.log(
      `${indent(JSON.stringify(
        { mcpServers: { searchatlas: { command, args, env: { SEARCHATLAS_TOKEN: masked } } } },
        null,
        2,
      ))}\n`,
    );
    console.log('  (Replace the masked token with your actual token from ~/.searchatlasrc)\n');
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
