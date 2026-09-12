---
title: MCP Servers
description: Give your companion external tools through the Model Context Protocol — Home Assistant, Brave Search, GitHub, and more.
---

# MCP Servers

Utsuwa can connect to external [MCP (Model Context Protocol)](https://modelcontextprotocol.io) servers and use their tools during chat: read a sensor value from Home Assistant, search the web, look up a repository — the model decides when a tool helps and calls it.

MCP is plain JSON-RPC 2.0, so Utsuwa ships a small built-in client — no SDK, no extra services.

## How it runs

| Build | Where tools execute | Transports |
| --- | --- | --- |
| Web (self-hosted, `MCP_ENABLED=server`) | Server routes `/api/mcp/*` — server-to-server, no CORS | HTTP + stdio |
| Web (hosted deployment) | Disabled unless the operator opts in | — |
| Desktop (Tauri) | Directly in the app via the Tauri HTTP plugin (CORS-free) | HTTP only |

Browser-side calls to MCP servers are blocked by CORS, mixed-content and Private Network Access rules, which is why the web build proxies through the server and the desktop build uses the Tauri HTTP plugin. stdio servers (local processes) only run in the server build — see [Desktop](#desktop-builds-tauri).

## Enabling MCP (web build)

MCP is **off by default**. Set the environment variable on the Utsuwa server:

```bash
MCP_ENABLED=server
```

- unset / `off` — MCP routes return 404. Hosted deployments stay untouched by default.
- `server` — server-side MCP proxy active (HTTP + stdio)
- `client` / `both` — reserved for future use

Works the same for every deployment style: Docker Compose (`environment:` / an override file), a native install (`.env` next to the build, systemd `Environment=MCP_ENABLED=server`), or your shell. `.env.example` lists the variable as a commented default.

When MCP is disabled, the **MCP entry is hidden from the settings navigation** on web (the page probes the server once and disappears if the route answers 404). A direct link still shows a notice explaining that the administrator has not enabled MCP.

## The MCP settings page

Open **Settings → MCP**.

**Servers** — one card per configured server, with an **On/Off** toggle, an edit and a remove button. An `auth` badge marks HTTP servers with a token.

- **On/Off** enables or disables a single server. Disabled servers are never contacted and their tools are removed from the chat. Turning every server off disables MCP for chat without deleting the configuration.
- **Add Server** opens the form: **Name**, **Transport** (`HTTP` or `stdio`), then either **URL** + **Auth** (`none` or `bearer` + **Token**) for HTTP, or **Command**, **Arguments** and **Env Vars** for stdio.
- **Env Vars** takes one `KEY=value` per line; blank lines and `#` comments are ignored.
- **Inject text tool results as user messages** repeats each result as a user-side note — helpful for local or SLIM models that ignore the strict tool role.

**Available Tools** — press **Refresh** to list the tools of all enabled servers. Each entry shows the tool name, its server, and the description the model sees. Per-server failures (bad token, wrong URL, spawn error) are shown right here instead of silently producing an empty list.

Tokens are stored locally (like other API keys) and are only sent to the server you configured — never to the LLM and never logged.

## Examples

### Home Assistant (HTTP + bearer)

Home Assistant ships an official **MCP Server** integration that exposes the Assist API. Enable it in HA under **Settings → Devices & services → Add integration → Model Context Protocol Server** (it exposes `http://<your-ha>:8123/api/mcp`).

1. Create a long-lived access token in HA: **Profile → Security → Long-lived access tokens**.
2. Add a server in Utsuwa:
   - **Name**: `Home Assistant`
   - **Transport**: `HTTP`
   - **URL**: `http://homeassistant.local:8123/api/mcp`
   - **Auth**: `bearer`, **Token**: your long-lived access token
3. Press **Refresh** under *Available Tools* — you should see tools like `GetLiveContext` / `HassTurnOn`.
4. Ask your companion *"What's the temperature in the living room?"* — it calls the tool and answers with the result.

> Home Assistant's router is strict about trailing slashes (`/api/mcp` works, `/api/mcp/` returns 404). Utsuwa probes both URL variants automatically, so either form works.

### Brave Search (stdio)

Brave publishes an official MCP server (`@brave/brave-search-mcp-server`) that needs a Brave Search API key. It runs as a local process on the Utsuwa server:

- **Name**: `Brave Search`
- **Transport**: `stdio`
- **Command**: `npx`
- **Arguments**: `-y @brave/brave-search-mcp-server`
- **Env Vars**:
  ```
  BRAVE_API_KEY=your-brave-api-key
  ```

Requires Node.js 22+ on the Utsuwa host. The first request downloads the package via `npx`; if the cold start exceeds the 15-second stdio timeout, press **Refresh** again — the cache is warm afterwards.

> The URL `https://api.search.brave.com/res/v1/web/search` is Brave's REST API, **not** an MCP endpoint. Pointing an HTTP MCP server at it fails with a `422` asking for `x-subscription-token`, because MCP clients speak JSON-RPC with a bearer token. Use the stdio server above instead.

### GitHub (HTTP + bearer)

GitHub's official remote MCP server is a good HTTP test for both web and desktop builds:

- **Name**: `GitHub`
- **Transport**: `HTTP`
- **URL**: `https://api.githubcopilot.com/mcp/`
- **Auth**: `bearer`, **Token**: a GitHub personal access token

Create a **fine-grained** PAT at **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens** and grant read-only permissions such as `Contents: Read-only` (plus `Issues` / `Pull requests` if you want them). Restrict **Repository access** to selected repositories or all of them. Classic tokens (`repo` scope) also work but grant broader access.

### SearXNG (stdio)

Any MCP server that speaks stdio can be spawned by the server build. Example with a SearXNG MCP server via `npx`:

- **Name**: `SearXNG`
- **Transport**: `stdio`
- **Command**: `npx`
- **Arguments**: `-y mcp-searxng`
- **Env Vars**:
  ```
  SEARXNG_URL=http://your-searxng-host:8090
  ```

stdio servers are spawned per request with a 15-second timeout and run with the server's environment plus the variables you configure here. Only enable MCP on a deployment you control — stdio effectively means running local commands.

## Desktop builds (Tauri)

The desktop app is the MCP host itself: there is no backend to gate, so no `MCP_ENABLED` variable exists there. **HTTP** servers connect directly through the Tauri HTTP plugin (CORS-free) and work exactly as on web; **stdio** servers are not available in v1 (the app cannot spawn local MCP processes yet).

The per-server **On/Off** switch is the desktop off switch: turn all servers off and the companion stops using MCP tools. A local server that only offers stdio (like Brave) can still be used on desktop by running it in HTTP mode yourself and pointing Utsuwa at it:

```bash
npx -y @brave/brave-search-mcp-server --transport http --port 8080
```

- **Transport**: `HTTP`, **URL**: `http://127.0.0.1:8080/mcp`, **Auth**: `none`

Brave's HTTP mode is unauthenticated and binds to loopback only — fine for a local process, not suitable for remote access.

## Using tools in chat

Once at least one server is enabled and its tools are listed, Utsuwa sends them to the model with every reply. The model can call several tools before answering — up to **5 tool rounds** per reply; results are fed back automatically and the final answer streams as usual (including voice).

If a local or SLIM model ignores tool results, enable **Inject text tool results as user messages** on that server.

Known limitations:

- The **Anthropic** provider path does not receive MCP tool definitions; use an OpenAI-compatible provider for MCP.
- Tools from all servers share one flat namespace. If two servers expose the same tool name, the first server in the list wins — keep names unique.
- Authentication supports `none` and `bearer` only. Servers that need custom headers (for example `X-Api-Key`) are not supported yet.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| MCP entry missing in settings | MCP is disabled on the server (`MCP_ENABLED` unset/`off`). |
| `401` for an HTTP server | Token missing, invalid or expired. |
| `404` for an HTTP server | Wrong endpoint path. Utsuwa already retries with/without a trailing slash; check the server's documented MCP URL. |
| `422` asking for a specific header | The URL points at a REST API, not at an MCP endpoint. |
| `MCP stdio timeout` | Command too slow to start. First `npx` run downloads the package — press **Refresh** again. |
| `spawn ... ENOENT` | Command not found on the Utsuwa host (check the command name and Node.js version). |
| Empty tool list, no error | The server is reachable but exposes no tools (or all are filtered server-side). |

## Security notes

- Tool results are treated as untrusted data: they are never executed, only passed to the model.
- Tokens never reach the model and are never logged.
- HTTP servers may only use `http:`/`https:` URLs; other schemes are rejected before any request is made (web proxy and desktop transport alike).
- stdio servers run commands on the Utsuwa host with the server process's environment plus the variables you configure, and can spawn any executable. `MCP_ENABLED=server` therefore means: the operator trusts everyone who can configure MCP servers. Utsuwa has no per-user accounts — anyone who can reach the app can add servers and trigger tool calls. Keep MCP off on shared or hosted deployments.
- The model can call any tool you expose. Expose only what you are comfortable with (Home Assistant's MCP integration lets you pick which entities are exposed).
- Disabling a server (or all servers) takes effect immediately: no further requests are made and its tools leave the chat.
