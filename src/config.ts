import type { GitHubAppConfig, WorkerEnv } from "./types";

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function parseAuthorizedLogins(value: string | undefined): Set<string> {
  const logins = new Set(
    (value ?? "")
      .split(",")
      .map((login) => login.trim().toLowerCase())
      .filter(Boolean),
  );

  if (logins.size === 0) {
    throw new ConfigurationError("AUTHORIZED_GITHUB_LOGINS must contain at least one GitHub login");
  }

  return logins;
}

export function isAuthorizedLogin(value: string | undefined, login: string): boolean {
  return parseAuthorizedLogins(value).has(login.toLowerCase());
}

function requireValue(name: string, value: string | undefined): string {
  if (!value?.trim()) {
    throw new ConfigurationError(`${name} is required`);
  }

  return value;
}

function requireSecret(name: string, value: string | undefined): string {
  const secret = requireValue(name, value);
  if (secret.length < 32) {
    throw new ConfigurationError(`${name} must contain at least 32 characters`);
  }
  return secret;
}

export function githubAppConfig(env: WorkerEnv): GitHubAppConfig {
  return {
    appId: requireValue("GITHUB_APP_ID", env.GITHUB_APP_ID),
    privateKey: requireValue("GITHUB_APP_PRIVATE_KEY", env.GITHUB_APP_PRIVATE_KEY).replace(
      /\\n/g,
      "\n",
    ),
  };
}

export function validateOAuthConfiguration(env: WorkerEnv): void {
  parseAuthorizedLogins(env.AUTHORIZED_GITHUB_LOGINS);
  githubAppConfig(env);
  requireSecret("COOKIE_ENCRYPTION_KEY", env.COOKIE_ENCRYPTION_KEY);
  requireValue("GITHUB_CLIENT_ID", env.GITHUB_CLIENT_ID);
  requireValue("GITHUB_CLIENT_SECRET", env.GITHUB_CLIENT_SECRET);
}
