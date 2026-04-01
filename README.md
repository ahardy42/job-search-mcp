# job-search-mcp-server

A stdio MCP server for job searching. Scrapes LinkedIn's public job listings and returns structured results with filtering support.

## Tools

### `job_search`

Search LinkedIn for job listings with filters for keywords, location, job type, remote preference, experience level, salary, and recency.

Defaults are tuned for **senior, remote, full-time** roles posted in the **past week**.

## Setup

```bash
npm install
npm run build
```

Requires Node.js >= 20.

## Usage

Add to your MCP client config (e.g. Claude Code `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "job-search": {
      "command": "node",
      "args": ["/path/to/job-search-mcp/dist/index.js"]
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

## Planned Tools

- `cover_letter_builder` — generate cover letter context from your experience + job listing
- `company_research` — company intel via web search (Playwright + DuckDuckGo)
- `job_alignment` — score how well your experience matches a job description
