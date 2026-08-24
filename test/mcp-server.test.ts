import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitHubReaderApi } from "../src/github/reader";
import { createGitHubMcpServer } from "../src/mcp/server";

function fakeReader(): GitHubReaderApi {
  return {
    getCommit: vi.fn(async () => ({ sha: "abc123" })),
    getFile: vi.fn(async () => ({ content: "example" })),
    getIssue: vi.fn(async () => ({ number: 1 })),
    getPullRequest: vi.fn(async () => ({ number: 1 })),
    getPullRequestDiff: vi.fn(async () => ({ diff: "example" })),
    listCommits: vi.fn(async () => ({ commits: [] })),
    listDirectory: vi.fn(async () => ({ entries: [] })),
    listIssues: vi.fn(async () => ({ issues: [] })),
    listPullRequests: vi.fn(async () => ({ pullRequests: [] })),
    listRepositories: vi.fn(async () => ({ repositories: [] })),
    searchCode: vi.fn(async () => ({ items: [] })),
  };
}

const closeCallbacks: Array<() => Promise<void>> = [];

async function connect(reader: GitHubReaderApi): Promise<Client> {
  const server = createGitHubMcpServer(reader);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closeCallbacks.push(async () => {
    await Promise.allSettled([client.close(), server.close()]);
  });
  return client;
}

function textResult(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content[0];
  if (!content || content.type !== "text") throw new Error("Expected a text tool result");
  return content.text;
}

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map(async (close) => close()));
});

describe("GitHub MCP server", () => {
  it("exposes the complete read-only tool set", async () => {
    const client = await connect(fakeReader());
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      "list_repositories",
      "search_code",
      "list_directory",
      "get_file",
      "list_commits",
      "get_commit",
      "list_pull_requests",
      "get_pull_request",
      "get_pull_request_diff",
      "list_issues",
      "get_issue",
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
        readOnlyHint: true,
      });
    }
  });

  it("validates inputs, applies defaults, and delegates to the reader", async () => {
    const reader = fakeReader();
    const client = await connect(reader);

    const result = await client.callTool({
      arguments: { repository: "example-owner/example-repo" },
      name: "list_issues",
    });

    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textResult(result))).toEqual({ issues: [] });
    expect(reader.listIssues).toHaveBeenCalledWith("example-owner/example-repo", {
      page: 1,
      perPage: 20,
      state: "open",
    });
  });

  it("sanitizes reader failures at the tool boundary", async () => {
    const reader = fakeReader();
    vi.mocked(reader.searchCode).mockRejectedValueOnce(
      new Error("upstream contained github_pat_sensitive-value"),
    );
    const client = await connect(reader);
    const result = await client.callTool({
      arguments: {
        query: "example",
        repository: "example-owner/example-repo",
      },
      name: "search_code",
    });

    expect(result.isError).toBe(true);
    expect(textResult(result)).toBe("Unexpected GitHub integration error");
  });

  it("bounds serialized tool output", async () => {
    const reader = fakeReader();
    vi.mocked(reader.listRepositories).mockResolvedValueOnce({ value: "x".repeat(110_000) });
    const client = await connect(reader);
    const result = await client.callTool({ arguments: {}, name: "list_repositories" });
    const parsed = JSON.parse(textResult(result)) as { preview: string; truncated: boolean };

    expect(parsed.truncated).toBe(true);
    expect(parsed.preview.length).toBeLessThan(100_000);
  });
});
