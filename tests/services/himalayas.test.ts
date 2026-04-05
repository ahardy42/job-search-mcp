import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock job-cache
vi.mock("../../src/services/job-cache.js", () => ({
  getCachedJobs: vi.fn(() => null),
  setCachedJobs: vi.fn(),
}));

// Mock the web-scraper's getBrowser to avoid launching Playwright
vi.mock("../../src/services/web-scraper.js", () => ({
  getBrowser: vi.fn(),
}));

// Define a complete mock Response
const mockResponse = {
  ok: true,
  status: 200,
  statusText: "OK",
  headers: new Headers(),
  redirected: false,
  url: "",
  type: "basic" as const,
  text: vi.fn().mockResolvedValue(""),
  json: vi.fn().mockResolvedValue({ totalCount: 0, jobs: [] }),
  blob: vi.fn().mockResolvedValue(new Blob()),
  arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  formData: vi.fn().mockResolvedValue(new FormData()),
  bytes: vi.fn().mockResolvedValue(new Uint8Array()),
  clone: vi.fn(),
  body: null,
  bodyUsed: false,
};
mockResponse.clone.mockReturnValue(mockResponse);

global.fetch = vi.fn().mockResolvedValue(mockResponse);

import { searchJobs, fetchJobDescription, fetchCompanyProfile } from "../../src/services/himalayas.js";
import { getCachedJobs, setCachedJobs } from "../../src/services/job-cache.js";

const mockedGetCachedJobs = vi.mocked(getCachedJobs);
const mockedSetCachedJobs = vi.mocked(setCachedJobs);

function makeHimalayasJob(overrides: Partial<any> = {}) {
  return {
    title: "Senior Engineer",
    excerpt: "Build great things",
    companyName: "TestCo",
    companySlug: "testco",
    companyLogo: "https://himalayas.app/logos/testco.png",
    employmentType: "Full Time",
    minSalary: 120000,
    maxSalary: 180000,
    currency: "USD",
    seniority: "Senior",
    locationRestrictions: ["US", "Canada"],
    timezoneRestrictions: ["UTC-5"],
    categories: ["Engineering"],
    parentCategories: ["Technology"],
    description: "<p>Full job description</p>",
    pubDate: "2025-04-01T00:00:00Z",
    expiryDate: "2025-05-01T00:00:00Z",
    applicationLink: "https://testco.com/apply",
    guid: "https://himalayas.app/companies/testco/jobs/senior-engineer-123",
    ...overrides,
  };
}

describe("himalayas service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetCachedJobs.mockReturnValue(null);
  });

  describe("searchJobs", () => {
    it("parses Himalayas API response into JobListing format", async () => {
      const apiResponse = { totalCount: 1, jobs: [makeHimalayasJob()] };

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ...mockResponse,
          json: vi.fn().mockResolvedValue(apiResponse),
        } as any);

      const jobs = await searchJobs({ keywords: "engineer" });

      expect(jobs).toHaveLength(1);
      expect(jobs[0].position).toBe("Senior Engineer");
      expect(jobs[0].company).toBe("TestCo");
      expect(jobs[0].location).toBe("US, Canada");
      expect(jobs[0].salary).toContain("120,000");
      expect(jobs[0].salary).toContain("180,000");
      expect(jobs[0].source).toBe("himalayas");
      expect(jobs[0].companySlug).toBe("testco");
      expect(jobs[0].guid).toBe("https://himalayas.app/companies/testco/jobs/senior-engineer-123");
      expect(jobs[0].seniority).toBe("Senior");
      expect(jobs[0].categories).toEqual(["Engineering"]);
    });

    it("builds search URL with correct query parameters", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ...mockResponse,
        json: vi.fn().mockResolvedValue({ totalCount: 0, jobs: [] }),
      } as any);

      await searchJobs({
        keywords: "typescript",
        location: "United States",
        jobType: "full time",
        remoteFilter: "remote",
        experienceLevel: "senior",
        sortBy: "recent",
      });

      expect(vi.mocked(fetch)).toHaveBeenCalled();
      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain("q=typescript");
      expect(url).toContain("country=United+States");
      expect(url).toContain("employment_type=Full+Time");
      expect(url).toContain("worldwide=true");
      expect(url).toContain("seniority=Senior");
      expect(url).toContain("sort=recent");
    });

    it("returns empty array when no results found", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ...mockResponse,
        json: vi.fn().mockResolvedValue({ totalCount: 0, jobs: [] }),
      } as any);

      const jobs = await searchJobs({ keywords: "nonexistent" });
      expect(jobs).toEqual([]);
    });

    it("returns cached results when available", async () => {
      const cachedJobs = [
        {
          position: "Cached Job",
          company: "CacheCo",
          location: "Remote",
          date: "2025-04-01",
          salary: "Not specified",
          jobUrl: "https://himalayas.app/jobs/1",
          agoTime: "1 day ago",
          source: "himalayas" as const,
        },
      ];
      mockedGetCachedJobs.mockReturnValue(cachedJobs);

      const jobs = await searchJobs({ keywords: "cached" });
      expect(jobs).toBe(cachedJobs);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("caches results after successful fetch", async () => {
      const apiResponse = { totalCount: 1, jobs: [makeHimalayasJob()] };
      vi.mocked(fetch).mockResolvedValueOnce({
        ...mockResponse,
        json: vi.fn().mockResolvedValue(apiResponse),
      } as any);

      await searchJobs({ keywords: "cache-test" });

      expect(mockedSetCachedJobs).toHaveBeenCalledTimes(1);
      expect(mockedSetCachedJobs.mock.calls[0][0]).toContain("himalayas:");
      expect(mockedSetCachedJobs.mock.calls[0][1]).toHaveLength(1);
    });

    it("does not cache empty results", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ...mockResponse,
        json: vi.fn().mockResolvedValue({ totalCount: 0, jobs: [] }),
      } as any);

      await searchJobs({ keywords: "empty" });
      expect(mockedSetCachedJobs).not.toHaveBeenCalled();
    });

    it("stops pagination on 429 rate limit", async () => {
      const page1Response = { totalCount: 100, jobs: Array(20).fill(makeHimalayasJob()) };

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ...mockResponse,
          json: vi.fn().mockResolvedValue(page1Response),
        } as any)
        .mockResolvedValueOnce({
          ...mockResponse,
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
        } as any);

      const jobs = await searchJobs({ keywords: "rate-limit-test" });

      expect(jobs).toHaveLength(20);
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });

    it("stops pagination on fetch error", async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error("Network failure"));

      const jobs = await searchJobs({ keywords: "error-test" });
      expect(jobs).toEqual([]);
    });

    it("formats salary with currency when available", async () => {
      const job = makeHimalayasJob({ minSalary: 50000, maxSalary: 80000, currency: "EUR" });
      vi.mocked(fetch).mockResolvedValueOnce({
        ...mockResponse,
        json: vi.fn().mockResolvedValue({ totalCount: 1, jobs: [job] }),
      } as any);

      const jobs = await searchJobs({ keywords: "salary-test" });
      expect(jobs[0].salary).toContain("EUR");
      expect(jobs[0].salary).toContain("50,000");
      expect(jobs[0].salary).toContain("80,000");
    });

    it("shows 'Not specified' when salary is null", async () => {
      const job = makeHimalayasJob({ minSalary: null, maxSalary: null });
      vi.mocked(fetch).mockResolvedValueOnce({
        ...mockResponse,
        json: vi.fn().mockResolvedValue({ totalCount: 1, jobs: [job] }),
      } as any);

      const jobs = await searchJobs({ keywords: "no-salary" });
      expect(jobs[0].salary).toBe("Not specified");
    });

    it("shows 'Worldwide' when no location restrictions", async () => {
      const job = makeHimalayasJob({ locationRestrictions: [] });
      vi.mocked(fetch).mockResolvedValueOnce({
        ...mockResponse,
        json: vi.fn().mockResolvedValue({ totalCount: 1, jobs: [job] }),
      } as any);

      const jobs = await searchJobs({ keywords: "worldwide" });
      expect(jobs[0].location).toBe("Worldwide");
    });

    it("maps seniority filter correctly", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ...mockResponse,
        json: vi.fn().mockResolvedValue({ totalCount: 0, jobs: [] }),
      } as any);

      await searchJobs({ keywords: "test", experienceLevel: "entry level" });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain("seniority=Entry-level");
    });

    it("maps employment type filter correctly", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ...mockResponse,
        json: vi.fn().mockResolvedValue({ totalCount: 0, jobs: [] }),
      } as any);

      await searchJobs({ keywords: "test", jobType: "contract" });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain("employment_type=Contractor");
    });

    it("skips country param when location is 'remote'", async () => {
      vi.mocked(fetch).mockResolvedValue({
        ...mockResponse,
        json: vi.fn().mockResolvedValue({ totalCount: 0, jobs: [] }),
      } as any);

      await searchJobs({ keywords: "test", location: "remote" });

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).not.toContain("country=");
    });
  });

  describe("fetchJobDescription", () => {
    it("rejects non-Himalayas URLs", async () => {
      await expect(fetchJobDescription("https://evil.com/jobs/123")).rejects.toThrow(
        "URL must be a Himalayas URL"
      );
    });

    it("rejects non-HTTPS URLs", async () => {
      await expect(fetchJobDescription("http://himalayas.app/jobs/123")).rejects.toThrow(
        "URL must use HTTPS"
      );
    });

    it("accepts himalayas.app URLs and extracts JSON-LD description", async () => {
      const jsonLd = JSON.stringify({ description: "Full job description from JSON-LD" });
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn(() => "https://himalayas.app/companies/testco/jobs/eng-123"),
        locator: vi.fn((selector: string) => {
          if (selector.includes("ld+json")) {
            return {
              first: vi.fn(() => ({
                textContent: vi.fn(() => Promise.resolve(jsonLd)),
              })),
            };
          }
          return {
            first: vi.fn(() => ({
              textContent: vi.fn(() => Promise.resolve(null)),
            })),
          };
        }),
      };
      const mockContext = { newPage: vi.fn(() => mockPage), close: vi.fn() };
      const mockBrowser = { newContext: vi.fn(() => mockContext) };

      const { getBrowser } = await import("../../src/services/web-scraper.js");
      vi.mocked(getBrowser).mockResolvedValue(mockBrowser as any);

      const desc = await fetchJobDescription("https://himalayas.app/companies/testco/jobs/eng-123");
      expect(desc).toBe("Full job description from JSON-LD");
      expect(mockContext.close).toHaveBeenCalled();
    });

    it("falls back to DOM scraping when JSON-LD has no description", async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn(() => "https://himalayas.app/companies/testco/jobs/eng-456"),
        locator: vi.fn((selector: string) => {
          if (selector.includes("ld+json")) {
            return {
              first: vi.fn(() => ({
                textContent: vi.fn(() => Promise.resolve("{}")),
              })),
            };
          }
          return {
            first: vi.fn(() => ({
              textContent: vi.fn(() => Promise.resolve("Fallback description from DOM")),
            })),
          };
        }),
      };
      const mockContext = { newPage: vi.fn(() => mockPage), close: vi.fn() };
      const mockBrowser = { newContext: vi.fn(() => mockContext) };

      const { getBrowser } = await import("../../src/services/web-scraper.js");
      vi.mocked(getBrowser).mockResolvedValue(mockBrowser as any);

      const desc = await fetchJobDescription("https://himalayas.app/companies/testco/jobs/eng-456");
      expect(desc).toBe("Fallback description from DOM");
    });

    it("throws when no description found anywhere", async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn(() => "https://himalayas.app/companies/testco/jobs/eng-789"),
        locator: vi.fn(() => ({
          first: vi.fn(() => ({
            textContent: vi.fn(() => Promise.resolve(null)),
          })),
        })),
      };
      const mockContext = { newPage: vi.fn(() => mockPage), close: vi.fn() };
      const mockBrowser = { newContext: vi.fn(() => mockContext) };

      const { getBrowser } = await import("../../src/services/web-scraper.js");
      vi.mocked(getBrowser).mockResolvedValue(mockBrowser as any);

      await expect(
        fetchJobDescription("https://himalayas.app/companies/testco/jobs/eng-789")
      ).rejects.toThrow("Could not extract job description");
    });

    it("rejects if redirect leads to non-Himalayas URL", async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn(() => "https://evil.com/phishing"),
        locator: vi.fn(),
      };
      const mockContext = { newPage: vi.fn(() => mockPage), close: vi.fn() };
      const mockBrowser = { newContext: vi.fn(() => mockContext) };

      const { getBrowser } = await import("../../src/services/web-scraper.js");
      vi.mocked(getBrowser).mockResolvedValue(mockBrowser as any);

      await expect(
        fetchJobDescription("https://himalayas.app/companies/testco/jobs/eng-999")
      ).rejects.toThrow("Redirect led to a non-Himalayas URL");
      expect(mockContext.close).toHaveBeenCalled();
    });
  });

  describe("fetchCompanyProfile", () => {
    it("returns JSON-LD data and page text from company page", async () => {
      const jsonLd = JSON.stringify({
        name: "TestCo",
        description: "We build things",
        industry: "Technology",
      });
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn(() => "https://himalayas.app/companies/testco"),
        locator: vi.fn((selector: string) => {
          if (selector.includes("ld+json")) {
            return {
              first: vi.fn(() => ({
                textContent: vi.fn(() => Promise.resolve(jsonLd)),
              })),
            };
          }
          if (selector === "main") {
            return {
              first: vi.fn(() => ({
                textContent: vi.fn(() => Promise.resolve("  TestCo  is a  great company  ")),
              })),
            };
          }
          return {
            first: vi.fn(() => ({
              textContent: vi.fn(() => Promise.resolve(null)),
            })),
          };
        }),
      };
      const mockContext = { newPage: vi.fn(() => mockPage), close: vi.fn() };
      const mockBrowser = { newContext: vi.fn(() => mockContext) };

      const { getBrowser } = await import("../../src/services/web-scraper.js");
      vi.mocked(getBrowser).mockResolvedValue(mockBrowser as any);

      const profile = await fetchCompanyProfile("testco");

      expect(profile).not.toBeNull();
      expect(profile!.url).toBe("https://himalayas.app/companies/testco");
      expect(profile!.name).toBe("TestCo");
      expect(profile!.description).toBe("We build things");
      expect(profile!.industry).toBe("Technology");
      expect(profile!.pageText).toBe("TestCo is a great company");
    });

    it("returns null when redirect goes off-site", async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn(() => "https://other-site.com/404"),
        locator: vi.fn(),
      };
      const mockContext = { newPage: vi.fn(() => mockPage), close: vi.fn() };
      const mockBrowser = { newContext: vi.fn(() => mockContext) };

      const { getBrowser } = await import("../../src/services/web-scraper.js");
      vi.mocked(getBrowser).mockResolvedValue(mockBrowser as any);

      const profile = await fetchCompanyProfile("nonexistent");
      expect(profile).toBeNull();
    });

    it("returns null on page navigation error", async () => {
      const mockPage = {
        goto: vi.fn().mockRejectedValue(new Error("Navigation failed")),
        url: vi.fn(() => "https://himalayas.app/companies/crash-test"),
      };
      const mockContext = { newPage: vi.fn(() => mockPage), close: vi.fn() };
      const mockBrowser = { newContext: vi.fn(() => mockContext) };

      const { getBrowser } = await import("../../src/services/web-scraper.js");
      vi.mocked(getBrowser).mockResolvedValue(mockBrowser as any);

      const profile = await fetchCompanyProfile("crash-test");
      expect(profile).toBeNull();
      expect(mockContext.close).toHaveBeenCalled();
    });

    it("returns profile with only page text when no JSON-LD exists", async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn(() => "https://himalayas.app/companies/nojsonld"),
        locator: vi.fn((selector: string) => {
          if (selector.includes("ld+json")) {
            return {
              first: vi.fn(() => ({
                textContent: vi.fn(() => Promise.resolve(null)),
              })),
            };
          }
          if (selector === "main") {
            return {
              first: vi.fn(() => ({
                textContent: vi.fn(() => Promise.resolve("Company page content")),
              })),
            };
          }
          return {
            first: vi.fn(() => ({
              textContent: vi.fn(() => Promise.resolve(null)),
            })),
          };
        }),
      };
      const mockContext = { newPage: vi.fn(() => mockPage), close: vi.fn() };
      const mockBrowser = { newContext: vi.fn(() => mockContext) };

      const { getBrowser } = await import("../../src/services/web-scraper.js");
      vi.mocked(getBrowser).mockResolvedValue(mockBrowser as any);

      const profile = await fetchCompanyProfile("nojsonld");
      expect(profile).not.toBeNull();
      expect(profile!.url).toBe("https://himalayas.app/companies/nojsonld");
      expect(profile!.pageText).toBe("Company page content");
      expect(profile!).not.toHaveProperty("name");
    });
  });
});
