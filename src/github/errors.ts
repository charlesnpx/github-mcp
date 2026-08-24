interface GitHubLikeError extends Error {
  response?: { headers?: Record<string, string | undefined> };
  status?: number;
}

export class ConnectorInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorInputError";
  }
}

function isGitHubLikeError(error: unknown): error is GitHubLikeError {
  return error instanceof Error;
}

export function safeGitHubError(error: unknown): string {
  if (!isGitHubLikeError(error)) return "Unexpected GitHub integration error";

  if (error instanceof ConnectorInputError) return error.message;

  const status = error.status;
  const headers = error.response?.headers;
  if (status === 403 && headers?.["x-ratelimit-remaining"] === "0") {
    const reset = Number(headers["x-ratelimit-reset"]);
    const resetAt = Number.isFinite(reset) ? new Date(reset * 1000).toISOString() : "unknown";
    return `GitHub API rate limit exceeded; retry after ${resetAt}`;
  }
  if (status === 404) return "Repository or GitHub resource was not found or is not installed";
  if (status === 401) return "GitHub rejected the connector's installation credentials";
  if (status === 403) return "The GitHub App does not have permission to read this resource";
  if (typeof status === "number") return `GitHub API request failed with status ${status}`;
  return "Unexpected GitHub integration error";
}
