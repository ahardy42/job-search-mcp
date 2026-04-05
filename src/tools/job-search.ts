import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchJobs as searchLinkedIn } from "../services/linkedin.js";
import { searchJobs as searchHimalayas } from "../services/himalayas.js";
import type { JobListing } from "../services/linkedin.js";

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

function dedupeKey(job: JobListing): string {
  return (
    job.company.toLowerCase().trim() +
    "|" +
    job.position.toLowerCase().trim()
  ).replace(/\s+/g, " ");
}

function deduplicateJobs(jobs: JobListing[]): JobListing[] {
  const seen = new Map<string, JobListing>();
  for (const job of jobs) {
    const key = dedupeKey(job);
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, job);
    } else {
      // Prefer the listing with more data (salary info, description)
      const existingScore =
        (existing.salary !== "Not specified" ? 1 : 0) +
        (existing.description ? 1 : 0) +
        (existing.minSalary != null ? 1 : 0);
      const newScore =
        (job.salary !== "Not specified" ? 1 : 0) +
        (job.description ? 1 : 0) +
        (job.minSalary != null ? 1 : 0);
      if (newScore > existingScore) {
        seen.set(key, job);
      }
    }
  }
  return [...seen.values()];
}

export function registerJobSearchTool(server: McpServer): void {
  server.registerTool(
    "job_search",
    {
      title: "Search Jobs",
      description: `Search for job listings across LinkedIn and Himalayas using various filters.

Searches LinkedIn's public job listings and the Himalayas remote jobs API in parallel, de-duplicates results, and returns structured job data including position title, company, location, posting date, salary (when available), and a direct link to the listing.

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
  JSON object with:
  - total: number of de-duplicated results
  - sources: breakdown of results per source
  - query: the search parameters used
  - jobs: array of job listings, each with:
    - position, company, location, date, salary, jobUrl, agoTime, source
    - Himalayas results include additional fields: companySlug, employmentType,
      minSalary, maxSalary, currency, seniority, categories, locationRestrictions,
      timezoneRestrictions, applicationLink, guid, excerpt, expiryDate, description
    - Note: the guid field often maps to the Himalayas job listing HTML page,
      making it useful for scraping full job descriptions via job_description_search tool

Notes:
  - Results are de-duplicated across sources by company + position
  - LinkedIn may rate-limit; the tool implements backoff and caching (1hr TTL)
  - Himalayas API is free and requires no auth; results cached 1hr
  - If one source fails, results from the other are still returned`,
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
        const searchParams = {
          keywords: params.keywords,
          location: params.location,
          dateSincePosted: params.date_posted,
          jobType: params.job_type,
          remoteFilter: params.remote_filter,
          experienceLevel: params.experience_level,
          salary: params.salary,
          sortBy: params.sort_by,
        };

        // Search both sources in parallel
        const [linkedInJobs, himalayasJobs] = await Promise.allSettled([
          searchLinkedIn(searchParams),
          searchHimalayas(searchParams),
        ]);

        const allJobs: JobListing[] = [];
        const sourceCounts = { linkedin: 0, himalayas: 0 };

        if (linkedInJobs.status === "fulfilled") {
          allJobs.push(...linkedInJobs.value);
          sourceCounts.linkedin = linkedInJobs.value.length;
        } else {
          console.error(`[job_search] LinkedIn search failed: ${linkedInJobs.reason}`);
        }

        if (himalayasJobs.status === "fulfilled") {
          allJobs.push(...himalayasJobs.value);
          sourceCounts.himalayas = himalayasJobs.value.length;
        } else {
          console.error(`[job_search] Himalayas search failed: ${himalayasJobs.reason}`);
        }

        const deduped = deduplicateJobs(allJobs);

        // Sort by date descending if sort_by is "recent"
        if (params.sort_by === "recent") {
          deduped.sort((a, b) => {
            const dateA = a.date ? new Date(a.date).getTime() : 0;
            const dateB = b.date ? new Date(b.date).getTime() : 0;
            return dateB - dateA;
          });
        }

        if (deduped.length === 0) {
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
          total: deduped.length,
          sources: {
            linkedin: sourceCounts.linkedin,
            himalayas: sourceCounts.himalayas,
            after_dedup: deduped.length,
          },
          query: {
            keywords: params.keywords,
            location: params.location,
            date_posted: params.date_posted,
            job_type: params.job_type,
            remote_filter: params.remote_filter,
            experience_level: params.experience_level,
          },
          jobs: deduped,
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
              text: `Error searching jobs: ${msg}. This may be due to rate limiting. Try again in a few minutes or adjust your search parameters.`,
            },
          ],
        };
      }
    }
  );
}
