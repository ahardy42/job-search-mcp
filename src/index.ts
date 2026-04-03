#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerJobSearchTool } from "./tools/job-search.js";
import { registerProfileDataTool } from "./tools/profile-data.js";
import { registerCompanyResearchTool } from "./tools/company-research.js";
import { registerJobDescriptionSearchTool } from "./tools/job-description-search.js";
import { closeBrowser } from "./services/web-scraper.js";

const server = new McpServer({
  name: "job-search-mcp-server",
  version: "1.0.0",
});

// Register tools
registerJobSearchTool(server);
registerProfileDataTool(server);
registerCompanyResearchTool(server);
registerJobDescriptionSearchTool(server);

// Graceful shutdown for Playwright browser
async function cleanup() {
  await closeBrowser();
  process.exit(0);
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Start stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("job-search-mcp-server running via stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
