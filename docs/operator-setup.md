# Operator setup

This guide deliberately uses placeholders. Every operator supplies their own GitHub, Cloudflare, and MCP-client accounts.

## 1. Choose the Worker URL

1. Authenticate Wrangler with the Cloudflare account that will own the Worker.
2. Copy `wrangler.template.jsonc` to the ignored `wrangler.jsonc`.
3. Change `name` in `wrangler.jsonc` if desired.
4. Determine the account's `workers.dev` subdomain. The resulting callback will be:

   `https://<worker-name>.<workers-subdomain>.workers.dev/callback`

Wrangler automatically provisions the `OAUTH_KV` namespace on first deployment. The copied `wrangler.jsonc` remains ignored so any future account-specific local configuration cannot enter source control.

## 2. Register a GitHub App

Create a GitHub App owned by the appropriate user or organization:

- **GitHub App name:** choose an operator-specific, globally unique name.
- **Homepage URL:** the Worker base URL or the connector's source repository.
- **Callback URL:** `https://<worker-host>/callback`.
- **Expire user authorization tokens:** enabled.
- **Request user authorization during installation:** disabled; the connector requests it when a user connects.
- **Webhooks:** inactive.
- **Repository permissions:** Metadata read-only, Contents read-only, Issues read-only, Pull requests read-only. Grant nothing else.
- **Installation scope:** choose “Only on this account” for a personal-only app or “Any account” when organization installations are required.

Install the app and select only the repositories the connector should be able to query. Repository selection in the installation is the access list; the Worker does not maintain a second repository allowlist.

Generate a client secret and private key only when ready to configure Cloudflare. Keep both out of the repository.

## 3. Configure Worker secrets

Set each value interactively so it does not enter the repository:

```sh
yarn wrangler secret put AUTHORIZED_GITHUB_LOGINS --config wrangler.jsonc
yarn wrangler secret put GITHUB_APP_ID --config wrangler.jsonc
yarn wrangler secret put GITHUB_CLIENT_ID --config wrangler.jsonc
yarn wrangler secret put GITHUB_CLIENT_SECRET --config wrangler.jsonc
yarn wrangler secret put GITHUB_APP_PRIVATE_KEY --config wrangler.jsonc
yarn wrangler secret put COOKIE_ENCRYPTION_KEY --config wrangler.jsonc
```

`AUTHORIZED_GITHUB_LOGINS` is a comma-separated list, for example `<github-login>` or `<github-login-1>,<github-login-2>`. Whitespace is ignored and matching is case-insensitive.

Generate `COOKIE_ENCRYPTION_KEY` with a cryptographically secure password generator; it must be at least 32 characters. Paste the complete GitHub App PEM private key when prompted for `GITHUB_APP_PRIVATE_KEY`, then securely remove any downloaded copy when it is no longer needed.

## 4. Deploy and verify

```sh
yarn deploy
npx @modelcontextprotocol/inspector@latest
```

Connect the inspector to `https://<worker-host>/mcp`, complete GitHub authorization, list the tools, and make a read request against an installed repository.

For a Claude custom connector, enter:

- **Name:** any operator-selected name.
- **Remote MCP server URL:** `https://<worker-host>/mcp`.

Claude discovers the OAuth endpoints automatically and presents a Connect flow.

## Cost expectation

A personal connector should fit within Cloudflare's Free-plan allowances. As of August 2026 those include 100,000 Worker requests per day, 100,000 KV reads per day, 1,000 KV writes per day, and 1 GB of KV storage. Confirm current pricing before deployment.

## Changing access

- Add or remove repositories through the GitHub App installation settings; no deployment is necessary.
- Change permitted people by updating `AUTHORIZED_GITHUB_LOGINS`.
- Disconnect or revoke the GitHub App installation to remove all repository access.
- Rotate the GitHub App private key, client secret, and cookie key through Worker secrets without committing configuration.
