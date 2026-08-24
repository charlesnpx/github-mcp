import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { WorkerEntrypoint } from "cloudflare:workers";
import { createMcpHandler } from "agents/mcp/server";
import { GitHubOAuthHandler } from "./auth/github-oauth";
import { githubAppConfig } from "./config";
import { GitHubReader } from "./github/reader";
import { createGitHubMcpServer } from "./mcp/server";
import type { AuthProps, WorkerEnv } from "./types";

class McpApiHandler extends WorkerEntrypoint<WorkerEnv, AuthProps> {
  async fetch(request: Request): Promise<Response> {
    const reader = new GitHubReader(githubAppConfig(this.env));
    const handler = createMcpHandler(() => createGitHubMcpServer(reader), {
      authContext: { props: this.ctx.props },
      route: "/mcp",
    });
    return handler.fetch(request);
  }
}

export default new OAuthProvider<WorkerEnv>({
  apiHandler: McpApiHandler,
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  clientIdMetadataDocumentEnabled: true,
  clientRegistrationEndpoint: "/register",
  defaultHandler: GitHubOAuthHandler,
  resourceMetadata: {
    bearer_methods_supported: ["header"],
    resource_name: "GitHub MCP",
    scopes_supported: ["github:read"],
  },
  scopesSupported: ["github:read"],
  tokenEndpoint: "/token",
});
