import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { safeGitHubError } from "../github/errors";
import type { GitHubReaderApi } from "../github/reader";

const MAX_RESULT_CHARACTERS = 100_000;
const readOnlyAnnotations = {
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
  readOnlyHint: true,
};

const repository = z
  .string()
  .describe("Repository in owner/name format. It must be selected in a GitHub App installation.");
const page = z.number().int().min(1).default(1).describe("One-based GitHub result page.");
const perPage = z
  .number()
  .int()
  .min(1)
  .max(50)
  .default(20)
  .describe("Number of results to return, capped at 50.");

function serializeResult(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized.length <= MAX_RESULT_CHARACTERS) return serialized;
  return JSON.stringify(
    {
      notice: "The normalized result exceeded the connector output limit.",
      preview: serialized.slice(0, MAX_RESULT_CHARACTERS - 500),
      truncated: true,
    },
    null,
    2,
  );
}

async function run(operation: () => Promise<unknown>) {
  try {
    return { content: [{ text: serializeResult(await operation()), type: "text" as const }] };
  } catch (error) {
    return {
      content: [{ text: safeGitHubError(error), type: "text" as const }],
      isError: true,
    };
  }
}

export function createGitHubMcpServer(reader: GitHubReaderApi): McpServer {
  const server = new McpServer({ name: "github-mcp", version: "0.1.0" });

  server.registerTool(
    "list_repositories",
    {
      annotations: readOnlyAnnotations,
      description: "List repositories selected in every installation of the configured GitHub App.",
      inputSchema: {},
    },
    async () => run(() => reader.listRepositories()),
  );

  server.registerTool(
    "search_code",
    {
      annotations: readOnlyAnnotations,
      description: "Search code within one installed GitHub repository.",
      inputSchema: {
        page,
        perPage,
        query: z.string().min(1).describe("GitHub code-search query without repo, org, or user qualifiers."),
        repository,
      },
    },
    async ({ page: requestedPage, perPage: requestedPerPage, query, repository: requestedRepo }) =>
      run(() =>
        reader.searchCode(requestedRepo, query, {
          page: requestedPage,
          perPage: requestedPerPage,
        }),
      ),
  );

  server.registerTool(
    "list_directory",
    {
      annotations: readOnlyAnnotations,
      description: "List files and directories at one path and optional git ref.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).default(20),
        offset: z.number().int().min(0).default(0),
        path: z.string().default("").describe("Directory path relative to the repository root."),
        ref: z.string().min(1).optional().describe("Branch, tag, or commit SHA; defaults to the default branch."),
        repository,
      },
    },
    async ({ limit, offset, path, ref, repository: requestedRepo }) =>
      run(() => reader.listDirectory(requestedRepo, path, { limit, offset, ...(ref ? { ref } : {}) })),
  );

  server.registerTool(
    "get_file",
    {
      annotations: readOnlyAnnotations,
      description: "Retrieve a UTF-8 text file, optionally limited to a line range.",
      inputSchema: {
        endLine: z.number().int().min(1).optional(),
        path: z.string().min(1).describe("File path relative to the repository root."),
        ref: z.string().min(1).optional().describe("Branch, tag, or commit SHA; defaults to the default branch."),
        repository,
        startLine: z.number().int().min(1).optional(),
      },
    },
    async ({ endLine, path, ref, repository: requestedRepo, startLine }) =>
      run(() =>
        reader.getFile(requestedRepo, path, {
          ...(endLine ? { endLine } : {}),
          ...(ref ? { ref } : {}),
          ...(startLine ? { startLine } : {}),
        }),
      ),
  );

  server.registerTool(
    "list_commits",
    {
      annotations: readOnlyAnnotations,
      description: "List commits, optionally filtered by ref, path, or ISO-8601 date range.",
      inputSchema: {
        page,
        path: z.string().min(1).optional(),
        perPage,
        ref: z.string().min(1).optional(),
        repository,
        since: z.string().datetime().optional(),
        until: z.string().datetime().optional(),
      },
    },
    async ({ page: requestedPage, path, perPage: requestedPerPage, ref, repository: requestedRepo, since, until }) =>
      run(() =>
        reader.listCommits(requestedRepo, {
          page: requestedPage,
          perPage: requestedPerPage,
          ...(path ? { path } : {}),
          ...(ref ? { ref } : {}),
          ...(since ? { since } : {}),
          ...(until ? { until } : {}),
        }),
      ),
  );

  server.registerTool(
    "get_commit",
    {
      annotations: readOnlyAnnotations,
      description: "Get one commit and a bounded summary of its changed files and patches.",
      inputSchema: { repository, sha: z.string().min(1) },
    },
    async ({ repository: requestedRepo, sha }) => run(() => reader.getCommit(requestedRepo, sha)),
  );

  server.registerTool(
    "list_pull_requests",
    {
      annotations: readOnlyAnnotations,
      description: "List pull requests in an installed repository.",
      inputSchema: {
        base: z.string().min(1).optional(),
        head: z.string().min(1).optional(),
        page,
        perPage,
        repository,
        state: z.enum(["open", "closed", "all"]).default("open"),
      },
    },
    async ({ base, head, page: requestedPage, perPage: requestedPerPage, repository: requestedRepo, state }) =>
      run(() =>
        reader.listPullRequests(requestedRepo, {
          page: requestedPage,
          perPage: requestedPerPage,
          state,
          ...(base ? { base } : {}),
          ...(head ? { head } : {}),
        }),
      ),
  );

  server.registerTool(
    "get_pull_request",
    {
      annotations: readOnlyAnnotations,
      description: "Get pull request metadata, files, reviews, and conversation comments.",
      inputSchema: { number: z.number().int().min(1), repository },
    },
    async ({ number, repository: requestedRepo }) =>
      run(() => reader.getPullRequest(requestedRepo, number)),
  );

  server.registerTool(
    "get_pull_request_diff",
    {
      annotations: readOnlyAnnotations,
      description: "Get a pull request unified diff, bounded to the connector output limit.",
      inputSchema: { number: z.number().int().min(1), repository },
    },
    async ({ number, repository: requestedRepo }) =>
      run(() => reader.getPullRequestDiff(requestedRepo, number)),
  );

  server.registerTool(
    "list_issues",
    {
      annotations: readOnlyAnnotations,
      description: "List issues while excluding pull requests returned by GitHub's shared issues API.",
      inputSchema: {
        assignee: z.string().min(1).optional(),
        labels: z.string().min(1).optional().describe("Comma-separated label names."),
        page,
        perPage,
        repository,
        since: z.string().datetime().optional(),
        state: z.enum(["open", "closed", "all"]).default("open"),
      },
    },
    async ({ assignee, labels, page: requestedPage, perPage: requestedPerPage, repository: requestedRepo, since, state }) =>
      run(() =>
        reader.listIssues(requestedRepo, {
          page: requestedPage,
          perPage: requestedPerPage,
          state,
          ...(assignee ? { assignee } : {}),
          ...(labels ? { labels } : {}),
          ...(since ? { since } : {}),
        }),
      ),
  );

  server.registerTool(
    "get_issue",
    {
      annotations: readOnlyAnnotations,
      description: "Get one issue and up to 50 conversation comments.",
      inputSchema: { number: z.number().int().min(1), repository },
    },
    async ({ number, repository: requestedRepo }) => run(() => reader.getIssue(requestedRepo, number)),
  );

  return server;
}
