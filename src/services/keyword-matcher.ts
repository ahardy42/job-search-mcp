import { extractKeywords, type UserProfile, type ProfileSection } from "./profile-loader.js";

export interface KeywordMatchResult {
  matched: string[];
  missing: string[];
}

export interface SectionRelevance {
  section: ProfileSection;
  matchCount: number;
  matchedKeywords: string[];
}

export function matchKeywords(
  jobKeywords: string[],
  profileKeywords: string[]
): KeywordMatchResult {
  const profileSet = new Set(profileKeywords);
  const matched: string[] = [];
  const missing: string[] = [];

  for (const kw of jobKeywords) {
    if (profileSet.has(kw)) {
      matched.push(kw);
    } else {
      missing.push(kw);
    }
  }

  return { matched, missing };
}

export function findRelevantSections(
  jobText: string,
  profile: UserProfile
): SectionRelevance[] {
  const jobKeywords = extractKeywords(jobText);
  const jobKeywordSet = new Set(jobKeywords);

  const ranked: SectionRelevance[] = profile.sections.map((section) => {
    const matchedKeywords = section.keywords.filter((kw) => jobKeywordSet.has(kw));
    return {
      section,
      matchCount: matchedKeywords.length,
      matchedKeywords,
    };
  });

  return ranked
    .filter((r) => r.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount);
}
