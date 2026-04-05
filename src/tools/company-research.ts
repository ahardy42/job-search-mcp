import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { researchCompany } from "../services/web-scraper.js";
import { fetchCompanyProfile } from "../services/himalayas.js";
import { CHARACTER_LIMIT } from "../constants.js";

const CompanyResearchInputSchema = {
  company_name: z
    .string()
    .min(1, "Company name is required")
    .describe("Company name to research"),
  company_url: z
    .string()
    .url()
    .optional()
    .describe("Company website URL for direct scraping (e.g. their About page)"),
  himalayas_slug: z
    .string()
    .optional()
    .describe("Himalayas company slug (from job_search results companySlug field) to fetch their Himalayas profile"),
};

export function registerCompanyResearchTool(server: McpServer): void {
  server.registerTool(
    "company_research",
    {
      title: "Company Research",
      description: `Research a company using web search, optional website scraping, and Himalayas company profiles.

Searches DuckDuckGo for company information, recent news, and Glassdoor reviews. Optionally scrapes the company's own website. If a himalayas_slug is provided (from job_search results), also fetches the company's Himalayas profile page (https://himalayas.app/companies/{slug}) which contains structured company data. Returns structured data for the calling LLM to synthesize.

Args:
  - company_name (string, required): The company to research
  - company_url (string, optional): Direct URL to scrape (e.g. company About page)
  - himalayas_slug (string, optional): Company slug from job_search results to fetch Himalayas profile

Returns:
  JSON object with:
  - official_description: What public sources say the company does
  - products_services: Extracted product/service mentions
  - recent_news: Recent headlines about the company
  - glassdoor_signals: Snippets from Glassdoor search results
  - raw_about_page: Scraped text from company URL (if provided)
  - himalayas_profile: Structured data from Himalayas company page (if slug provided)
  - sources: URLs of all sources consulted

Notes:
  - Uses Playwright for web scraping (headless Chromium)
  - Results are cached for 24 hours
  - First call may be slow as the browser launches
  - The calling LLM should use this raw data to produce the analysis`,
      inputSchema: CompanyResearchInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (params) => {
      try {
        // Run web research and Himalayas profile fetch in parallel
        const [data, himalayasProfile] = await Promise.all([
          researchCompany(params.company_name, params.company_url),
          params.himalayas_slug
            ? fetchCompanyProfile(params.himalayas_slug).catch((e) => {
                console.error(`[company_research] Himalayas profile failed: ${e}`);
                return null;
              })
            : Promise.resolve(null),
        ]);

        const output = {
          ...data,
          himalayas_profile: himalayasProfile,
        };

        let text = JSON.stringify(output);

        if (text.length > CHARACTER_LIMIT) {
          const trimmed = {
            ...output,
            products_services: data.products_services.slice(0, 3),
            recent_news: data.recent_news.slice(0, 3),
            glassdoor_signals: data.glassdoor_signals.slice(0, 2),
            raw_about_page: data.raw_about_page?.slice(0, 2000) || null,
            sources: data.sources.slice(0, 10),
            truncated: true,
          };
          text = JSON.stringify(trimmed);
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
              text: `Error researching company: ${msg}. This may be due to network issues or the Playwright browser failing to launch.`,
            },
          ],
        };
      }
    }
  );
}
