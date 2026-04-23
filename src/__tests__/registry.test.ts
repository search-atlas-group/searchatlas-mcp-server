/**
 * Replaces the old types/agents.test.ts (which asserted the static agent
 * catalogue) and register-all.test.ts (which asserted every tool wire-up).
 * The v2 catalogue is dynamic, so here we verify the static metadata we
 * publish to the MCP registry (server.json + package.json) stays coherent
 * with the code.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const serverJson = JSON.parse(
  readFileSync(join(root, "server.json"), "utf-8")
) as {
  name: string;
  version: string;
  description: string;
  packages: Array<{
    identifier: string;
    version: string;
    transport: { type: string };
    environmentVariables: Array<{
      name: string;
      isRequired?: boolean;
      isSecret?: boolean;
      description: string;
    }>;
  }>;
  remotes?: Array<{ type: string; url: string }>;
  tools: Array<{ name: string; description: string }>;
};

const packageJson = JSON.parse(
  readFileSync(join(root, "package.json"), "utf-8")
) as { name: string; version: string; bin: Record<string, string> };

describe("MCP registry (server.json)", () => {
  it("declares the SearchAtlas namespace and a non-empty description", () => {
    expect(serverJson.name).toBe("io.github.search-atlas-group/searchatlas");
    expect(serverJson.description.length).toBeGreaterThan(20);
  });

  it("has a package entry whose identifier matches package.json", () => {
    const pkg = serverJson.packages.find(
      (p) => p.identifier === packageJson.name
    );
    expect(pkg).toBeDefined();
    expect(pkg!.transport.type).toBe("stdio");
  });

  it("keeps server.json package version in sync with package.json", () => {
    const pkg = serverJson.packages[0];
    expect(pkg.version).toBe(packageJson.version);
    expect(serverJson.version).toBe(packageJson.version);
  });

  it("declares SEARCHATLAS_TOKEN as a required secret", () => {
    const env = serverJson.packages[0].environmentVariables.find(
      (e) => e.name === "SEARCHATLAS_TOKEN"
    );
    expect(env).toBeDefined();
    expect(env!.isRequired).toBe(true);
    expect(env!.isSecret).toBe(true);
  });

  it("declares SEARCHATLAS_API_KEY as an optional secret", () => {
    const env = serverJson.packages[0].environmentVariables.find(
      (e) => e.name === "SEARCHATLAS_API_KEY"
    );
    expect(env).toBeDefined();
    expect(env!.isRequired ?? false).toBe(false);
    expect(env!.isSecret).toBe(true);
  });

  it("declares SEARCHATLAS_API_URL as optional, non-secret, pointing at /mcp", () => {
    const env = serverJson.packages[0].environmentVariables.find(
      (e) => e.name === "SEARCHATLAS_API_URL"
    );
    expect(env).toBeDefined();
    expect(env!.isSecret).toBe(false);
    expect(env!.description).toContain("https://mcp.searchatlas.com/mcp");
  });

  it("advertises a Streamable-HTTP remote at the v2 endpoint", () => {
    expect(serverJson.remotes).toBeDefined();
    const http = serverJson.remotes!.find((r) => r.type === "streamable-http");
    expect(http).toBeDefined();
    expect(http!.url).toBe("https://mcp.searchatlas.com/mcp/");
  });

  it("lists only tools following the v2 naming convention", () => {
    // v2 uses lowercase_snake_case names with a category prefix.
    const bad = serverJson.tools.filter(
      (t) => !/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(t.name)
    );
    expect(bad).toEqual([]);
    // Sanity: we shouldn't accidentally re-introduce v1 names.
    const legacyPrefix = serverJson.tools.filter((t) =>
      t.name.startsWith("searchatlas_")
    );
    expect(legacyPrefix).toEqual([]);
  });

  it("has no duplicate tool names and non-empty descriptions", () => {
    const names = new Set<string>();
    for (const t of serverJson.tools) {
      expect(names.has(t.name), `duplicate: ${t.name}`).toBe(false);
      names.add(t.name);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });
});

describe("package.json wiring", () => {
  it("exposes both bin names", () => {
    expect(packageJson.bin["searchatlas-mcp-server"]).toBe("dist/index.js");
    expect(packageJson.bin.searchatlas).toBe("dist/index.js");
  });
});
