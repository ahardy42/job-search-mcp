import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../src/services/linkedin.js", () => ({
  fetchJobDescription: vi.fn(),
}));

import { fetchJobDescription } from "../../src/services/linkedin.js";
import { registerJobDescriptionSearchTool } from "../../src/tools/job-description-search.js";

const mockedFetchJobDescription = vi.mocked(fetchJobDescription);

function captureToolHandler(server: McpServer) {
  const registerSpy = vi.spyOn(server, "registerTool");
  registerJobDescriptionSearchTool(server);
  const call = registerSpy.mock.calls[0];
  return {
    name: call[0] as string,
    config: call[1] as any,
    handler: call[2] as (params: any) => Promise<any>,
  };
}

describe("job-description-search tool", () => {
  let server: McpServer;
  let tool: ReturnType<typeof captureToolHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer({ name: "test", version: "0.0.1" });
    tool = captureToolHandler(server);
  });

  it("registers with the correct tool name", () => {
    expect(tool.name).toBe("job_description_search");
  });

  it("is annotated as read-only", () => {
    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
  });

  it("fetches descriptions for a single URL", async () => {
    mockedFetchJobDescription.mockResolvedValue("Full job description text");

    const result = await tool.handler({
      urls: ["https://www.linkedin.com/jobs/view/123"],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].url).toBe("https://www.linkedin.com/jobs/view/123");
    expect(parsed[0].description).toBe("Full job description text");
  });

  it("fetches descriptions for multiple URLs", async () => {
    mockedFetchJobDescription
      .mockResolvedValueOnce("Description A")
      .mockResolvedValueOnce("Description B")
      .mockResolvedValueOnce("Description C");

    const result = await tool.handler({
      urls: [
        "https://www.linkedin.com/jobs/view/1",
        "https://www.linkedin.com/jobs/view/2",
        "https://www.linkedin.com/jobs/view/3",
      ],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveLength(3);
    expect(parsed[0].description).toBe("Description A");
    expect(parsed[1].description).toBe("Description B");
    expect(parsed[2].description).toBe("Description C");
  });

  it("reports individual URL errors without failing the batch", async () => {
    mockedFetchJobDescription
      .mockResolvedValueOnce("Good description")
      .mockRejectedValueOnce(new Error("job_url must be a LinkedIn URL"))
      .mockResolvedValueOnce("Another good one");

    const result = await tool.handler({
      urls: [
        "https://www.linkedin.com/jobs/view/1",
        "https://www.linkedin.com/jobs/view/2",
        "https://www.linkedin.com/jobs/view/3",
      ],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveLength(3);
    expect(parsed[0].description).toBe("Good description");
    expect(parsed[1].description).toContain("Error:");
    expect(parsed[1].description).toContain("LinkedIn URL");
    expect(parsed[2].description).toBe("Another good one");
  });

  it("processes URLs in batches of 3 (concurrency limit)", async () => {
    // 5 URLs should result in 2 batches: [0,1,2] and [3,4]
    const urls = Array.from({ length: 5 }, (_, i) => `https://www.linkedin.com/jobs/view/${i}`);
    mockedFetchJobDescription.mockResolvedValue("Description");

    const result = await tool.handler({ urls });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveLength(5);
    expect(mockedFetchJobDescription).toHaveBeenCalledTimes(5);
  });

  it("preserves URL-to-description mapping order", async () => {
    const urls = [
      "https://www.linkedin.com/jobs/view/AAA",
      "https://www.linkedin.com/jobs/view/BBB",
    ];
    mockedFetchJobDescription
      .mockResolvedValueOnce("First")
      .mockResolvedValueOnce("Second");

    const result = await tool.handler({ urls });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed[0].url).toContain("AAA");
    expect(parsed[0].description).toBe("First");
    expect(parsed[1].url).toContain("BBB");
    expect(parsed[1].description).toBe("Second");
  });
});
