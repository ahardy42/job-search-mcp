import {
  HIMALAYAS_HOST,
  HIMALAYAS_API_BASE,
  REQUEST_TIMEOUT_MS,
  HIMALAYAS_MAX_COUNT,
  HIMALAYAS_PAGE_SIZE,
} from "../constants.js";
import type { JobListing, JobSearchParams } from "./linkedin.js";
import { getCachedJobs, setCachedJobs } from "./job-cache.js";

// --- Types ---

interface HimalayasJob {
  title: string;
  excerpt: string;
  companyName: string;
  companySlug: string;
  companyLogo: string;
  employmentType: string;
  minSalary: number | null;
  maxSalary: number | null;
  currency: string;
  seniority: string;
  locationRestrictions: string[];
  timezoneRestrictions: string[];
  categories: string[];
  parentCategories: string[];
  description: string;
  pubDate: string;
  expiryDate: string;
  applicationLink: string;
  guid: string;
}

interface HimalayasSearchResponse {
  totalCount: number;
  jobs: HimalayasJob[];
}

// --- Filter mappings ---

const SENIORITY_MAP: Record<string, string> = {
  "entry level": "Entry-level",
  associate: "Mid-level",
  senior: "Senior",
  director: "Director",
  executive: "Executive",
  internship: "Entry-level",
};

const EMPLOYMENT_TYPE_MAP: Record<string, string> = {
  "full time": "Full Time",
  "full-time": "Full Time",
  "part time": "Part Time",
  "part-time": "Part Time",
  contract: "Contractor",
  temporary: "Temporary",
  internship: "Intern",
};

const SORT_MAP: Record<string, string> = {
  recent: "recent",
  relevant: "relevant",
};

// --- Helpers ---

function formatSalary(job: HimalayasJob): string {
  if (job.minSalary == null && job.maxSalary == null) return "Not specified";
  const currency = job.currency || "USD";
  const min = job.minSalary != null ? `${currency} ${job.minSalary.toLocaleString()}` : "";
  const max = job.maxSalary != null ? `${currency} ${job.maxSalary.toLocaleString()}` : "";
  if (min && max) return `${min} - ${max}`;
  return min || max;
}

function timeSince(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

function buildJobUrl(job: HimalayasJob): string {
  // The guid often maps to the job listing page on Himalayas
  if (job.guid) return job.guid;
  // Fallback to application link
  return job.applicationLink || "";
}

function toJobListing(job: HimalayasJob): JobListing {
  const locationParts = job.locationRestrictions?.length
    ? job.locationRestrictions.join(", ")
    : "Worldwide";

  return {
    position: job.title,
    company: job.companyName,
    location: locationParts,
    date: job.pubDate ? new Date(job.pubDate).toISOString().split("T")[0] : "",
    salary: formatSalary(job),
    jobUrl: buildJobUrl(job),
    agoTime: job.pubDate ? timeSince(job.pubDate) : "",
    source: "himalayas",
    // Himalayas-specific fields
    companySlug: job.companySlug,
    employmentType: job.employmentType,
    minSalary: job.minSalary,
    maxSalary: job.maxSalary,
    currency: job.currency,
    seniority: job.seniority,
    categories: job.categories,
    locationRestrictions: job.locationRestrictions,
    timezoneRestrictions: job.timezoneRestrictions,
    applicationLink: job.applicationLink,
    guid: job.guid,
    excerpt: job.excerpt,
    expiryDate: job.expiryDate,
    description: job.description,
  };
}

// --- Search ---

function buildCacheKey(params: JobSearchParams): string {
  const keys: (keyof JobSearchParams)[] = [
    "dateSincePosted",
    "experienceLevel",
    "jobType",
    "keywords",
    "location",
    "page",
    "remoteFilter",
    "salary",
    "sortBy",
  ];
  return "himalayas:" + keys.map((k) => `${k}=${params[k] ?? ""}`).join("&");
}

export async function searchJobs(params: JobSearchParams): Promise<JobListing[]> {
  const cacheKey = buildCacheKey(params);
  const cached = getCachedJobs(cacheKey);
  if (cached) {
    console.error(`[himalayas] Cache hit for key: ${cacheKey}`);
    return cached;
  }
  console.error(`[himalayas] Cache miss, searching...`);

  const url = new URL(`${HIMALAYAS_API_BASE}/search`);
  const sp = url.searchParams;

  if (params.keywords) sp.set("q", params.keywords);
  if (params.sortBy) sp.set("sort", SORT_MAP[params.sortBy] || "recent");

  if (params.experienceLevel) {
    const mapped = SENIORITY_MAP[params.experienceLevel.toLowerCase()];
    if (mapped) sp.set("seniority", mapped);
  }

  if (params.jobType) {
    const mapped = EMPLOYMENT_TYPE_MAP[params.jobType.toLowerCase()];
    if (mapped) sp.set("employment_type", mapped);
  }

  // Map location to country param if not a generic value
  if (params.location && params.location.toLowerCase() !== "remote") {
    sp.set("country", params.location);
  }

  // If remote filter is "remote", request worldwide positions
  if (params.remoteFilter === "remote") {
    sp.set("worldwide", "true");
  }

  const page = params.page ?? 0;
  sp.set("page", String(page + 1)); // Himalayas uses 1-based pages

  const allJobs: JobListing[] = [];
  let currentPage = page + 1;
  let totalCount = HIMALAYAS_MAX_COUNT; // Start with max count to enter loop

  while (allJobs.length < totalCount) {
    sp.set("page", String(currentPage));

    try {
      const response = await fetch(url.toString(), {
        headers: {
          Accept: "application/json",
          "User-Agent": "job-search-mcp/1.0",
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 429) {
        console.error("[himalayas] Rate limited, stopping pagination.");
        break;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as HimalayasSearchResponse;
      totalCount = data.totalCount;

      if (!data.jobs || data.jobs.length === 0) break;

      allJobs.push(...data.jobs.map(toJobListing));
      console.error(`[himalayas] Page ${currentPage}: ${data.jobs.length} jobs. Total: ${allJobs.length}/${totalCount}`);

      // Stop after max count to avoid excessive pagination
      if (currentPage >= page + Math.round(HIMALAYAS_MAX_COUNT / HIMALAYAS_PAGE_SIZE)) break;

      currentPage++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[himalayas] Fetch error on page ${currentPage}: ${msg}`);
      break;
    }
  }

  if (allJobs.length > 0) {
    setCachedJobs(cacheKey, allJobs);
  }

  return allJobs;
}

// --- Job description fetching ---

export async function fetchJobDescription(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.hostname !== HIMALAYAS_HOST && parsed.hostname !== `www.${HIMALAYAS_HOST}`) {
    throw new Error("URL must be a Himalayas URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("URL must use HTTPS");
  }

  const { getBrowser } = await import("./web-scraper.js");
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });
  const page = await ctx.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

    const finalUrl = new URL(page.url());
    if (finalUrl.hostname !== HIMALAYAS_HOST && finalUrl.hostname !== `www.${HIMALAYAS_HOST}`) {
      throw new Error("Redirect led to a non-Himalayas URL");
    }

    // Try JSON-LD structured data first (most reliable)
    const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent().catch(() => null);
    if (jsonLd) {
      try {
        const structured = JSON.parse(jsonLd);
        if (structured.description) {
          return structured.description;
        }
      } catch {
        // Fall through to DOM scraping
      }
    }

    // Fall back to main content area
    const description = await page
      .locator("main article, main [class*='description'], main .content")
      .first()
      .textContent()
      .catch(() => null);

    const text = description?.trim();
    if (!text) {
      throw new Error("Could not extract job description from the provided URL");
    }

    return text;
  } finally {
    await ctx.close();
  }
}

// --- Company profile fetching ---

export async function fetchCompanyProfile(companySlug: string): Promise<Record<string, unknown> | null> {
  const url = `https://${HIMALAYAS_HOST}/companies/${companySlug}`;

  const { getBrowser } = await import("./web-scraper.js");
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });
  const page = await ctx.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

    const finalUrl = new URL(page.url());
    if (finalUrl.hostname !== HIMALAYAS_HOST && finalUrl.hostname !== `www.${HIMALAYAS_HOST}`) {
      return null;
    }

    const profile: Record<string, unknown> = { url };

    // Extract JSON-LD structured data — take whatever fields exist
    const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent().catch(() => null);
    if (jsonLd) {
      try {
        const data = JSON.parse(jsonLd);
        Object.assign(profile, data);
      } catch {
        // Ignore parse errors
      }
    }

    // Scrape main content text as supplementary context
    const mainText = await page
      .locator("main")
      .first()
      .textContent()
      .catch(() => "");

    const cleanText = (mainText || "").replace(/\s+/g, " ").trim();
    if (cleanText) {
      profile.pageText = cleanText;
    }

    return profile;
  } catch (error) {
    console.error(`[himalayas] Failed to fetch company profile for ${companySlug}: ${error}`);
    return null;
  } finally {
    await ctx.close();
  }
}
