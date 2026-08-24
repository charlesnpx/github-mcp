# GitHub MCP

A generic, read-only remote MCP connector for querying GitHub repositories selected through a GitHub App installation. It is designed for self-hosting and contains no GitHub, Cloudflare, or MCP-client account identifiers.

The connector uses two authorization layers:

1. A user authorizes the GitHub App to prove their GitHub identity. Only operator-configured logins may finish connecting.
2. Tool calls use short-lived GitHub App installation tokens restricted to the requested installed repository.

The GitHub user token is discarded after identity verification. The connector exposes no write tools.

## Capabilities

- Discover repositories selected in GitHub App installations.
- Search code and retrieve text files or directory listings.
- Inspect commits, pull requests, diffs, reviews, and comments.
- Inspect issues and issue comments.
- Authenticate remote MCP clients using OAuth, PKCE, and Dynamic Client Registration.

## Local development

Requirements: Node 22 or newer and Yarn 1.22.

```sh
yarn install
yarn type-check
yarn lint
yarn test
yarn build
```

Tests use fake identities and mocked GitHub services. No GitHub App or Cloudflare account is needed for local verification.

To run the Worker against real services, follow [the operator setup guide](docs/operator-setup.md). Do not commit `wrangler.jsonc`, local secrets, or GitHub App private keys.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `list_repositories` | List repositories selected in the app's installations. |
| `search_code` | Search within one installed repository. |
| `list_directory` | List one repository directory at a ref. |
| `get_file` | Retrieve a UTF-8 text file, optionally by line range. |
| `list_commits` / `get_commit` | Inspect repository history. |
| `list_pull_requests` / `get_pull_request` | Inspect pull requests, files, reviews, and comments. |
| `get_pull_request_diff` | Retrieve a pull request's unified diff. |
| `list_issues` / `get_issue` | Inspect issues and comments. |

Results are live GitHub API responses, normalized into bounded JSON with canonical GitHub URLs. Pagination defaults to 20 items and caps at 50. Text and diff output caps at 100,000 characters.

## Security model

- `AUTHORIZED_GITHUB_LOGINS` is mandatory and fails closed when empty.
- GitHub App installations determine which repositories exist to the connector.
- Each repository tool call mints a one-hour token restricted to that repository.
- Required GitHub App permissions are read-only Metadata, Contents, Issues, and Pull Requests.
- OAuth codes, user tokens, installation tokens, client secrets, and private keys are never returned or intentionally logged.

This project is intended as a personal or small-team connector, not a hosted multi-tenant service.

## License

This project is available under the [MIT License](LICENSE).
