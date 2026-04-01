import type { Browser, Page } from "playwright";
import { RESEARCH_CACHE_TTL_MS, MAX_SEARCH_RESULTS } from "../constants.js";

// --- Types ---

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface PageContent {
  title: string;
  text: string;
  url: string;
}

export interface CompanyResearchData {
  company_name: string;
  official_description: string;
  products_services: string[];
  recent_news: { headline: string; source: string; url: string }[];
  glassdoor_signals: string[];
  raw_about_page: string | null;
  sources: string[];
}

// --- Browser lifecycle (lazy singleton) ---

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless: false,
      args: ["--headless=new"],
    });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

// --- Research cache ---

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const researchCache = new Map<string, CacheEntry<CompanyResearchData>>();

function getCachedResearch(key: string): CompanyResearchData | null {
  const entry = researchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > RESEARCH_CACHE_TTL_MS) {
    researchCache.delete(key);
    return null;
  }
  return entry.data;
}

// --- DuckDuckGo search ---

export async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const b = await getBrowser();
  const ctx = await b.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });
  const page = await ctx.newPage();

  try {
    // Use the HTML version of DuckDuckGo to avoid CAPTCHA/bot detection
    await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    // Use .result:not(.result--ad) to skip sponsored results
    const resultLocators = page.locator(".result:not(.result--ad)");
    const count = Math.min(await resultLocators.count(), MAX_SEARCH_RESULTS);
    const results: SearchResult[] = [];

    for (let i = 0; i < count; i++) {
      const el = resultLocators.nth(i);
      const titleEl = el.locator(".result__title").first();
      const snippetEl = el.locator(".result__snippet").first();
      const urlEl = el.locator(".result__url").first();

      const rawTitle = await titleEl.textContent().catch(() => null);
      const snippet = await snippetEl.textContent().catch(() => null);
      const displayUrl = await urlEl.textContent().catch(() => null);
      const href = await titleEl.locator("a").first().getAttribute("href").catch(() => null);

      // Skip ad results that slip through
      const title = rawTitle?.replace(/\s*Ad\s*$/, "").trim();
      if (!title || title.includes("Ad clicks are managed")) continue;

      // Extract actual URL from DuckDuckGo redirect
      let resolvedUrl = "";
      if (href) {
        try {
          const parsed = new URL(href, "https://duckduckgo.com");
          resolvedUrl = parsed.searchParams.get("uddg") || href;
        } catch {
          resolvedUrl = href;
        }
      }
      if (!resolvedUrl && displayUrl) {
        resolvedUrl = `https://${displayUrl.trim()}`;
      }

      results.push({
        title,
        url: resolvedUrl,
        snippet: snippet?.trim() || "",
      });
    }

    return results;
  } finally {
    await ctx.close();
  }
}

// --- Page content scraping ---

function validateExternalUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("URL must use HTTP or HTTPS");
  }
  const hostname = parsed.hostname;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("172.") ||
    hostname.startsWith("192.168.") ||
    hostname === "169.254.169.254" ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("URL must not target internal/private network addresses");
  }
}

export async function scrapePageContent(url: string): Promise<PageContent> {
  validateExternalUrl(url);
  const b = await getBrowser();
  const ctx = await b.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });
  const page = await ctx.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });

    // Remove noise elements
    for (const selector of ["script", "style", "nav", "footer", "header", "aside", "[role='navigation']"]) {
      const els = page.locator(selector);
      const elCount = await els.count();
      for (let i = elCount - 1; i >= 0; i--) {
        await els.nth(i).evaluate((el) => el.remove()).catch(() => {});
      }
    }

    const title = await page.title();

    const mainLocator = page.locator("main, article, [role='main'], .content, #content").first();
    const hasMain = await mainLocator.count() > 0;
    const contentLocator = hasMain ? mainLocator : page.locator("body");

    const text = await contentLocator.textContent().catch(() => "") || "";
    const content = {
      title,
      text: text.replace(/\s+/g, " ").trim().slice(0, 5000),
    };

    return { ...content, url };
  } finally {
    await ctx.close();
  }
}

// --- Company research orchestrator ---

export async function researchCompany(
  companyName: string,
  companyUrl?: string
): Promise<CompanyResearchData> {
  const cacheKey = `${companyName.toLowerCase()}|${companyUrl || ""}`;
  const cached = getCachedResearch(cacheKey);
  if (cached) {
    console.error(`[web-scraper] Cache hit for company: ${companyName}`);
    return cached;
  }

  console.error(`[web-scraper] Researching company: ${companyName}`);

  // Run searches in parallel
  const [generalResults, newsResults, glassdoorResults] = await Promise.all([
    searchDuckDuckGo(`${companyName} company what do they do`).catch((e) => {
      console.error(`[web-scraper] General search failed: ${e}`);
      return [] as SearchResult[];
    }),
    searchDuckDuckGo(`${companyName} company news recent`).catch((e) => {
      console.error(`[web-scraper] News search failed: ${e}`);
      return [] as SearchResult[];
    }),
    searchDuckDuckGo(`${companyName} glassdoor reviews`).catch((e) => {
      console.error(`[web-scraper] Glassdoor search failed: ${e}`);
      return [] as SearchResult[];
    }),
  ]);

  // Scrape company about page if URL provided
  let aboutPage: PageContent | null = null;
  if (companyUrl) {
    try {
      aboutPage = await scrapePageContent(companyUrl);
    } catch (e) {
      console.error(`[web-scraper] Failed to scrape company URL: ${e}`);
    }
  }

  // Extract official description from general results
  const officialDescription = generalResults
    .slice(0, 3)
    .map((r) => r.snippet)
    .filter(Boolean)
    .join(" ")
    || "No description found";

  // Extract products/services mentions
  const productsServices = generalResults
    .map((r) => r.snippet)
    .filter((s) => s.length > 20);

  // Extract news items
  const recentNews = newsResults.slice(0, 5).map((r) => {
    let source = "";
    try {
      source = new URL(r.url).hostname.replace("www.", "");
    } catch {
      source = r.url.slice(0, 50);
    }
    return { headline: r.title, source, url: r.url };
  });

  // Extract glassdoor signals
  const glassdoorSignals = glassdoorResults
    .slice(0, 3)
    .map((r) => r.snippet)
    .filter(Boolean);

  const sources = [
    ...generalResults.map((r) => r.url),
    ...newsResults.map((r) => r.url),
    ...glassdoorResults.map((r) => r.url),
  ].filter(Boolean);

  const result: CompanyResearchData = {
    company_name: companyName,
    official_description: officialDescription,
    products_services: productsServices,
    recent_news: recentNews,
    glassdoor_signals: glassdoorSignals,
    raw_about_page: aboutPage?.text || null,
    sources: [...new Set(sources)],
  };

  researchCache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}
