import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../../src/services/linkedin.js", () => ({
  fetchJobDescription: vi.fn(),
}));
vi.mock("../../src/services/himalayas.js", () => ({
  fetchJobDescription: vi.fn(),
}));

import { fetchJobDescription as fetchLinkedIn } from "../../src/services/linkedin.js";
import { fetchJobDescription as fetchHimalayas } from "../../src/services/himalayas.js";
import { registerJobDescriptionSearchTool } from "../../src/tools/job-description-search.js";

const mockedFetchLinkedIn = vi.mocked(fetchLinkedIn);
const mockedFetchHimalayas = vi.mocked(fetchHimalayas);

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

  it("routes LinkedIn URLs to the LinkedIn fetcher", async () => {
    mockedFetchLinkedIn.mockResolvedValue("LinkedIn description");

    const result = await tool.handler({
      urls: ["https://www.linkedin.com/jobs/view/123"],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(mockedFetchLinkedIn).toHaveBeenCalledWith("https://www.linkedin.com/jobs/view/123");
    expect(mockedFetchHimalayas).not.toHaveBeenCalled();
    expect(parsed[0].source).toBe("linkedin");
    expect(parsed[0].description).toBe("LinkedIn description");
  });

  it("routes Himalayas URLs to the Himalayas fetcher", async () => {
    mockedFetchHimalayas.mockResolvedValue("Himalayas description");

    const result = await tool.handler({
      urls: ["https://himalayas.app/companies/testco/jobs/eng-123"],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(mockedFetchHimalayas).toHaveBeenCalledWith("https://himalayas.app/companies/testco/jobs/eng-123");
    expect(mockedFetchLinkedIn).not.toHaveBeenCalled();
    expect(parsed[0].source).toBe("himalayas");
    expect(parsed[0].description).toBe("Himalayas description");
  });

  it("handles mixed URLs from both sources", async () => {
    mockedFetchLinkedIn.mockResolvedValue("LinkedIn desc");
    mockedFetchHimalayas.mockResolvedValue("Himalayas desc");

    const result = await tool.handler({
      urls: [
        "https://www.linkedin.com/jobs/view/1",
        "https://himalayas.app/companies/co/jobs/eng-1",
      ],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].source).toBe("linkedin");
    expect(parsed[0].description).toBe("LinkedIn desc");
    expect(parsed[1].source).toBe("himalayas");
    expect(parsed[1].description).toBe("Himalayas desc");
  });

  it("rejects unsupported hosts with error message", async () => {
    const result = await tool.handler({
      urls: ["https://evil.com/jobs/123"],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed[0].description).toContain("Error:");
    expect(parsed[0].description).toContain("Unsupported host");
  });

  it("reports individual URL errors without failing the batch", async () => {
    mockedFetchLinkedIn
      .mockResolvedValueOnce("Good description")
      .mockRejectedValueOnce(new Error("Failed to extract"));
    mockedFetchHimalayas.mockResolvedValueOnce("Himalayas good");

    const result = await tool.handler({
      urls: [
        "https://www.linkedin.com/jobs/view/1",
        "https://www.linkedin.com/jobs/view/2",
        "https://himalayas.app/companies/co/jobs/eng-1",
      ],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveLength(3);
    expect(parsed[0].description).toBe("Good description");
    expect(parsed[1].description).toContain("Error:");
    expect(parsed[2].description).toBe("Himalayas good");
  });

  it("processes URLs in batches of 3 (concurrency limit)", async () => {
    const urls = [
      ...Array.from({ length: 3 }, (_, i) => `https://www.linkedin.com/jobs/view/${i}`),
      ...Array.from({ length: 2 }, (_, i) => `https://himalayas.app/companies/co/jobs/eng-${i}`),
    ];
    mockedFetchLinkedIn.mockResolvedValue("LI desc");
    mockedFetchHimalayas.mockResolvedValue("HI desc");

    const result = await tool.handler({ urls });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).toHaveLength(5);
    expect(mockedFetchLinkedIn).toHaveBeenCalledTimes(3);
    expect(mockedFetchHimalayas).toHaveBeenCalledTimes(2);
  });

  it("preserves URL-to-description mapping order", async () => {
    mockedFetchLinkedIn.mockResolvedValueOnce("First");
    mockedFetchHimalayas.mockResolvedValueOnce("Second");

    const result = await tool.handler({
      urls: [
        "https://www.linkedin.com/jobs/view/AAA",
        "https://himalayas.app/companies/co/jobs/BBB",
      ],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed[0].url).toContain("AAA");
    expect(parsed[0].description).toBe("First");
    expect(parsed[1].url).toContain("BBB");
    expect(parsed[1].description).toBe("Second");
  });

  it("includes source field in each result", async () => {
    mockedFetchLinkedIn.mockResolvedValue("desc");

    const result = await tool.handler({
      urls: ["https://www.linkedin.com/jobs/view/1"],
    });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed[0]).toHaveProperty("source");
    expect(parsed[0]).toHaveProperty("url");
    expect(parsed[0]).toHaveProperty("description");
  });
});
