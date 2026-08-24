import { describe, expect, it } from "vitest";
import {
  ConfigurationError,
  githubAppConfig,
  isAuthorizedLogin,
  parseAuthorizedLogins,
  validateOAuthConfiguration,
} from "../src/config";
import type { WorkerEnv } from "../src/types";

function oauthEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    AUTHORIZED_GITHUB_LOGINS: "example-user",
    COOKIE_ENCRYPTION_KEY: "a-secure-random-value-at-least-32-characters",
    GITHUB_APP_ID: "123",
    GITHUB_APP_PRIVATE_KEY: "line-1\\nline-2",
    GITHUB_CLIENT_ID: "client-id",
    GITHUB_CLIENT_SECRET: "client-secret",
    OAUTH_KV: {} as KVNamespace,
    OAUTH_PROVIDER: {} as WorkerEnv["OAUTH_PROVIDER"],
    ...overrides,
  };
}

describe("authorized GitHub login configuration", () => {
  it("normalizes case, whitespace, and duplicate entries", () => {
    expect(parseAuthorizedLogins(" First-User,second-user, FIRST-USER ")).toEqual(
      new Set(["first-user", "second-user"]),
    );
    expect(isAuthorizedLogin("First-User,second-user", "FIRST-USER")).toBe(true);
  });

  it.each([undefined, "", " , "])("fails closed for %j", (value) => {
    expect(() => parseAuthorizedLogins(value)).toThrow(ConfigurationError);
  });
});

describe("operator configuration", () => {
  it("requires every OAuth setting", () => {
    for (const key of [
      "AUTHORIZED_GITHUB_LOGINS",
      "COOKIE_ENCRYPTION_KEY",
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
    ] as const) {
      expect(() => validateOAuthConfiguration(oauthEnv({ [key]: "" }))).toThrow(
        ConfigurationError,
      );
    }
  });

  it("rejects a short cookie-signing secret", () => {
    expect(() => validateOAuthConfiguration(oauthEnv({ COOKIE_ENCRYPTION_KEY: "too-short" }))).toThrow(
      "at least 32 characters",
    );
  });

  it("normalizes escaped newlines in the GitHub App private key", () => {
    expect(githubAppConfig(oauthEnv())).toEqual({
      appId: "123",
      privateKey: "line-1\nline-2",
    });
  });
});
