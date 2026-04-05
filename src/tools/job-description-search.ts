import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchJobDescription as fetchLinkedInDescription } from "../services/linkedin.js";
import { fetchJobDescription as fetchHimalayasDescription } from "../services/himalayas.js";
import { BASE_DELAY_MS, HIMALAYAS_HOST, LINKEDIN_HOST } from "../constants.js";

const CONCURRENCY = 3;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const ALLOWED_HOSTS = new Set([
  LINKEDIN_HOST,
  "linkedin.com",
  HIMALAYAS_HOST,
  `www.${HIMALAYAS_HOST}`,
]);

function getHostFetcher(url: string): ((url: string) => Promise<string>) | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    if (hostname === LINKEDIN_HOST || hostname === "linkedin.com") {
      return fetchLinkedInDescription;
    }
    if (hostname === HIMALAYAS_HOST || hostname === `www.${HIMALAYAS_HOST}`) {
      return fetchHimalayasDescription;
    }
    return null;
  } catch {
    return null;
  }
}

const JobDescriptionSearchInputSchema = {
  urls: z
    .array(z.string().url())
    .min(1, "At least one URL is required")
    .describe("List of LinkedIn or Himalayas job URLs to fetch descriptions for"),
};

export function registerJobDescriptionSearchTool(server: McpServer): void {
  server.registerTool(
    "job_description_search",
    {
      title: "Fetch Job Descriptions",
      description: `Fetch full job descriptions from LinkedIn or Himalayas job URLs.

Accepts a list of job URLs (from job_search results) and returns the full description text for each. Supports both LinkedIn and Himalayas URLs.

Args:
  - urls (string[], required): Job URLs to fetch descriptions for (LinkedIn or Himalayas)

Returns:
  JSON array of results:
  [
    {
      "url": "https://www.linkedin.com/jobs/view/..." or "https://himalayas.app/jobs/...",
      "source": "linkedin" | "himalayas",
      "description": "Full job description text..."
    }
  ]

  If a fetch fails for a URL, the description will contain the error message.

Notes:
  - Only LinkedIn and Himalayas HTTPS URLs are accepted
  - Himalayas job URLs typically come from the guid field in job_search results
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
      const results: { url: string; source: string; description: string }[] = [];

      for (let i = 0; i < params.urls.length; i += CONCURRENCY) {
        const batch = params.urls.slice(i, i + CONCURRENCY);
        const settled = await Promise.allSettled(
          batch.map((url) => {
            const fetcher = getHostFetcher(url);
            if (!fetcher) {
              return Promise.reject(
                new Error(
                  `Unsupported host. Only LinkedIn (${LINKEDIN_HOST}) and Himalayas (${HIMALAYAS_HOST}) URLs are accepted.`
                )
              );
            }
            return fetcher(url);
          })
        );

        for (let j = 0; j < batch.length; j++) {
          const url = batch[j];
          const result = settled[j];
          let source = "unknown";
          try {
            const hostname = new URL(url).hostname;
            if (hostname.includes("linkedin")) source = "linkedin";
            else if (hostname.includes(HIMALAYAS_HOST)) source = "himalayas";
          } catch {
            // leave as unknown
          }

          results.push({
            url,
            source,
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

      const text = JSON.stringify(results);
      return {
        content: [{ type: "text", text }],
      };
    }
  );
}
