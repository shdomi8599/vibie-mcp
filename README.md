# vibie-mcp

MCP server for [Vibie](https://vibie.io) — deploy static folders to permanent `*.vibie.page` URLs from Claude Desktop / Cursor / any MCP-compatible client.

## Install

### One-line auto setup (recommended)

```sh
npx vibie-mcp setup
```

Auto-detects Claude Desktop (Windows Store + APPDATA / macOS / Linux) and Cursor (`~/.cursor/mcp.json`) configs, then adds the `vibie` entry. Restart the client and you're done.

### Manual config

If auto setup doesn't fit your client, add this to your MCP config (`claude_desktop_config.json`, `~/.cursor/mcp.json`, etc.):

```json
{
  "mcpServers": {
    "vibie": {
      "command": "npx",
      "args": ["-y", "vibie-mcp"]
    }
  }
}
```

After saving, fully quit and restart your client.

## First-time auth

On first tool call, the server initiates an [OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628). Your AI will receive instructions like:

> Please open https://vibie.io/device?code=XXXX-YYYY in a browser, sign in with Google, and click **Authorize**. Then ask me to try again.

After authorizing in the browser, ask your AI to retry the same request. The server stores a token in `~/.vibie/credentials.json` (chmod 0600) and reuses it for future calls.

You can revoke the token anytime at https://vibie.io/settings/api.

## Tools

- **`vibie_create_site`** — Upload a folder and create a new Vibie site. Auto-writes `.vibie/site.json` in the folder so future updates use the same site.
- **`vibie_update_site`** — Re-deploy to an existing site. Reads slug from `.vibie/site.json` if not specified.
- **`vibie_list_sites`** — List sites under your account.
- **`vibie_get_site`** — Metadata for one site by slug.

## How AI typically uses it

```
You: "Deploy this folder to vibie"
AI: → vibie_create_site({ folder: "." })
    → Returns: https://my-folder-x7f2.vibie.page

You: "Push my changes"
AI: Detects .vibie/site.json
    → vibie_update_site({ folder: "." })
    → Same URL, new content
```

## Folder structure

What gets uploaded from a folder:

- `index.html` + `style.css` + `js/`, `assets/`, etc — all included
- Hidden files (`.git`, `.vibie`, `.DS_Store`) — automatically skipped
- `node_modules/` — skipped
- Limits: 100 MB per site, 500 files per upload, 25 MB per file (Vibie's server validates)

A single HTML file (any name) also works — it gets auto-renamed to `index.html` on upload.

## Env

| Variable | Default | Purpose |
|---|---|---|
| `VIBIE_API_BASE` | `https://vibie.io` | Override for local dev (`http://localhost:3000`) |

## License

MIT
