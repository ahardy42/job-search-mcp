import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getProfile, extractKeywords } from "../services/profile-loader.js";
import { matchKeywords, findRelevantSections } from "../services/keyword-matcher.js";
import { fetchJobDescription } from "../services/linkedin.js";
import { CHARACTER_LIMIT } from "../constants.js";

const CoverLetterInputSchema = {
  job_description: z
    .string()
    .min(1, "Job description is required")
    .describe("Full job description text"),
  job_url: z
    .string()
    .url()
    .optional()
    .describe("LinkedIn job URL to scrape the full description from"),
  company_name: z
    .string()
    .optional()
    .describe("Company name for personalized hooks"),
  tone: z
    .enum(["formal", "conversational"])
    .default("formal")
    .describe("Desired tone for the cover letter"),
  focus_areas: z
    .array(z.string())
    .optional()
    .describe("Specific skills or experiences to emphasize (e.g. ['React', 'team leadership'])"),
};

export function registerCoverLetterBuilderTool(server: McpServer): void {
  server.registerTool(
    "cover_letter_builder",
    {
      title: "Cover Letter Builder",
      description: `Assemble structured context from your profile to help write a targeted cover letter.

Maps your experience to job requirements, generates talking points, and suggests a letter structure. The calling LLM uses this context to write the actual cover letter.

Args:
  - job_description (string, required): The full job description text
  - job_url (string, optional): LinkedIn job URL to scrape the description from
  - company_name (string, optional): Company name for tailored hooks
  - tone (enum): "formal" or "conversational" (default: "formal")
  - focus_areas (string[], optional): Skills or experiences to emphasize

Returns:
  JSON object with:
  - matched_experience: Your experience mapped to specific job requirements
  - talking_points: Key points to highlight in the letter
  - suggested_structure: Recommended letter structure with section guidance
  - tone: The requested tone
  - profile_sections_used: Which profile sections contributed

Notes:
  - Requires a profile directory with a manifest.json
  - This tool provides structured context, not a finished letter
  - The calling LLM should use the output to compose the actual cover letter`,
      inputSchema: CoverLetterInputSchema,
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
            console.error(`[cover-letter] Could not scrape job_url, using provided description: ${msg}`);
          }
        }

        const profile = await getProfile();
        const jobKeywords = extractKeywords(jobText);
        const { matched, missing } = matchKeywords(jobKeywords, profile.allKeywords);
        const relevantSections = findRelevantSections(jobText, profile);

        // Build experience-to-requirement mappings
        const matchedExperience = relevantSections.slice(0, 4).map((r) => ({
          section: r.section.label,
          matched_requirements: r.matchedKeywords,
          relevant_content: r.section.content,
        }));

        // Generate talking points from matched keywords and sections
        const talkingPoints: string[] = [];
        if (matched.length > 0) {
          talkingPoints.push(
            `Your profile matches ${matched.length} of ${jobKeywords.length} key terms from the job description`
          );
        }
        for (const section of relevantSections.slice(0, 3)) {
          talkingPoints.push(
            `Your ${section.section.label} section aligns on: ${section.matchedKeywords.slice(0, 5).join(", ")}`
          );
        }
        if (missing.length > 0) {
          talkingPoints.push(
            `Consider addressing these gaps or framing transferable skills: ${missing.slice(0, 5).join(", ")}`
          );
        }

        // Apply focus area boosting
        let focusAreaNotes: string[] | undefined;
        if (params.focus_areas && params.focus_areas.length > 0) {
          const focusLower = params.focus_areas.map((f) => f.toLowerCase());
          focusAreaNotes = [];
          for (const section of profile.sections) {
            const contentLower = section.content.toLowerCase();
            const matches = focusLower.filter((f) => contentLower.includes(f));
            if (matches.length > 0) {
              focusAreaNotes.push(
                `"${section.label}" contains content related to: ${matches.join(", ")}`
              );
            }
          }
        }

        const output = {
          matched_experience: matchedExperience,
          talking_points: talkingPoints,
          focus_area_notes: focusAreaNotes,
          company_name: params.company_name || null,
          suggested_structure: {
            opening: params.company_name
              ? `Reference ${params.company_name}'s mission or recent work that resonates with your background`
              : "Open with enthusiasm for the role and a brief connection to your strongest qualification",
            body_paragraphs: relevantSections.slice(0, 3).map((r) => ({
              theme: r.section.label,
              focus: r.matchedKeywords.slice(0, 3).join(", "),
              guidance: `Draw from your ${r.section.label} to address: ${r.matchedKeywords.slice(0, 3).join(", ")}`,
            })),
            closing: "Express enthusiasm, mention a specific contribution you'd make, and invite follow-up",
          },
          tone: params.tone,
          keyword_match: {
            matched: matched,
            gaps: missing,
          },
          profile_sections_used: relevantSections.map((r) => r.section.id),
          profile_loaded_at: profile.loadedAt.toISOString(),
        };

        let text = JSON.stringify(output, null, 2);

        if (text.length > CHARACTER_LIMIT) {
          const trimmed = {
            ...output,
            matched_experience: output.matched_experience.map((e) => ({
              ...e,
              relevant_content: e.relevant_content.slice(0, 300) + "...",
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
              text: `Error building cover letter context: ${msg}. Ensure your profile directory is set up with a valid manifest.json.`,
            },
          ],
        };
      }
    }
  );
}
