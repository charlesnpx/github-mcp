import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const excludedDirectories = new Set([
  ".git",
  ".idea",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
]);

async function projectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!excludedDirectories.has(entry.name)) {
        files.push(...(await projectFiles(path.join(directory, entry.name))));
      }
    } else if (entry.isFile()) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

describe("account-neutral repository content", () => {
  it("does not embed the originating operator's account identities", async () => {
    const forbidden = [
      ["charles", "npx"].join(""),
      ["Charles", "Anderson"].join("."),
      ["NPX", "Innovation"].join(""),
    ];
    const findings: string[] = [];

    for (const file of await projectFiles(process.cwd())) {
      const content = await readFile(file, "utf8");
      const normalized = content.toLowerCase();
      for (const identity of forbidden) {
        if (normalized.includes(identity.toLowerCase())) {
          findings.push(`${path.relative(process.cwd(), file)} contains a forbidden identity`);
        }
      }
    }

    expect(findings).toEqual([]);
  });
});
