import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";
import type { GitHubAppConfig } from "../types";
import { ConnectorInputError } from "./errors";
import { parseRepository, validateCodeSearchQuery } from "./repository";

export interface PageOptions {
  page: number;
  perPage: number;
}

export interface FileOptions {
  endLine?: number;
  ref?: string;
  startLine?: number;
}

export interface CommitListOptions extends PageOptions {
  path?: string;
  ref?: string;
  since?: string;
  until?: string;
}

export interface PullRequestListOptions extends PageOptions {
  base?: string;
  head?: string;
  state: "all" | "closed" | "open";
}

export interface IssueListOptions extends PageOptions {
  assignee?: string;
  labels?: string;
  since?: string;
  state: "all" | "closed" | "open";
}

export interface DirectoryOptions {
  limit: number;
  offset: number;
  ref?: string;
}

export interface GitHubReaderApi {
  getCommit(repository: string, sha: string): Promise<unknown>;
  getFile(repository: string, path: string, options: FileOptions): Promise<unknown>;
  getIssue(repository: string, number: number): Promise<unknown>;
  getPullRequest(repository: string, number: number): Promise<unknown>;
  getPullRequestDiff(repository: string, number: number): Promise<unknown>;
  listCommits(repository: string, options: CommitListOptions): Promise<unknown>;
  listDirectory(repository: string, path: string, options: DirectoryOptions): Promise<unknown>;
  listIssues(repository: string, options: IssueListOptions): Promise<unknown>;
  listPullRequests(repository: string, options: PullRequestListOptions): Promise<unknown>;
  listRepositories(): Promise<unknown>;
  searchCode(repository: string, query: string, options: PageOptions): Promise<unknown>;
}

function pageInfo(page: number, perPage: number, returned: number) {
  return { nextPage: returned === perPage ? page + 1 : null, page, perPage, returned };
}

function truncateText(value: string, maximum = 100_000) {
  if (value.length <= maximum) return { text: value, truncated: false };
  return { text: value.slice(0, maximum), truncated: true };
}

function repositorySummary(repository: {
  default_branch: string | null;
  full_name: string;
  html_url: string;
  private: boolean;
}) {
  return {
    defaultBranch: repository.default_branch,
    fullName: repository.full_name,
    private: repository.private,
    url: repository.html_url,
  };
}

function appAuthenticator(config: GitHubAppConfig) {
  return createAppAuth({ appId: config.appId, privateKey: config.privateKey });
}

export class GitHubReader implements GitHubReaderApi {
  constructor(private readonly config: GitHubAppConfig) {}

  private async appClient() {
    const auth = appAuthenticator(this.config);
    const appAuthentication = await auth({ type: "app" });
    return { auth, octokit: new Octokit({ auth: appAuthentication.token }) };
  }

  private async repositoryClient(repository: string) {
    const coordinates = parseRepository(repository);
    const { auth, octokit: app } = await this.appClient();
    const installation = await app.rest.apps.getRepoInstallation({
      owner: coordinates.owner,
      repo: coordinates.repo,
    });
    const authentication = await auth({
      installationId: installation.data.id,
      repositoryNames: [coordinates.repo],
      type: "installation",
    });
    return {
      coordinates,
      octokit: new Octokit({ auth: authentication.token }),
    };
  }

  async listRepositories(): Promise<unknown> {
    const { auth, octokit: app } = await this.appClient();
    const installations = await app.paginate(app.rest.apps.listInstallations, { per_page: 100 });
    const repositories = [];

    for (const installation of installations) {
      const authentication = await auth({
        installationId: installation.id,
        type: "installation",
      });
      const octokit = new Octokit({ auth: authentication.token });
      const installed = await octokit.paginate(octokit.rest.apps.listReposAccessibleToInstallation, {
        per_page: 100,
      });
      repositories.push(...installed.map(repositorySummary));
    }

    repositories.sort((left, right) => left.fullName.localeCompare(right.fullName));
    return { repositories };
  }

  async searchCode(repository: string, query: string, options: PageOptions): Promise<unknown> {
    const { coordinates, octokit } = await this.repositoryClient(repository);
    const safeQuery = validateCodeSearchQuery(query);
    const response = await octokit.rest.search.code({
      page: options.page,
      per_page: options.perPage,
      q: `${safeQuery} repo:${coordinates.fullName}`,
    });
    const items = response.data.items.map((item) => ({
      name: item.name,
      path: item.path,
      repository: item.repository.full_name,
      sha: item.sha,
      url: item.html_url,
    }));
    return {
      items,
      pagination: pageInfo(options.page, options.perPage, items.length),
      totalCount: response.data.total_count,
    };
  }

  async listDirectory(
    repository: string,
    path: string,
    options: DirectoryOptions,
  ): Promise<unknown> {
    const { coordinates, octokit } = await this.repositoryClient(repository);
    const request = { owner: coordinates.owner, path, repo: coordinates.repo };
    const response = await octokit.rest.repos.getContent(
      options.ref ? { ...request, ref: options.ref } : request,
    );
    if (!Array.isArray(response.data)) {
      throw new ConnectorInputError("The requested path is not a directory");
    }
    const selected = response.data.slice(options.offset, options.offset + options.limit);
    return {
      entries: selected.map((entry) => ({
        name: entry.name,
        path: entry.path,
        sha: entry.sha,
        size: entry.size,
        type: entry.type,
        url: entry.html_url,
      })),
      nextOffset:
        options.offset + selected.length < response.data.length
          ? options.offset + selected.length
          : null,
      path,
      repository: coordinates.fullName,
      totalEntries: response.data.length,
    };
  }

  async getFile(repository: string, path: string, options: FileOptions): Promise<unknown> {
    const { coordinates, octokit } = await this.repositoryClient(repository);
    const request = { owner: coordinates.owner, path, repo: coordinates.repo };
    const response = await octokit.rest.repos.getContent(
      options.ref ? { ...request, ref: options.ref } : request,
    );
    if (Array.isArray(response.data) || response.data.type !== "file") {
      throw new ConnectorInputError("The requested path is not a file");
    }
    if (!("content" in response.data) || response.data.encoding !== "base64") {
      throw new ConnectorInputError("GitHub did not return inline file content");
    }

    const bytes = Uint8Array.from(Buffer.from(response.data.content.replace(/\n/gu, ""), "base64"));
    let decoded: string;
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return {
        binary: true,
        path: response.data.path,
        repository: coordinates.fullName,
        sha: response.data.sha,
        size: response.data.size,
        url: response.data.html_url,
      };
    }
    if (decoded.includes("\0")) {
      return {
        binary: true,
        path: response.data.path,
        repository: coordinates.fullName,
        sha: response.data.sha,
        size: response.data.size,
        url: response.data.html_url,
      };
    }

    const lines = decoded.split("\n");
    const startLine = options.startLine ?? 1;
    const requestedEnd = options.endLine ?? lines.length;
    if (requestedEnd < startLine) {
      throw new ConnectorInputError("endLine must be greater than or equal to startLine");
    }
    const endLine = Math.min(requestedEnd, startLine + 999, lines.length);
    const selected = lines.slice(startLine - 1, endLine).join("\n");
    const content = truncateText(selected);
    return {
      binary: false,
      content: content.text,
      endLine,
      path: response.data.path,
      repository: coordinates.fullName,
      sha: response.data.sha,
      size: response.data.size,
      startLine,
      totalLines: lines.length,
      truncated: content.truncated || endLine < requestedEnd || endLine < lines.length,
      url: response.data.html_url,
    };
  }

  async listCommits(repository: string, options: CommitListOptions): Promise<unknown> {
    const { coordinates, octokit } = await this.repositoryClient(repository);
    const response = await octokit.rest.repos.listCommits({
      owner: coordinates.owner,
      page: options.page,
      per_page: options.perPage,
      repo: coordinates.repo,
      ...(options.ref ? { sha: options.ref } : {}),
      ...(options.path ? { path: options.path } : {}),
      ...(options.since ? { since: options.since } : {}),
      ...(options.until ? { until: options.until } : {}),
    });
    const commits = response.data.map((commit) => ({
      author: commit.author?.login ?? commit.commit.author?.name ?? null,
      authoredAt: commit.commit.author?.date ?? null,
      message: commit.commit.message,
      sha: commit.sha,
      url: commit.html_url,
    }));
    return { commits, pagination: pageInfo(options.page, options.perPage, commits.length) };
  }

  async getCommit(repository: string, sha: string): Promise<unknown> {
    const { coordinates, octokit } = await this.repositoryClient(repository);
    const response = await octokit.rest.repos.getCommit({
      owner: coordinates.owner,
      per_page: 50,
      repo: coordinates.repo,
      ref: sha,
    });
    return {
      author: response.data.author?.login ?? response.data.commit.author?.name ?? null,
      authoredAt: response.data.commit.author?.date ?? null,
      files: response.data.files?.map((file) => ({
        additions: file.additions,
        changes: file.changes,
        deletions: file.deletions,
        filename: file.filename,
        patch: file.patch ? truncateText(file.patch, 20_000) : null,
        status: file.status,
        url: file.blob_url,
      })),
      message: response.data.commit.message,
      parents: response.data.parents.map((parent) => parent.sha),
      sha: response.data.sha,
      stats: response.data.stats,
      url: response.data.html_url,
    };
  }

  async listPullRequests(
    repository: string,
    options: PullRequestListOptions,
  ): Promise<unknown> {
    const { coordinates, octokit } = await this.repositoryClient(repository);
    const response = await octokit.rest.pulls.list({
      owner: coordinates.owner,
      page: options.page,
      per_page: options.perPage,
      repo: coordinates.repo,
      state: options.state,
      ...(options.base ? { base: options.base } : {}),
      ...(options.head ? { head: options.head } : {}),
    });
    const pullRequests = response.data.map((pullRequest) => ({
      author: pullRequest.user?.login ?? null,
      base: pullRequest.base.ref,
      createdAt: pullRequest.created_at,
      draft: pullRequest.draft ?? false,
      head: pullRequest.head.ref,
      number: pullRequest.number,
      state: pullRequest.state,
      title: pullRequest.title,
      updatedAt: pullRequest.updated_at,
      url: pullRequest.html_url,
    }));
    return {
      pagination: pageInfo(options.page, options.perPage, pullRequests.length),
      pullRequests,
    };
  }

  async getPullRequest(repository: string, number: number): Promise<unknown> {
    const { coordinates, octokit } = await this.repositoryClient(repository);
    const parameters = { owner: coordinates.owner, pull_number: number, repo: coordinates.repo };
    const [pullRequest, files, reviews, comments] = await Promise.all([
      octokit.rest.pulls.get(parameters),
      octokit.rest.pulls.listFiles({ ...parameters, per_page: 50 }),
      octokit.rest.pulls.listReviews({ ...parameters, per_page: 50 }),
      octokit.rest.issues.listComments({
        issue_number: number,
        owner: coordinates.owner,
        per_page: 50,
        repo: coordinates.repo,
      }),
    ]);
    return {
      additions: pullRequest.data.additions,
      author: pullRequest.data.user?.login ?? null,
      base: pullRequest.data.base.ref,
      body: pullRequest.data.body,
      changedFiles: pullRequest.data.changed_files,
      comments: comments.data.map((comment) => ({
        author: comment.user?.login ?? null,
        body: comment.body,
        createdAt: comment.created_at,
        url: comment.html_url,
      })),
      commits: pullRequest.data.commits,
      createdAt: pullRequest.data.created_at,
      deletions: pullRequest.data.deletions,
      draft: pullRequest.data.draft ?? false,
      files: files.data.map((file) => ({
        additions: file.additions,
        deletions: file.deletions,
        filename: file.filename,
        status: file.status,
        url: file.blob_url,
      })),
      head: pullRequest.data.head.ref,
      mergeable: pullRequest.data.mergeable,
      merged: pullRequest.data.merged,
      number: pullRequest.data.number,
      reviews: reviews.data.map((review) => ({
        author: review.user?.login ?? null,
        body: review.body,
        state: review.state,
        submittedAt: review.submitted_at,
        url: review.html_url,
      })),
      state: pullRequest.data.state,
      title: pullRequest.data.title,
      updatedAt: pullRequest.data.updated_at,
      url: pullRequest.data.html_url,
    };
  }

  async getPullRequestDiff(repository: string, number: number): Promise<unknown> {
    const { coordinates, octokit } = await this.repositoryClient(repository);
    const response = await octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
      headers: { accept: "application/vnd.github.diff" },
      owner: coordinates.owner,
      pull_number: number,
      repo: coordinates.repo,
    });
    const diff = truncateText(String(response.data));
    return {
      diff: diff.text,
      number,
      repository: coordinates.fullName,
      truncated: diff.truncated,
      url: `https://github.com/${coordinates.fullName}/pull/${number}`,
    };
  }

  async listIssues(repository: string, options: IssueListOptions): Promise<unknown> {
    const { coordinates, octokit } = await this.repositoryClient(repository);
    const response = await octokit.rest.issues.listForRepo({
      owner: coordinates.owner,
      page: options.page,
      per_page: options.perPage,
      repo: coordinates.repo,
      state: options.state,
      ...(options.assignee ? { assignee: options.assignee } : {}),
      ...(options.labels ? { labels: options.labels } : {}),
      ...(options.since ? { since: options.since } : {}),
    });
    const issues = response.data
      .filter((issue) => !issue.pull_request)
      .map((issue) => ({
        assignees: issue.assignees?.map((assignee) => assignee.login) ?? [],
        author: issue.user?.login ?? null,
        createdAt: issue.created_at,
        labels: issue.labels.map((label) => (typeof label === "string" ? label : label.name)),
        number: issue.number,
        state: issue.state,
        title: issue.title,
        updatedAt: issue.updated_at,
        url: issue.html_url,
      }));
    return { issues, pagination: pageInfo(options.page, options.perPage, response.data.length) };
  }

  async getIssue(repository: string, number: number): Promise<unknown> {
    const { coordinates, octokit } = await this.repositoryClient(repository);
    const issue = await octokit.rest.issues.get({
      issue_number: number,
      owner: coordinates.owner,
      repo: coordinates.repo,
    });
    if (issue.data.pull_request) {
      throw new ConnectorInputError("This number is a pull request; use get_pull_request");
    }
    const comments = await octokit.rest.issues.listComments({
      issue_number: number,
      owner: coordinates.owner,
      per_page: 50,
      repo: coordinates.repo,
    });
    return {
      assignees: issue.data.assignees?.map((assignee) => assignee.login) ?? [],
      author: issue.data.user?.login ?? null,
      body: issue.data.body,
      comments: comments.data.map((comment) => ({
        author: comment.user?.login ?? null,
        body: comment.body,
        createdAt: comment.created_at,
        url: comment.html_url,
      })),
      createdAt: issue.data.created_at,
      labels: issue.data.labels.map((label) => (typeof label === "string" ? label : label.name)),
      number: issue.data.number,
      state: issue.data.state,
      title: issue.data.title,
      updatedAt: issue.data.updated_at,
      url: issue.data.html_url,
    };
  }
}
