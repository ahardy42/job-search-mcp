import * as cheerio from "cheerio";
import axios from "axios";
import randomUseragent from "random-useragent";
import {
  LINKEDIN_HOST,
  BATCH_SIZE,
  CACHE_TTL_MS,
  REQUEST_TIMEOUT_MS,
  MAX_CONSECUTIVE_ERRORS,
  BASE_DELAY_MS,
} from "../constants.js";

// --- Types ---

export interface JobSearchParams {
  keywords: string;
  location?: string;
  dateSincePosted?: string;
  jobType?: string;
  remoteFilter?: string;
  salary?: string;
  experienceLevel?: string;
  sortBy?: string;
  page?: number;
}

export interface JobListing {
  position: string;
  company: string;
  location: string;
  date: string;
  salary: string;
  jobUrl: string;
  agoTime: string;
}

// --- Cache ---

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class JobCache {
  private cache = new Map<string, CacheEntry<JobListing[]>>();

  set(key: string, value: JobListing[]): void {
    this.cache.set(key, { data: value, timestamp: Date.now() });
  }

  get(key: string): JobListing[] | null {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() - item.timestamp > CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return item.data;
  }

  clear(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > CACHE_TTL_MS) {
        this.cache.delete(key);
      }
    }
  }
}

const cache = new JobCache();

// --- Filter mappings ---

const DATE_RANGE: Record<string, string> = {
  "past month": "r2592000",
  "past week": "r604800",
  "24hr": "r86400",
};

const EXPERIENCE_LEVEL: Record<string, string> = {
  internship: "1",
  "entry level": "2",
  associate: "3",
  senior: "4",
  director: "5",
  executive: "6",
};

const JOB_TYPE: Record<string, string> = {
  "full time": "F",
  "full-time": "F",
  "part time": "P",
  "part-time": "P",
  contract: "C",
  temporary: "T",
  volunteer: "V",
  internship: "I",
};

const REMOTE_FILTER: Record<string, string> = {
  "on-site": "1",
  "on site": "1",
  remote: "2",
  hybrid: "3",
};

const SALARY_RANGE: Record<string, string> = {
  "40000": "1",
  "60000": "2",
  "80000": "3",
  "100000": "4",
  "120000": "5",
};

// --- URL Builder ---

function buildSearchUrl(params: JobSearchParams, start: number): string {
  const url = new URL(
    `https://${LINKEDIN_HOST}/jobs-guest/jobs/api/seeMoreJobPostings/search`
  );
  const sp = url.searchParams;

  if (params.keywords) sp.set("keywords", params.keywords);
  if (params.location) sp.set("location", params.location);

  const dateFilter = params.dateSincePosted
    ? DATE_RANGE[params.dateSincePosted.toLowerCase()]
    : undefined;
  if (dateFilter) sp.set("f_TPR", dateFilter);

  const salaryFilter = params.salary
    ? SALARY_RANGE[params.salary]
    : undefined;
  if (salaryFilter) sp.set("f_SB2", salaryFilter);

  const expFilter = params.experienceLevel
    ? EXPERIENCE_LEVEL[params.experienceLevel.toLowerCase()]
    : undefined;
  if (expFilter) sp.set("f_E", expFilter);

  const remoteVal = params.remoteFilter
    ? REMOTE_FILTER[params.remoteFilter.toLowerCase()]
    : undefined;
  if (remoteVal) sp.set("f_WT", remoteVal);

  const jobTypeVal = params.jobType
    ? JOB_TYPE[params.jobType.toLowerCase()]
    : undefined;
  if (jobTypeVal) sp.set("f_JT", jobTypeVal);

  const pageOffset = (params.page ?? 0) * BATCH_SIZE;
  sp.set("start", String(start + pageOffset));

  if (params.sortBy === "recent") sp.set("sortBy", "DD");
  else if (params.sortBy === "relevant") sp.set("sortBy", "R");

  return url.toString();
}

// --- HTML Parser ---

function parseJobList(html: string): JobListing[] {
  const $ = cheerio.load(html);
  const jobs: JobListing[] = [];

  $("li").each((_index, element) => {
    const el = $(element);
    const position = el.find(".base-search-card__title").text().trim();
    const company = el.find(".base-search-card__subtitle").text().trim();

    if (!position || !company) return;

    jobs.push({
      position,
      company,
      location: el.find(".job-search-card__location").text().trim(),
      date: el.find("time").attr("datetime") ?? "",
      salary: el.find(".job-search-card__salary-info").text().trim().replace(/\s+/g, " ") || "Not specified",
      jobUrl: el.find(".base-card__full-link").attr("href") ?? "",
      agoTime: el.find(".job-search-card__listdate").text().trim()
    });
  });

  return jobs;
}

// --- Fetch single batch ---

async function fetchJobBatch(params: JobSearchParams, start: number): Promise<JobListing[]> {
  const ua = randomUseragent.getRandom();
  const response = await axios.get(buildSearchUrl(params, start), {
    headers: {
      "User-Agent": ua,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Referer: "https://www.linkedin.com/jobs",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
    },
    timeout: REQUEST_TIMEOUT_MS,
    validateStatus: (status) => status === 200,
  });

  return parseJobList(response.data as string);
}

// --- Main search function ---

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const parts = keys.map((k) => `${k}=${params[k] ?? ""}`);
  return parts.join("&");
}

export async function fetchJobDescription(url: string): Promise<string> {
  const parsed = new URL(url);
  if (parsed.hostname !== "www.linkedin.com" && parsed.hostname !== "linkedin.com") {
    throw new Error("job_url must be a LinkedIn URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("job_url must use HTTPS");
  }

  const ua = randomUseragent.getRandom();
  const response = await axios.get(url, {
    headers: {
      "User-Agent": ua,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      Referer: "https://www.linkedin.com/jobs",
      Connection: "keep-alive",
    },
    timeout: REQUEST_TIMEOUT_MS,
  });

  const $ = cheerio.load(response.data as string);
  const description =
    $(".description__text").text().trim() ||
    $(".show-more-less-html__markup").text().trim() ||
    $(".core-section-container__content").text().trim();

  if (!description) {
    throw new Error("Could not extract job description from the provided URL");
  }

  return description;
}

export async function searchJobs(params: JobSearchParams): Promise<JobListing[]> {
  const cacheKey = buildCacheKey(params);

  const cached = cache.get(cacheKey);
  if (cached) {
    console.error(`[linkedin] Cache hit for key: ${cacheKey}`);
    return cached;
  }
  console.error(`[linkedin] Cache miss for key: ${cacheKey}`);

  const allJobs: JobListing[] = [];
  let start = 0;
  let consecutiveErrors = 0;

  while (true) {
    try {
      const batch = await fetchJobBatch(params, start);
      if (batch.length === 0) break;

      allJobs.push(...batch);
      console.error(`[linkedin] Fetched ${batch.length} jobs. Total: ${allJobs.length}`);

      consecutiveErrors = 0;
      start += BATCH_SIZE;
      await delay(BASE_DELAY_MS + Math.random() * 1000);
    } catch (error) {
      consecutiveErrors++;
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[linkedin] Batch error (attempt ${consecutiveErrors}): ${msg}`);

      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error("[linkedin] Max consecutive errors reached, stopping.");
        break;
      }

      await delay(Math.pow(2, consecutiveErrors) * 1000);
    }
  }

  if (allJobs.length > 0) {
    cache.set(cacheKey, allJobs);
  }

  return allJobs;
}
