#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerJobSearchTool } from "./tools/job-search.js";

const server = new McpServer({
  name: "job-search-mcp-server",
  version: "1.0.0",
});

// Register tools
registerJobSearchTool(server);

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
