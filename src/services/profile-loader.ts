import fs from "fs/promises";
import path from "path";
import { createRequire } from "module";
import { PDFParse } from "pdf-parse";
import { PROFILE_DIR } from "../constants.js";

const require = createRequire(import.meta.url);
const mammoth = require("mammoth") as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> };

// --- Types ---

export interface ManifestEntry {
  id: string;
  label: string;
  source: string;
  format: "md" | "pdf" | "docx" | "txt";
  order: number;
}

interface Manifest {
  sections: ManifestEntry[];
}

export interface ProfileSection {
  id: string;
  label: string;
  content: string;
}

export interface UserProfile {
  sections: ProfileSection[];
  rawText: string;
  loadedAt: Date;
}

// --- File parsers ---

async function parseMd(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf-8");
}

async function parsePdf(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return result.text;
}

async function parseDocx(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function parseFile(filePath: string, format: string): Promise<string> {
  switch (format) {
    case "md":
    case "txt":
      return parseMd(filePath);
    case "pdf":
      return parsePdf(filePath);
    case "docx":
      return parseDocx(filePath);
    default:
      throw new Error(`Unsupported file format: ${format}`);
  }
}

// --- Profile cache ---

let cachedProfile: UserProfile | null = null;

export async function getProfile(): Promise<UserProfile> {
  if (cachedProfile) {
    return cachedProfile;
  }
  return refreshProfile();
}

export async function refreshProfile(): Promise<UserProfile> {
  const manifestPath = path.join(PROFILE_DIR, "manifest.json");
  const raw = await fs.readFile(manifestPath, "utf-8");
  const manifest: Manifest = JSON.parse(raw);

  const sorted = [...manifest.sections].sort((a, b) => a.order - b.order);

  const sections: ProfileSection[] = [];

  for (const entry of sorted) {
    const filePath = path.resolve(PROFILE_DIR, entry.source);
    if (!filePath.startsWith(path.resolve(PROFILE_DIR))) {
      throw new Error(`Profile source "${entry.source}" resolves outside the profile directory`);
    }
    const content = await parseFile(filePath, entry.format);

    sections.push({
      id: entry.id,
      label: entry.label,
      content,
    });
  }

  const rawText = sections.map((s) => s.content).join("\n\n");

  cachedProfile = {
    sections,
    rawText,
    loadedAt: new Date(),
  };

  console.error(`[profile-loader] Loaded ${sections.length} sections`);
  return cachedProfile;
}
