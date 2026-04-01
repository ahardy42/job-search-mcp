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
  keywords: string[];
}

export interface UserProfile {
  sections: ProfileSection[];
  allKeywords: string[];
  rawText: string;
  loadedAt: Date;
}

// --- Stop words for keyword extraction ---

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "was", "are", "were", "be", "been",
  "being", "have", "has", "had", "do", "does", "did", "will", "would",
  "could", "should", "may", "might", "shall", "can", "need", "must",
  "that", "this", "these", "those", "it", "its", "i", "me", "my",
  "we", "our", "you", "your", "he", "she", "they", "them", "their",
  "what", "which", "who", "whom", "where", "when", "why", "how",
  "all", "each", "every", "both", "few", "more", "most", "other",
  "some", "such", "no", "not", "only", "own", "same", "so", "than",
  "too", "very", "just", "about", "above", "after", "again", "also",
  "as", "because", "before", "between", "during", "if", "into", "over",
  "then", "through", "under", "until", "up", "while",
]);

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

// --- Keyword extraction ---

export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s\-\+\#]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  return [...new Set(words)];
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
    const keywords = extractKeywords(content);

    sections.push({
      id: entry.id,
      label: entry.label,
      content,
      keywords,
    });
  }

  const rawText = sections.map((s) => s.content).join("\n\n");
  const allKeywords = [...new Set(sections.flatMap((s) => s.keywords))];

  cachedProfile = {
    sections,
    allKeywords,
    rawText,
    loadedAt: new Date(),
  };

  console.error(`[profile-loader] Loaded ${sections.length} sections, ${allKeywords.length} unique keywords`);
  return cachedProfile;
}
