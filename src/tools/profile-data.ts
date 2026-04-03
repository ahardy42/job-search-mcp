import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getProfile } from "../services/profile-loader.js";
import { CHARACTER_LIMIT } from "../constants.js";

export function registerProfileDataTool(server: McpServer): void {
  server.registerTool(
    "profile_data",
    {
      title: "Profile Data",
      description: `Load and return the user's profile sections and full text.

Returns all profile sections (experience, skills, education, etc.) so the calling LLM can use them for job alignment analysis, cover letter writing, or any other profile-based task.

Args: none

Returns:
  JSON object with:
  - sections: Array of { id, label, content } for each profile section
  - raw_text: The full concatenated profile text
  - loaded_at: ISO timestamp of when the profile was loaded

Notes:
  - Requires a profile directory with a manifest.json (see profile/manifest.json)
  - Profile is cached per session; first call parses all source files`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      try {
        const profile = await getProfile();

        const output = {
          sections: profile.sections.map((s) => ({
            id: s.id,
            label: s.label,
            content: s.content,
          })),
          raw_text: profile.rawText,
          loaded_at: profile.loadedAt.toISOString(),
        };

        let text = JSON.stringify(output, null, 2);

        if (text.length > CHARACTER_LIMIT) {
          const trimmed = {
            ...output,
            sections: output.sections.map((s) => ({
              ...s,
              content: s.content.slice(0, 500) + (s.content.length > 500 ? "..." : ""),
            })),
            raw_text: "[truncated — use individual section content above]",
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
              text: `Error loading profile data: ${msg}. Ensure your profile directory is set up with a valid manifest.json.`,
            },
          ],
        };
      }
    }
  );
}
