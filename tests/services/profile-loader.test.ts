import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PROFILE_DIR = path.resolve(__dirname, "..", "fixtures", "profile");

// Mock the constants module to point PROFILE_DIR at our fixture
vi.mock("../../src/constants.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/constants.js")>();
  return {
    ...original,
    PROFILE_DIR: FIXTURE_PROFILE_DIR,
  };
});

// Must import after mock setup
const { getProfile, refreshProfile } = await import("../../src/services/profile-loader.js");

describe("profile-loader", () => {
  describe("refreshProfile", () => {
    it("loads sections from the manifest in order", async () => {
      const profile = await refreshProfile();

      expect(profile.sections).toHaveLength(2);
      expect(profile.sections[0].id).toBe("experience");
      expect(profile.sections[0].label).toBe("Work Experience");
      expect(profile.sections[1].id).toBe("skills");
      expect(profile.sections[1].label).toBe("Technical Skills");
    });

    it("parses markdown file content correctly", async () => {
      const profile = await refreshProfile();

      expect(profile.sections[0].content).toContain("Senior Software Engineer");
      expect(profile.sections[0].content).toContain("Acme Corp");
    });

    it("parses txt file content correctly", async () => {
      const profile = await refreshProfile();

      expect(profile.sections[1].content).toContain("TypeScript");
      expect(profile.sections[1].content).toContain("Node.js");
    });

    it("concatenates all sections into rawText", async () => {
      const profile = await refreshProfile();

      expect(profile.rawText).toContain("Senior Software Engineer");
      expect(profile.rawText).toContain("TypeScript");
      expect(profile.rawText).toContain("\n\n");
    });

    it("sets loadedAt as a Date", async () => {
      const before = new Date();
      const profile = await refreshProfile();
      const after = new Date();

      expect(profile.loadedAt).toBeInstanceOf(Date);
      expect(profile.loadedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(profile.loadedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("does not include keywords property on sections", async () => {
      const profile = await refreshProfile();

      for (const section of profile.sections) {
        expect(section).not.toHaveProperty("keywords");
      }
    });

    it("does not include allKeywords property on profile", async () => {
      const profile = await refreshProfile();

      expect(profile).not.toHaveProperty("allKeywords");
    });
  });

  describe("getProfile (caching)", () => {
    it("returns the same profile object on repeated calls", async () => {
      const first = await getProfile();
      const second = await getProfile();

      expect(first).toBe(second);
      expect(first.loadedAt).toEqual(second.loadedAt);
    });

    it("returns a new profile after refreshProfile", async () => {
      const first = await getProfile();
      const refreshed = await refreshProfile();

      expect(refreshed.sections).toHaveLength(first.sections.length);
    });
  });

  describe("path traversal prevention", () => {
    it("rejects manifest entries with ../ path traversal", async () => {
      // Directly test the path validation logic that refreshProfile uses
      const maliciousSource = "../../package.json";
      const resolved = path.resolve(FIXTURE_PROFILE_DIR, maliciousSource);
      const profileDirResolved = path.resolve(FIXTURE_PROFILE_DIR);

      // The check in profile-loader.ts: !filePath.startsWith(path.resolve(PROFILE_DIR))
      expect(resolved.startsWith(profileDirResolved)).toBe(false);
    });

    it("rejects absolute path /etc/passwd", async () => {
      const maliciousSource = "/etc/passwd";
      const resolved = path.resolve(FIXTURE_PROFILE_DIR, maliciousSource);
      const profileDirResolved = path.resolve(FIXTURE_PROFILE_DIR);

      expect(resolved.startsWith(profileDirResolved)).toBe(false);
    });

    it("allows files within the profile directory", async () => {
      const safeSource = "experience.md";
      const resolved = path.resolve(FIXTURE_PROFILE_DIR, safeSource);
      const profileDirResolved = path.resolve(FIXTURE_PROFILE_DIR);

      expect(resolved.startsWith(profileDirResolved)).toBe(true);
    });

    it("rejects sources using ../ to escape even with valid prefix", async () => {
      const maliciousSource = "subdir/../../etc/passwd";
      const resolved = path.resolve(FIXTURE_PROFILE_DIR, maliciousSource);
      const profileDirResolved = path.resolve(FIXTURE_PROFILE_DIR);

      expect(resolved.startsWith(profileDirResolved)).toBe(false);
    });

    it("actually throws when refreshProfile encounters a traversal in manifest", async () => {
      const tmpDir = path.resolve(__dirname, "..", "fixtures", "profile-traversal");

      await fs.mkdir(tmpDir, { recursive: true });
      try {
        await fs.writeFile(
          path.join(tmpDir, "manifest.json"),
          JSON.stringify({
            sections: [
              {
                id: "malicious",
                label: "Malicious",
                source: "../../package.json",
                format: "md",
                order: 1,
              },
            ],
          })
        );

        // Use resetModules + doMock to get a fresh profile-loader with the new PROFILE_DIR
        vi.resetModules();
        vi.doMock("../../src/constants.js", () => ({
          PROFILE_DIR: tmpDir,
        }));

        const mod = await import("../../src/services/profile-loader.js");
        await expect(mod.refreshProfile()).rejects.toThrow(
          /resolves outside the profile directory/
        );
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });

    it("actually throws for absolute path /etc/passwd in manifest", async () => {
      const tmpDir = path.resolve(__dirname, "..", "fixtures", "profile-absolute");

      await fs.mkdir(tmpDir, { recursive: true });
      try {
        await fs.writeFile(
          path.join(tmpDir, "manifest.json"),
          JSON.stringify({
            sections: [
              {
                id: "malicious",
                label: "Malicious",
                source: "/etc/passwd",
                format: "txt",
                order: 1,
              },
            ],
          })
        );

        vi.resetModules();
        vi.doMock("../../src/constants.js", () => ({
          PROFILE_DIR: tmpDir,
        }));

        const mod = await import("../../src/services/profile-loader.js");
        await expect(mod.refreshProfile()).rejects.toThrow(
          /resolves outside the profile directory/
        );
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("unsupported format", () => {
    it("throws for unsupported file formats", async () => {
      const tmpDir = path.resolve(__dirname, "..", "fixtures", "profile-bad-format");

      await fs.mkdir(tmpDir, { recursive: true });
      try {
        await fs.writeFile(path.join(tmpDir, "data.csv"), "a,b,c\n1,2,3");
        await fs.writeFile(
          path.join(tmpDir, "manifest.json"),
          JSON.stringify({
            sections: [
              {
                id: "csv",
                label: "CSV Data",
                source: "data.csv",
                format: "csv",
                order: 1,
              },
            ],
          })
        );

        vi.resetModules();
        vi.doMock("../../src/constants.js", () => ({
          PROFILE_DIR: tmpDir,
        }));

        const mod = await import("../../src/services/profile-loader.js");
        await expect(mod.refreshProfile()).rejects.toThrow(/Unsupported file format/);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
