import { describe, expect, it } from "vitest";
import { ConnectorInputError, safeGitHubError } from "../src/github/errors";

describe("safeGitHubError", () => {
  it("returns deliberate connector input errors", () => {
    expect(safeGitHubError(new ConnectorInputError("Safe input guidance"))).toBe(
      "Safe input guidance",
    );
  });

  it("does not expose arbitrary upstream messages or credentials", () => {
    expect(safeGitHubError(new Error("request failed with github_pat_sensitive-value"))).toBe(
      "Unexpected GitHub integration error",
    );
  });

  it("normalizes common GitHub status failures", () => {
    expect(safeGitHubError(Object.assign(new Error("private detail"), { status: 404 }))).toBe(
      "Repository or GitHub resource was not found or is not installed",
    );
    expect(safeGitHubError(Object.assign(new Error("private detail"), { status: 401 }))).toBe(
      "GitHub rejected the connector's installation credentials",
    );
  });

  it("reports a GitHub rate-limit reset without returning the upstream body", () => {
    const error = Object.assign(new Error("private detail"), {
      response: {
        headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700000000" },
      },
      status: 403,
    });
    expect(safeGitHubError(error)).toBe(
      "GitHub API rate limit exceeded; retry after 2023-11-14T22:13:20.000Z",
    );
  });
});
