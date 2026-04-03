# job-search-mcp-server

A stdio MCP server for job searching, profile loading, and company research. Exposes 4 tools to any MCP-compatible client.

## Tools

### `job_search`

Search LinkedIn for job listings with filters for keywords, location, job type, remote preference, experience level, salary, and recency.

Defaults are tuned for **senior, remote, full-time** roles posted in the **past week**.

### `profile_data`

Load and return all profile sections (experience, skills, education, etc.) and the full concatenated text. The calling LLM uses this data directly for job alignment analysis, cover letter writing, or any other profile-based task.

### `company_research`

Research a company using DuckDuckGo web search (via Playwright). Searches for company info, recent news, and Glassdoor reviews. Optionally scrapes the company's own website. Returns structured data for "what they say vs what they actually do" analysis.

## Setup

```bash
npm install
npm run build
npx playwright install chromium  # required for company_research
```

Requires Node.js >= 20.

## Profile Setup

The `profile_data` tool requires a profile directory with your experience data.

1. Create a `profile/` directory in the project root (it's gitignored)
2. Add your files (Markdown, PDF, or DOCX)
3. Create `profile/manifest.json` listing your files:

```json
{
  "sections": [
    { "id": "summary", "label": "Professional Summary", "source": "summary.md", "format": "md", "order": 1 },
    { "id": "experience", "label": "Work Experience", "source": "experience.pdf", "format": "pdf", "order": 2 },
    { "id": "skills", "label": "Technical Skills", "source": "skills.md", "format": "md", "order": 3 }
  ]
}
```

Supported formats: `md`, `txt`, `pdf`, `docx`.

The profile is loaded once and cached for the server session. Files are processed in explicit `order` for deterministic output.

Override the profile directory path via the `PROFILE_DIR` environment variable.

## Connecting to Your MCP Client

This is a stdio server — it works with any MCP-compatible client. Replace `/absolute/path/to/job-search-mcp/dist/index.js` with the actual path on your machine.

> **Node version managers (nvm, nodenv, asdf):** MCP clients spawn the server as a subprocess and may not inherit your shell's PATH. Use the full path to your node binary (run `which node` to find it).

### Claude Code (CLI)

**Via command line:**

```bash
claude mcp add --transport stdio job-search -- node /absolute/path/to/job-search-mcp/dist/index.js
```

**Or manually in `.mcp.json` (project scope, checked into version control):**

```json
{
  "mcpServers": {
    "job-search": {
      "command": "node",
      "args": ["/absolute/path/to/job-search-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Code or run `/mcp` to verify the server is connected.

### Claude Desktop

Edit the config file:
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "job-search": {
      "command": "node",
      "args": ["/absolute/path/to/job-search-mcp/dist/index.js"]
    }
  }
}
```

Quit and restart Claude Desktop completely (not just the window). Look for the hammer icon in the chat input.

### VS Code

Create `.vscode/mcp.json` in your workspace:

```json
{
  "mcpServers": {
    "job-search": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/job-search-mcp/dist/index.js"]
    }
  }
}
```

Or via command line:

```bash
code --add-mcp '{"name":"job-search","type":"stdio","command":"node","args":["/absolute/path/to/job-search-mcp/dist/index.js"]}'
```

### Other MCP Clients (Cursor, Codeium, etc.)

Most clients use the same standard format:

```json
{
  "mcpServers": {
    "job-search": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/job-search-mcp/dist/index.js"]
    }
  }
}
```

### Environment Variables

Pass `PROFILE_DIR` to override the default profile location:

```json
{
  "mcpServers": {
    "job-search": {
      "command": "node",
      "args": ["/absolute/path/to/job-search-mcp/dist/index.js"],
      "env": {
        "PROFILE_DIR": "/path/to/your/profile"
      }
    }
  }
}
```

## Development

```bash
npm run dev    # watch mode with tsx
npm run build  # compile TypeScript
npm start      # run compiled server
```
