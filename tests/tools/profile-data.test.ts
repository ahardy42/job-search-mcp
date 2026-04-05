import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Mock profile-loader
vi.mock("../../src/services/profile-loader.js", () => ({
  getProfile: vi.fn(),
}));

import { getProfile } from "../../src/services/profile-loader.js";
import { registerProfileDataTool } from "../../src/tools/profile-data.js";

const mockedGetProfile = vi.mocked(getProfile);

function captureToolHandler(server: McpServer) {
  const registerSpy = vi.spyOn(server, "registerTool");
  registerProfileDataTool(server);
  const call = registerSpy.mock.calls[0];
  return {
    name: call[0] as string,
    config: call[1] as any,
    handler: call[2] as (params: any) => Promise<any>,
  };
}

describe("profile-data tool", () => {
  let server: McpServer;
  let tool: ReturnType<typeof captureToolHandler>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = new McpServer({ name: "test", version: "0.0.1" });
    tool = captureToolHandler(server);
  });

  it("registers with the correct tool name", () => {
    expect(tool.name).toBe("profile_data");
  });

  it("is annotated as read-only and idempotent", () => {
    expect(tool.config.annotations.readOnlyHint).toBe(true);
    expect(tool.config.annotations.destructiveHint).toBe(false);
    expect(tool.config.annotations.idempotentHint).toBe(true);
    expect(tool.config.annotations.openWorldHint).toBe(false);
  });

  it("has empty input schema (no parameters)", () => {
    expect(tool.config.inputSchema).toEqual({});
  });

  it("returns profile sections and raw text", async () => {
    mockedGetProfile.mockResolvedValue({
      sections: [
        { id: "exp", label: "Experience", content: "5 years at Acme" },
        { id: "skills", label: "Skills", content: "TypeScript, React" },
      ],
      rawText: "5 years at Acme\n\nTypeScript, React",
      loadedAt: new Date("2025-04-01T12:00:00Z"),
    });

    const result = await tool.handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.sections).toHaveLength(2);
    expect(parsed.sections[0].id).toBe("exp");
    expect(parsed.sections[0].content).toBe("5 years at Acme");
    expect(parsed.raw_text).toContain("5 years at Acme");
    expect(parsed.loaded_at).toBe("2025-04-01T12:00:00.000Z");
  });

  it("returns error message when profile loading fails", async () => {
    mockedGetProfile.mockRejectedValue(new Error("manifest.json not found"));

    const result = await tool.handler({});

    expect(result.content[0].text).toContain("Error loading profile data");
    expect(result.content[0].text).toContain("manifest.json not found");
  });

  it("does not expose keywords or allKeywords (removed fields)", async () => {
    mockedGetProfile.mockResolvedValue({
      sections: [{ id: "exp", label: "Experience", content: "content" }],
      rawText: "content",
      loadedAt: new Date(),
    });

    const result = await tool.handler({});
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed).not.toHaveProperty("allKeywords");
    for (const section of parsed.sections) {
      expect(section).not.toHaveProperty("keywords");
    }
  });
});
