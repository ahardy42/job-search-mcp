import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mock constants to use fixture profile directory
vi.mock("../../src/constants.js", async (importOriginal) => {
  const { default: p } = await import("path");
  const { fileURLToPath: f } = await import("url");
  const dir = p.dirname(f(import.meta.url));
  const original = await importOriginal<typeof import("../../src/constants.js")>();
  return {
    ...original,
    PROFILE_DIR: p.resolve(dir, "..", "fixtures", "profile"),
  };
});

// Define a complete mock Response object
const mockResponse = {
  ok: true,
  status: 200,
  statusText: "OK",
  headers: new Headers(),
  redirected: false,
  url: "",
  type: "basic" as const,
  text: vi.fn().mockResolvedValue(""),
  json: vi.fn().mockResolvedValue({}),
  blob: vi.fn().mockResolvedValue(new Blob()),
  arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  formData: vi.fn().mockResolvedValue(new FormData()),
  bytes: vi.fn().mockResolvedValue(new Uint8Array()),
  clone: vi.fn(),
  body: null,
  bodyUsed: false,
};

// Set clone to return itself to avoid circular reference issues
mockResponse.clone.mockReturnValue(mockResponse);

// Mock external network services so integration tests run offline
global.fetch = vi.fn().mockResolvedValue(mockResponse);

vi.mock("random-useragent", () => ({
  default: {
    getRandom: vi.fn(() => "TestAgent/1.0"),
  },
}));

vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(() =>
      Promise.resolve({
        newContext: vi.fn(() =>
          Promise.resolve({
            newPage: vi.fn(() =>
              Promise.resolve({
                goto: vi.fn(),
                url: vi.fn(() => "https://www.linkedin.com/jobs/view/123"),
                title: vi.fn(() => "Test Page"),
                locator: vi.fn(() => ({
                  first: vi.fn().mockReturnThis(),
                  count: vi.fn(() => Promise.resolve(0)),
                  nth: vi.fn().mockReturnThis(),
                  textContent: vi.fn(() => Promise.resolve("test content")),
                  evaluate: vi.fn(),
                  getAttribute: vi.fn(),
                })),
              })
            ),
            close: vi.fn(),
          })
        ),
        close: vi.fn(),
      })
    ),
  },
}));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerJobSearchTool } from "../../src/tools/job-search.js";
import { registerProfileDataTool } from "../../src/tools/profile-data.js";
import { registerCompanyResearchTool } from "../../src/tools/company-research.js";
import { registerJobDescriptionSearchTool } from "../../src/tools/job-description-search.js";

describe("MCP server integration", () => {
  let server: McpServer;
  let client: Client;

  beforeAll(async () => {
    server = new McpServer({ name: "test-server", version: "0.0.1" });
    registerJobSearchTool(server);
    registerProfileDataTool(server);
    registerCompanyResearchTool(server);
    registerJobDescriptionSearchTool(server);

    client = new Client({ name: "test-client", version: "0.0.1" });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
  });

  describe("tool listing", () => {
    it("lists all 4 registered tools", async () => {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();

      expect(names).toEqual([
        "company_research",
        "job_description_search",
        "job_search",
        "profile_data",
      ]);
    });

    it("each tool has a title and description", async () => {
      const { tools } = await client.listTools();

      for (const tool of tools) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
      }
    });
  });

  describe("profile_data tool call", () => {
    it("returns profile sections from fixture data", async () => {
      const result = await client.callTool({ name: "profile_data", arguments: {} });
      const text = (result.content as any[])[0].text;
      const parsed = JSON.parse(text);

      expect(parsed.sections).toHaveLength(2);
      expect(parsed.sections[0].id).toBe("experience");
      expect(parsed.sections[0].content).toContain("Senior Software Engineer");
      expect(parsed.sections[1].id).toBe("skills");
      expect(parsed.sections[1].content).toContain("TypeScript");
      expect(parsed.raw_text).toContain("Acme Corp");
      expect(parsed.loaded_at).toBeTruthy();
    });

    it("returns sections without keyword fields", async () => {
      const result = await client.callTool({ name: "profile_data", arguments: {} });
      const text = (result.content as any[])[0].text;
      const parsed = JSON.parse(text);

      for (const section of parsed.sections) {
        expect(section).not.toHaveProperty("keywords");
      }
      expect(parsed).not.toHaveProperty("allKeywords");
    });
  });

  describe("job_search tool call", () => {
    it("returns job listings from mocked LinkedIn response", async () => {
      const html = `<html><body><ul>
        <li>
          <div class="base-search-card__title">Integration Test Engineer</div>
          <div class="base-search-card__subtitle">IntegrationCo</div>
          <div class="job-search-card__location">Remote</div>
          <time datetime="2025-04-01">Apr 1</time>
          <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/int-1"></a>
          <div class="job-search-card__listdate">today</div>
        </li>
      </ul></body></html>`;

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ...mockResponse,
          text: vi.fn().mockResolvedValue(html),
        } as Response)
        .mockResolvedValueOnce({
          ...mockResponse,
          text: vi.fn().mockResolvedValue("<html><body><ul></ul></body></html>"),
        } as Response);

      const result = await client.callTool({
        name: "job_search",
        arguments: { keywords: "integration test" },
      });
      const text = (result.content as any[])[0].text;
      const parsed = JSON.parse(text);

      expect(parsed.total).toBe(1);
      expect(parsed.jobs[0].position).toBe("Integration Test Engineer");
      expect(parsed.jobs[0].company).toBe("IntegrationCo");
    });

    it("uses default parameter values when not specified", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ...mockResponse,
        text: vi.fn().mockResolvedValue("<html><body><ul></ul></body></html>"),
      } as Response);

      const result = await client.callTool({
        name: "job_search",
        arguments: { keywords: "defaults test" },
      });
      const text = (result.content as any[])[0].text;

      expect(text).toContain("No jobs found");
    });
  });

  describe("job_description_search tool call", () => {
    it("returns error for non-LinkedIn URLs", async () => {
      const result = await client.callTool({
        name: "job_description_search",
        arguments: {
          urls: ["https://evil.com/jobs/123"],
        },
      });
      const text = (result.content as any[])[0].text;
      const parsed = JSON.parse(text);

      expect(parsed[0].description).toContain("Error:");
      expect(parsed[0].description).toContain("LinkedIn URL");
    });

    it("returns error for HTTP (non-HTTPS) LinkedIn URLs", async () => {
      const result = await client.callTool({
        name: "job_description_search",
        arguments: {
          urls: ["http://www.linkedin.com/jobs/view/123"],
        },
      });
      const text = (result.content as any[])[0].text;
      const parsed = JSON.parse(text);

      expect(parsed[0].description).toContain("Error:");
      expect(parsed[0].description).toContain("HTTPS");
    });
  });

  describe("company_research tool call", () => {
    it("returns structured research data", async () => {
      const result = await client.callTool({
        name: "company_research",
        arguments: { company_name: "TestCo" },
      });
      const text = (result.content as any[])[0].text;
      const parsed = JSON.parse(text);

      expect(parsed.company_name).toBe("TestCo");
      expect(parsed).toHaveProperty("official_description");
      expect(parsed).toHaveProperty("products_services");
      expect(parsed).toHaveProperty("recent_news");
      expect(parsed).toHaveProperty("sources");
    });
  });

  describe("security: tool input validation", () => {
    // MCP SDK returns validation errors as isError: true results, not thrown exceptions

    it("rejects job_search with empty keywords", async () => {
      const result = await client.callTool({
        name: "job_search",
        arguments: { keywords: "" },
      });
      expect(result.isError).toBe(true);
      expect((result.content as any[])[0].text).toContain("Keywords are required");
    });

    it("rejects job_description_search with no URLs", async () => {
      const result = await client.callTool({
        name: "job_description_search",
        arguments: { urls: [] },
      });
      expect(result.isError).toBe(true);
      expect((result.content as any[])[0].text).toContain("At least one URL is required");
    });

    it("rejects job_description_search with invalid URL format", async () => {
      const result = await client.callTool({
        name: "job_description_search",
        arguments: { urls: ["not-a-url"] },
      });
      expect(result.isError).toBe(true);
      expect((result.content as any[])[0].text).toContain("Invalid url");
    });

    it("rejects company_research with empty company name", async () => {
      const result = await client.callTool({
        name: "company_research",
        arguments: { company_name: "" },
      });
      expect(result.isError).toBe(true);
      expect((result.content as any[])[0].text).toContain("Company name is required");
    });

    it("rejects company_research with invalid company_url", async () => {
      const result = await client.callTool({
        name: "company_research",
        arguments: { company_name: "TestCo", company_url: "not-a-url" },
      });
      expect(result.isError).toBe(true);
      expect((result.content as any[])[0].text).toContain("Invalid url");
    });
  });
});
