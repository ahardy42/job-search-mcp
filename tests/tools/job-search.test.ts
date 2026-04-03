import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Mock the linkedin service
vi.mock("../../src/services/linkedin.js", () => ({
  searchJobs: vi.fn(),
}));

import { searchJobs } from "../../src/services/linkedin.js";
import { registerJobSearchTool } from "../../src/tools/job-search.js";

const mockedSearchJobs = vi.mocked(searchJobs);

// Helper to extract the tool handler registered on the server
function captureToolHandler(server: McpServer) {
  const registerSpy = vi.spyOn(server, "registerTool");
  registerJobSearchTool(server);
  const call = registerSpy.mock.calls[0];
  // registerTool(name, config, handler)
  return {
    name: call[0] as string,
    config: call[1] as any,
    handler: call[2] as (params: any) => Promise<any>,
  };
}

describe("job-search tool", () => {
  let server: McpServer;
  let tool: ReturnType<typeof captureToolHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer({ name: "test", version: "0.0.1" });
    tool = captureToolHandler(server);
  });

  it("registers with the correct tool name", () => {
    expect(tool.name).toBe("job_search");
  });

  it("is annotated as read-only and non-destructive", () => {
    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
  });

  it("returns formatted job results on success", async () => {
    mockedSearchJobs.mockResolvedValue([
      {
        position: "Senior Engineer",
        company: "TestCo",
        location: "Remote",
        date: "2025-03-28",
        salary: "$130k",
        jobUrl: "https://www.linkedin.com/jobs/view/1",
        agoTime: "1 day ago",
      },
    ]);

    const result = await tool.handler({
      keywords: "engineer",
      location: "United States",
      date_posted: "past week",
      job_type: "full time",
      remote_filter: "remote",
      experience_level: "senior",
      sort_by: "recent",
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.total).toBe(1);
    expect(parsed.jobs[0].position).toBe("Senior Engineer");
    expect(parsed.query.keywords).toBe("engineer");
  });

  it("returns a helpful message when no jobs found", async () => {
    mockedSearchJobs.mockResolvedValue([]);

    const result = await tool.handler({
      keywords: "nonexistent",
      location: "United States",
      date_posted: "past week",
      job_type: "full time",
      remote_filter: "remote",
      experience_level: "senior",
      sort_by: "recent",
    });

    expect(result.content[0].text).toContain("No jobs found");
    expect(result.content[0].text).toContain("nonexistent");
  });

  it("returns error message on service failure", async () => {
    mockedSearchJobs.mockRejectedValue(new Error("Rate limited"));

    const result = await tool.handler({
      keywords: "engineer",
      location: "United States",
      date_posted: "past week",
      job_type: "full time",
      remote_filter: "remote",
      experience_level: "senior",
      sort_by: "recent",
    });

    expect(result.content[0].text).toContain("Error searching jobs");
    expect(result.content[0].text).toContain("Rate limited");
  });

  it("passes all parameters to the searchJobs service", async () => {
    mockedSearchJobs.mockResolvedValue([]);

    await tool.handler({
      keywords: "react developer",
      location: "San Francisco",
      date_posted: "24hr",
      job_type: "contract",
      remote_filter: "hybrid",
      experience_level: "director",
      salary: "100000",
      sort_by: "relevant",
    });

    expect(mockedSearchJobs).toHaveBeenCalledWith({
      keywords: "react developer",
      location: "San Francisco",
      dateSincePosted: "24hr",
      jobType: "contract",
      remoteFilter: "hybrid",
      experienceLevel: "director",
      salary: "100000",
      sortBy: "relevant",
    });
  });
});
