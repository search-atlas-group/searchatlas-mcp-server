/**
 * Configuration — loads settings from environment variables or ~/.searchatlasrc file.
 *
 * Auth priority:
 *   1. SEARCHATLAS_TOKEN    → sent as Authorization: Bearer header (preferred)
 *   2. SEARCHATLAS_API_KEY  → sent as X-API-Key header (alternative)
 *
 * Token lookup order:
 *   1. Environment variable (SEARCHATLAS_TOKEN or SEARCHATLAS_API_KEY)
 *   2. ~/.searchatlasrc file (one-time setup)
 */

import { readFileSync, statSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { sanitizeToken } from "./utils/token.js";

export interface Config {
  apiUrl: string;
  apiKey?: string;
  token?: string;
}

/** Read token from ~/.searchatlasrc if it exists. */
function loadRcFile(): Record<string, string> {
  try {
    const rcPath = join(homedir(), ".searchatlasrc");

    // Auto-fix insecure permissions on rc file (token exposure risk on shared filesystems).
    // Enforce 0o600 rather than just warning — the file contains credentials.
    try {
      const st = statSync(rcPath);
      if (typeof st.mode === "number" && (st.mode & 0o077) !== 0) {
        try {
          chmodSync(rcPath, 0o600);
          process.stderr.write(
            `  Fixed: ${rcPath} permissions set to 600 (was ${(st.mode & 0o777).toString(8)}).\n`
          );
        } catch {
          process.stderr.write(
            `  Warning: ${rcPath} is accessible by other users (mode ${(st.mode & 0o777).toString(8)}).\n` +
            `  Could not auto-fix. Run: chmod 600 ${rcPath}\n`
          );
        }
      }
    } catch { /* statSync may fail if file doesn't exist yet — loadRcFile handles that */ }

    const content = readFileSync(rcPath, "utf-8");
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        vars[key] = val;
      }
    }
    return vars;
  } catch {
    return {};
  }
}

const DEFAULT_API_URL = "https://mcp.searchatlas.com/mcp";

/**
 * Validate that an API URL is allowed.
 * Only *.searchatlas.com origins are permitted to prevent credential exfiltration.
 */
function validateApiUrl(raw: string): string {
  const cleaned = raw.replace(/\/+$/, "").trim();
  // Strip surrounding quotes (common in .env / rc files)
  const unquoted = (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
                   (cleaned.startsWith("'") && cleaned.endsWith("'"))
    ? cleaned.slice(1, -1).trim()
    : cleaned;

  try {
    const parsed = new URL(unquoted);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error(`Invalid API URL protocol: ${parsed.protocol}`);
    }
    const host = parsed.hostname.toLowerCase();
    // Reject non-ASCII hostnames (prevents unicode/IDN homograph attacks)
    if (!/^[\x20-\x7e]+$/.test(host)) {
      throw new Error(`SEARCHATLAS_API_URL contains non-ASCII characters: ${host}`);
    }
    if (host === "searchatlas.com" || host.endsWith(".searchatlas.com")) {
      return unquoted.replace(/\/+$/, "");
    }
    // Allow localhost only when explicitly opted in via SEARCHATLAS_DEV_MODE
    if (host === "localhost" || host === "127.0.0.1") {
      if (process.env.SEARCHATLAS_DEV_MODE === "1") {
        return unquoted.replace(/\/+$/, "");
      }
      throw new Error(
        `Localhost API URLs require SEARCHATLAS_DEV_MODE=1. Got: ${unquoted}`
      );
    }
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error(`Invalid SEARCHATLAS_API_URL: ${unquoted}`);
    }
    throw e;
  }
  throw new Error(
    `SEARCHATLAS_API_URL must point to *.searchatlas.com. Got: ${unquoted}`
  );
}

export function loadConfig(): Config {
  const rc = loadRcFile();

  const rawApiUrl =
    process.env.SEARCHATLAS_API_URL ?? rc.SEARCHATLAS_API_URL ?? DEFAULT_API_URL;
  const apiUrl = validateApiUrl(rawApiUrl);

  // Sanitize tokens — strips quotes, trims whitespace, rejects garbage
  const token = sanitizeToken(process.env.SEARCHATLAS_TOKEN ?? rc.SEARCHATLAS_TOKEN) ?? undefined;
  const apiKey = sanitizeToken(process.env.SEARCHATLAS_API_KEY ?? rc.SEARCHATLAS_API_KEY) ?? undefined;

  if (!apiKey && !token) {
    throw new Error(
      "No SearchAtlas credentials found.\n\n" +
      "  Quick fix — run one of these:\n\n" +
      "    npx searchatlas-mcp-server login     (interactive setup)\n" +
      "    export SEARCHATLAS_TOKEN=your-token   (env var)\n\n" +
      "  Or create ~/.searchatlasrc:\n" +
      "    echo 'SEARCHATLAS_TOKEN=your-token' > ~/.searchatlasrc"
    );
  }

  return { apiUrl, apiKey, token };
}
