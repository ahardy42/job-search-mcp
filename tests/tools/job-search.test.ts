import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Mock both search services
vi.mock("../../src/services/linkedin.js", () => ({
  searchJobs: vi.fn(),
}));
vi.mock("../../src/services/himalayas.js", () => ({
  searchJobs: vi.fn(),
}));

import { searchJobs as searchLinkedIn } from "../../src/services/linkedin.js";
import { searchJobs as searchHimalayas } from "../../src/services/himalayas.js";
import { registerJobSearchTool } from "../../src/tools/job-search.js";

const mockedSearchLinkedIn = vi.mocked(searchLinkedIn);
const mockedSearchHimalayas = vi.mocked(searchHimalayas);

function captureToolHandler(server: McpServer) {
  const registerSpy = vi.spyOn(server, "registerTool");
  registerJobSearchTool(server);
  const call = registerSpy.mock.calls[0];
  return {
    name: call[0] as string,
    config: call[1] as any,
    handler: call[2] as (params: any) => Promise<any>,
  };
}

const defaultParams = {
  keywords: "engineer",
  location: "United States",
  date_posted: "past week",
  job_type: "full time",
  remote_filter: "remote",
  experience_level: "senior",
  sort_by: "recent",
};

describe("job-search tool", () => {
  let server: McpServer;
  let tool: ReturnType<typeof captureToolHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer({ name: "test", version: "0.0.1" });
    tool = captureToolHandler(server);
    mockedSearchLinkedIn.mockResolvedValue([]);
    mockedSearchHimalayas.mockResolvedValue([]);
  });

  it("registers with the correct tool name", () => {
    expect(tool.name).toBe("job_search");
  });

  it("is annotated as read-only and non-destructive", () => {
    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
  });

  it("searches both LinkedIn and Himalayas in parallel", async () => {
    await tool.handler(defaultParams);

    expect(mockedSearchLinkedIn).toHaveBeenCalledTimes(1);
    expect(mockedSearchHimalayas).toHaveBeenCalledTimes(1);
  });

  it("merges results from both sources", async () => {
    mockedSearchLinkedIn.mockResolvedValue([
      {
        position: "LinkedIn Job", company: "LiCo", location: "Remote",
        date: "2025-04-01", salary: "$130k", jobUrl: "https://linkedin.com/jobs/1",
        agoTime: "1 day ago", source: "linkedin",
      },
    ]);
    mockedSearchHimalayas.mockResolvedValue([
      {
        position: "Himalayas Job", company: "HiCo", location: "Worldwide",
        date: "2025-04-02", salary: "USD 120,000", jobUrl: "https://himalayas.app/jobs/1",
        agoTime: "Today", source: "himalayas",
      },
    ]);

    const result = await tool.handler(defaultParams);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.total).toBe(2);
    expect(parsed.sources.linkedin).toBe(1);
    expect(parsed.sources.himalayas).toBe(1);
    expect(parsed.sources.after_dedup).toBe(2);
  });

  it("de-duplicates jobs with same company + position across sources", async () => {
    mockedSearchLinkedIn.mockResolvedValue([
      {
        position: "Senior Engineer", company: "SharedCo", location: "Remote",
        date: "2025-04-01", salary: "Not specified", jobUrl: "https://linkedin.com/jobs/1",
        agoTime: "1 day ago", source: "linkedin",
      },
    ]);
    mockedSearchHimalayas.mockResolvedValue([
      {
        position: "Senior Engineer", company: "SharedCo", location: "Worldwide",
        date: "2025-04-01", salary: "USD 150,000", jobUrl: "https://himalayas.app/jobs/1",
        agoTime: "1 day ago", source: "himalayas", minSalary: 150000,
      },
    ]);

    const result = await tool.handler(defaultParams);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.total).toBe(1);
    // Should prefer the listing with more data (Himalayas has salary)
    expect(parsed.jobs[0].source).toBe("himalayas");
    expect(parsed.jobs[0].salary).toContain("150,000");
  });

  it("returns results even if LinkedIn fails", async () => {
    mockedSearchLinkedIn.mockRejectedValue(new Error("Rate limited"));
    mockedSearchHimalayas.mockResolvedValue([
      {
        position: "Surviving Job", company: "HiCo", location: "Remote",
        date: "2025-04-01", salary: "Not specified", jobUrl: "https://himalayas.app/jobs/1",
        agoTime: "1 day ago", source: "himalayas",
      },
    ]);

    const result = await tool.handler(defaultParams);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.total).toBe(1);
    expect(parsed.sources.linkedin).toBe(0);
    expect(parsed.sources.himalayas).toBe(1);
  });

  it("returns results even if Himalayas fails", async () => {
    mockedSearchLinkedIn.mockResolvedValue([
      {
        position: "LinkedIn Only", company: "LiCo", location: "Remote",
        date: "2025-04-01", salary: "$120k", jobUrl: "https://linkedin.com/jobs/1",
        agoTime: "1 day ago", source: "linkedin",
      },
    ]);
    mockedSearchHimalayas.mockRejectedValue(new Error("API down"));

    const result = await tool.handler(defaultParams);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.total).toBe(1);
    expect(parsed.sources.linkedin).toBe(1);
    expect(parsed.sources.himalayas).toBe(0);
  });

  it("returns helpful message when both sources return empty", async () => {
    const result = await tool.handler(defaultParams);
    expect(result.content[0].text).toContain("No jobs found");
  });

  it("returns error message when both sources throw", async () => {
    mockedSearchLinkedIn.mockRejectedValue(new Error("fail1"));
    mockedSearchHimalayas.mockRejectedValue(new Error("fail2"));

    const result = await tool.handler(defaultParams);
    expect(result.content[0].text).toContain("No jobs found");
  });

  it("sorts results by date descending when sort_by is recent", async () => {
    mockedSearchLinkedIn.mockResolvedValue([
      {
        position: "Older", company: "Co", location: "Remote",
        date: "2025-03-28", salary: "", jobUrl: "", agoTime: "", source: "linkedin",
      },
    ]);
    mockedSearchHimalayas.mockResolvedValue([
      {
        position: "Newer", company: "Co2", location: "Remote",
        date: "2025-04-02", salary: "", jobUrl: "", agoTime: "", source: "himalayas",
      },
    ]);

    const result = await tool.handler(defaultParams);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.jobs[0].position).toBe("Newer");
    expect(parsed.jobs[1].position).toBe("Older");
  });

  it("passes all parameters to both search services", async () => {
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

    const expectedParams = {
      keywords: "react developer",
      location: "San Francisco",
      dateSincePosted: "24hr",
      jobType: "contract",
      remoteFilter: "hybrid",
      experienceLevel: "director",
      salary: "100000",
      sortBy: "relevant",
    };

    expect(mockedSearchLinkedIn).toHaveBeenCalledWith(expectedParams);
    expect(mockedSearchHimalayas).toHaveBeenCalledWith(expectedParams);
  });

  it("includes query metadata in response", async () => {
    mockedSearchLinkedIn.mockResolvedValue([
      {
        position: "Job", company: "Co", location: "Remote",
        date: "2025-04-01", salary: "", jobUrl: "", agoTime: "", source: "linkedin",
      },
    ]);

    const result = await tool.handler(defaultParams);
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.query.keywords).toBe("engineer");
    expect(parsed.query.location).toBe("United States");
    expect(parsed.query.remote_filter).toBe("remote");
  });
});
