import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getProfile, extractKeywords } from "../services/profile-loader.js";
import { matchKeywords, findRelevantSections } from "../services/keyword-matcher.js";
import { fetchJobDescription } from "../services/linkedin.js";
import { CHARACTER_LIMIT } from "../constants.js";

const JobAlignmentInputSchema = {
  job_description: z
    .string()
    .min(1, "Job description is required")
    .describe("Full job description text, or a brief description if providing a job_url"),
  job_url: z
    .string()
    .url()
    .optional()
    .describe("LinkedIn job URL to scrape the full description from"),
};

export function registerJobAlignmentTool(server: McpServer): void {
  server.registerTool(
    "job_alignment",
    {
      title: "Job Alignment Analysis",
      description: `Analyze how well your profile aligns with a job listing.

Compares your experience, skills, and background against a job description. Returns structured data including matched keywords, missing keywords, and the most relevant sections of your profile.

This tool provides raw structured context — the calling LLM should interpret and present the results.

Args:
  - job_description (string, required): The full job description text
  - job_url (string, optional): A LinkedIn job URL to scrape the description from

Returns:
  JSON object with:
  - matched_keywords: Skills/terms found in both your profile and the job
  - missing_keywords: Skills/terms in the job but not in your profile
  - relevant_sections: Your profile sections ranked by relevance to the job
  - experience_highlights: Key content from the most relevant sections

Notes:
  - Requires a profile directory with a manifest.json (see profile/manifest.json)
  - Keyword matching is simple tokenization — use the structured data for deeper LLM analysis
  - If job_url is provided, the tool will attempt to scrape the full description`,
      inputSchema: JobAlignmentInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      try {
        let jobText = params.job_description;

        if (params.job_url) {
          try {
            const scraped = await fetchJobDescription(params.job_url);
            jobText = scraped;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[job-alignment] Could not scrape job_url, using provided description: ${msg}`);
          }
        }

        const profile = await getProfile();
        const jobKeywords = extractKeywords(jobText);
        const { matched, missing } = matchKeywords(jobKeywords, profile.allKeywords);
        const relevantSections = findRelevantSections(jobText, profile);

        const output = {
          matched_keywords: matched,
          missing_keywords: missing,
          match_summary: {
            total_job_keywords: jobKeywords.length,
            matched_count: matched.length,
            missing_count: missing.length,
          },
          relevant_sections: relevantSections.map((r) => ({
            section: r.section.label,
            matched_keywords: r.matchedKeywords,
            match_count: r.matchCount,
            content: r.section.content,
          })),
          profile_loaded_at: profile.loadedAt.toISOString(),
        };

        let text = JSON.stringify(output, null, 2);

        if (text.length > CHARACTER_LIMIT) {
          const trimmed = {
            ...output,
            relevant_sections: output.relevant_sections.slice(0, 3).map((s) => ({
              ...s,
              content: s.content.slice(0, 500) + (s.content.length > 500 ? "..." : ""),
            })),
            truncated: true,
          };
          text = JSON.stringify(trimmed, null, 2);
        }

        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text",
              text: `Error analyzing job alignment: ${msg}. Ensure your profile directory is set up with a valid manifest.json.`,
            },
          ],
        };
      }
    }
  );
}
