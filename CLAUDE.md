# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A stdio-based MCP (Model Context Protocol) server that exposes 4 tools for job searching: `job_search` (LinkedIn scraping), `job_alignment` (profile vs job description matching), `cover_letter_builder` (structured context assembly for LLM letter writing), and `company_research` (DuckDuckGo + Playwright web scraping).

## Commands

```bash
npm run build        # TypeScript compile (tsc) to dist/
npm run dev          # Watch mode with tsx
npm start            # Run compiled server (dist/index.js)
npx playwright install chromium   # Required for company_research tool
```

No test framework is configured.

## Architecture

**Entry point:** `src/index.ts` — creates an `McpServer`, registers all 4 tools, connects via `StdioServerTransport`.

**Tool registration pattern:** Each tool lives in `src/tools/<name>.ts` and exports a `register<Name>Tool(server: McpServer)` function. Tools define a Zod input schema, tool metadata with annotations, and an async handler. All tool responses are JSON stringified with a 25K character limit (`CHARACTER_LIMIT`); oversized responses are truncated.

**Services layer (`src/services/`):**
- `linkedin.ts` — Scrapes LinkedIn's public guest job search API via axios + cheerio. Implements in-memory caching (1hr TTL), batch pagination (25 per page), exponential backoff on errors, and random user-agent rotation. Also exports `fetchJobDescription()` for scraping individual job pages (validates LinkedIn hostname + HTTPS).
- `profile-loader.ts` — Reads a `profile/` directory (or `PROFILE_DIR` env var) containing a `manifest.json` that maps section IDs to files (md/txt/pdf/docx). Parses files, extracts keywords (simple tokenization with stop-word removal), and caches the loaded profile for the server session. Uses `pdf-parse` and `mammoth` via `createRequire` (CJS interop).
- `keyword-matcher.ts` — Set-based keyword matching between job descriptions and profile. `findRelevantSections()` ranks profile sections by keyword overlap count.
- `web-scraper.ts` — Playwright-based DuckDuckGo search and page scraping. Lazy-launches a singleton Chromium browser. Includes SSRF mitigation: validates URLs (HTTPS-only, no localhost/internal hostnames), resolves DNS and rejects private IPs, and re-validates after redirects. Company research runs 3 parallel DuckDuckGo searches (general, news, glassdoor). Research results cached 24hr.

**Key constants (`src/constants.ts`):** `CHARACTER_LIMIT` (25K), `BATCH_SIZE` (25), `CACHE_TTL_MS` (1hr for jobs), `RESEARCH_CACHE_TTL_MS` (24hr for company research), `REQUEST_TIMEOUT_MS` (10s), `MAX_CONSECUTIVE_ERRORS` (3), `BASE_DELAY_MS` (2s).

## Profile Setup

The `job_alignment` and `cover_letter_builder` tools require a `profile/` directory (gitignored) with a `manifest.json` listing sections. Each section points to an md/txt/pdf/docx file. Override location with `PROFILE_DIR` env var.

## TypeScript Configuration

- ESM (`"type": "module"` in package.json, `"module": "Node16"` in tsconfig)
- All imports use `.js` extensions (required for Node16 module resolution)
- Custom type declarations in `src/types.d.ts` for `random-useragent` and `pdf-parse`
- Target: ES2022, strict mode
