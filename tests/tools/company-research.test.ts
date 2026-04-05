import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../src/services/web-scraper.js", () => ({
  researchCompany: vi.fn(),
}));
vi.mock("../../src/services/himalayas.js", () => ({
  fetchCompanyProfile: vi.fn(),
}));

import { researchCompany } from "../../src/services/web-scraper.js";
import { fetchCompanyProfile } from "../../src/services/himalayas.js";
import { registerCompanyResearchTool } from "../../src/tools/company-research.js";

const mockedResearchCompany = vi.mocked(researchCompany);
const mockedFetchCompanyProfile = vi.mocked(fetchCompanyProfile);

function captureToolHandler(server: McpServer) {
  const registerSpy = vi.spyOn(server, "registerTool");
  registerCompanyResearchTool(server);
  const call = registerSpy.mock.calls[0];
  return {
    name: call[0] as string,
    config: call[1] as any,
    handler: call[2] as (params: any) => Promise<any>,
  };
}

function makeResearchData(overrides: Partial<any> = {}) {
  return {
    company_name: "TestCo",
    official_description: "A test company",
    products_services: ["Product A"],
    recent_news: [{ headline: "TestCo raises $10M", source: "techcrunch.com", url: "https://techcrunch.com/testco" }],
    glassdoor_signals: ["Great culture"],
    raw_about_page: "We build things",
    sources: ["https://testco.com"],
    ...overrides,
  };
}

describe("company-research tool", () => {
  let server: McpServer;
  let tool: ReturnType<typeof captureToolHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer({ name: "test", version: "0.0.1" });
    tool = captureToolHandler(server);
    mockedFetchCompanyProfile.mockResolvedValue(null);
  });

  it("registers with the correct tool name", () => {
    expect(tool.name).toBe("company_research");
  });

  it("is annotated as read-only", () => {
    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
  });

  it("returns structured company research data", async () => {
    mockedResearchCompany.mockResolvedValue(makeResearchData());

    const result = await tool.handler({ company_name: "TestCo" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.company_name).toBe("TestCo");
    expect(parsed.official_description).toBe("A test company");
    expect(parsed.products_services).toContain("Product A");
    expect(parsed.recent_news).toHaveLength(1);
    expect(parsed.himalayas_profile).toBeNull();
  });

  it("passes company_url to the service when provided", async () => {
    mockedResearchCompany.mockResolvedValue(makeResearchData());

    await tool.handler({
      company_name: "TestCo",
      company_url: "https://testco.com/about",
    });

    expect(mockedResearchCompany).toHaveBeenCalledWith("TestCo", "https://testco.com/about");
  });

  it("fetches Himalayas profile when himalayas_slug is provided", async () => {
    mockedResearchCompany.mockResolvedValue(makeResearchData());
    mockedFetchCompanyProfile.mockResolvedValue({
      url: "https://himalayas.app/companies/testco",
      name: "TestCo",
      description: "Himalayas description",
    });

    const result = await tool.handler({
      company_name: "TestCo",
      himalayas_slug: "testco",
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(mockedFetchCompanyProfile).toHaveBeenCalledWith("testco");
    expect(parsed.himalayas_profile).not.toBeNull();
    expect(parsed.himalayas_profile.name).toBe("TestCo");
    expect(parsed.himalayas_profile.description).toBe("Himalayas description");
  });

  it("does not fetch Himalayas profile when slug is not provided", async () => {
    mockedResearchCompany.mockResolvedValue(makeResearchData());

    await tool.handler({ company_name: "TestCo" });

    expect(mockedFetchCompanyProfile).not.toHaveBeenCalled();
  });

  it("handles Himalayas profile fetch failure gracefully", async () => {
    mockedResearchCompany.mockResolvedValue(makeResearchData());
    mockedFetchCompanyProfile.mockRejectedValue(new Error("Browser crashed"));

    const result = await tool.handler({
      company_name: "TestCo",
      himalayas_slug: "testco",
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.company_name).toBe("TestCo");
    expect(parsed.himalayas_profile).toBeNull();
  });

  it("truncates oversized results", async () => {
    const longData = makeResearchData({
      products_services: Array.from({ length: 100 }, (_, i) => `Product ${i}: ${"x".repeat(200)}`),
      recent_news: Array.from({ length: 50 }, (_, i) => ({
        headline: `News ${i}`,
        source: "src",
        url: "https://example.com",
      })),
      glassdoor_signals: Array.from({ length: 20 }, (_, i) => `Signal ${i}: ${"y".repeat(200)}`),
      raw_about_page: "z".repeat(30000),
      sources: Array.from({ length: 50 }, (_, i) => `https://source${i}.com`),
    });
    mockedResearchCompany.mockResolvedValue(longData);

    const result = await tool.handler({ company_name: "BigCo" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.truncated).toBe(true);
    expect(parsed.products_services.length).toBeLessThanOrEqual(3);
    expect(parsed.recent_news.length).toBeLessThanOrEqual(3);
    expect(parsed.glassdoor_signals.length).toBeLessThanOrEqual(2);
    expect(parsed.sources.length).toBeLessThanOrEqual(10);
    if (parsed.raw_about_page) {
      expect(parsed.raw_about_page.length).toBeLessThanOrEqual(2000);
    }
  });

  it("returns error message on service failure", async () => {
    mockedResearchCompany.mockRejectedValue(new Error("Browser launch failed"));

    const result = await tool.handler({ company_name: "FailCo" });

    expect(result.content[0].text).toContain("Error researching company");
    expect(result.content[0].text).toContain("Browser launch failed");
  });
});
