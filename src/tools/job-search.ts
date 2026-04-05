import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchJobs } from "../services/linkedin.js";

const JobSearchInputSchema = {
  keywords: z
    .string()
    .min(1, "Keywords are required")
    .max(200)
    .describe("Job title, skills, or search terms (e.g. 'senior typescript engineer')"),
  location: z
    .string()
    .max(100)
    .default("United States")
    .describe("City, state, country, or 'remote'"),
  date_posted: z
    .enum(["24hr", "past week", "past month"])
    .default("past week")
    .describe("How recently the job was posted"),
  job_type: z
    .enum(["full time", "full-time", "part time", "part-time", "contract", "temporary", "internship"])
    .default("full time")
    .describe("Employment type"),
  remote_filter: z
    .enum(["remote", "hybrid", "on-site"])
    .default("remote")
    .describe("Work location preference"),
  experience_level: z
    .enum(["internship", "entry level", "associate", "senior", "director", "executive"])
    .default("senior")
    .describe("Seniority level"),
  salary: z
    .enum(["40000", "60000", "80000", "100000", "120000"])
    .optional()
    .describe("Minimum salary filter"),
  sort_by: z
    .enum(["recent", "relevant"])
    .default("recent")
    .describe("Sort order for results"),
};

export function registerJobSearchTool(server: McpServer): void {
  server.registerTool(
    "job_search",
    {
      title: "Search LinkedIn Jobs",
      description: `Search for job listings on LinkedIn using various filters.

Scrapes LinkedIn's public job search to find current openings. Returns structured job listing data including position title, company, location, posting date, salary (when available), and a direct link to the listing.

Default filters are tuned for senior remote full-time roles posted in the past week. Override any filter via the input parameters.

Args:
  - keywords (string, required): Job title or skills to search for
  - location (string): Geographic filter, default "United States"
  - date_posted (enum): Recency filter — "24hr", "past week", "past month"
  - job_type (enum): "full time", "part time", "contract", "temporary", "internship"
  - remote_filter (enum): "remote", "hybrid", "on-site"
  - experience_level (enum): "internship", "entry level", "associate", "senior", "director", "executive"
  - salary (enum, optional): Minimum salary — "40000", "60000", "80000", "100000", "120000"
  - sort_by (enum): "recent" or "relevant"

Returns:
  JSON array of job listings:
  [
    {
      "position": "Senior Software Engineer",
      "company": "Acme Corp",
      "location": "Remote",
      "date": "2025-03-28",
      "salary": "$120,000 - $160,000",
      "jobUrl": "https://www.linkedin.com/jobs/view/...",
      "agoTime": "2 days ago"
    }
  ]

Notes:
  - LinkedIn may rate-limit aggressive scraping; the tool implements backoff and caching (1hr TTL)
  - Results are cached; identical queries within 1 hour return cached data
  - Returns all available results from LinkedIn for the given filters
  - If no results are found, returns an empty array with a message`,
      inputSchema: JobSearchInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        const jobs = await searchJobs({
          keywords: params.keywords,
          location: params.location,
          dateSincePosted: params.date_posted,
          jobType: params.job_type,
          remoteFilter: params.remote_filter,
          experienceLevel: params.experience_level,
          salary: params.salary,
          sortBy: params.sort_by,
        });

        if (jobs.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No jobs found matching "${params.keywords}" with the given filters. Try broadening your search — adjust date_posted, remote_filter, or experience_level.`,
              },
            ],
          };
        }

        const output = {
          total: jobs.length,
          query: {
            keywords: params.keywords,
            location: params.location,
            date_posted: params.date_posted,
            job_type: params.job_type,
            remote_filter: params.remote_filter,
            experience_level: params.experience_level,
          },
          jobs,
        };

        const text = JSON.stringify(output);

        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Error searching jobs: ${msg}. This may be due to LinkedIn rate limiting. Try again in a few minutes or adjust your search parameters.`,
            },
          ],
        };
      }
    }
  );
}
