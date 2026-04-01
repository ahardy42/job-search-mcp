import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchJobDescription } from "../services/linkedin.js";
import { BASE_DELAY_MS } from "../constants.js";

const CONCURRENCY = 3;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const JobDescriptionSearchInputSchema = {
  urls: z
    .array(z.string().url())
    .min(1, "At least one URL is required")
    .describe("List of LinkedIn job URLs to fetch descriptions for"),
};

export function registerJobDescriptionSearchTool(server: McpServer): void {
  server.registerTool(
    "job_description_search",
    {
      title: "Fetch Job Descriptions",
      description: `Fetch full job descriptions from LinkedIn job URLs.

Accepts a list of LinkedIn job URLs (from job_search results) and returns the full description text for each.

Args:
  - urls (string[], required): LinkedIn job URLs to fetch descriptions for

Returns:
  JSON array of results:
  [
    {
      "url": "https://www.linkedin.com/jobs/view/...",
      "description": "Full job description text..."
    }
  ]

  If a fetch fails for a URL, the description will contain the error message.

Notes:
  - Only LinkedIn URLs (HTTPS) are accepted
  - Fetches run in parallel batches of ${CONCURRENCY} with delays to avoid rate limiting`,
      inputSchema: JobDescriptionSearchInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      const results: { url: string; description: string }[] = [];

      for (let i = 0; i < params.urls.length; i += CONCURRENCY) {
        const batch = params.urls.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map((url) => fetchJobDescription(url))
        );

        for (let j = 0; j < batch.length; j++) {
          const result = settled[j];
          results.push({
            url: batch[j],
            description:
              result.status === "fulfilled"
                ? result.value
                : `Error: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
          });
        }

        if (i + CONCURRENCY < params.urls.length) {
          await delay(BASE_DELAY_MS + Math.random() * 1000);
        }
      }

      const text = JSON.stringify(results, null, 2);
      return {
        content: [{ type: "text", text }],
      };
    }
  );
}
