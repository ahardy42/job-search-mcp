import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock random-useragent
vi.mock("random-useragent", () => ({
  default: {
    getRandom: vi.fn(() => "MockUserAgent/1.0"),
  },
}));

// Mock the web-scraper's getBrowser to avoid launching Playwright
vi.mock("../../src/services/web-scraper.js", () => ({
  getBrowser: vi.fn(),
}));

// Mock job-cache
vi.mock("../../src/services/job-cache.js", () => ({
  getCachedJobs: vi.fn(() => null),
  setCachedJobs: vi.fn(),
}));

// Define a complete mock Response object
const mockResponse = {
  ok: true,
  status: 200,
  statusText: "OK",
  headers: new Headers(),
  redirected: false,
  url: "",
  type: "basic" as const,
  text: vi.fn().mockResolvedValue(""),
  json: vi.fn().mockResolvedValue({}),
  blob: vi.fn().mockResolvedValue(new Blob()),
  arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  formData: vi.fn().mockResolvedValue(new FormData()),
  bytes: vi.fn().mockResolvedValue(new Uint8Array()),
  clone: vi.fn(),
  body: null,
  bodyUsed: false,
};

// Set clone to return itself to avoid circular reference issues
mockResponse.clone.mockReturnValue(mockResponse);

// Mock external network services so integration tests run offline
global.fetch = vi.fn().mockResolvedValue(mockResponse);

import { searchJobs, fetchJobDescription } from "../../src/services/linkedin.js";
import { getCachedJobs, setCachedJobs } from "../../src/services/job-cache.js";

// Sample LinkedIn HTML response
function buildJobListingHtml(jobs: { position: string; company: string; location: string }[]): string {
  const lis = jobs
    .map(
      (j) => `
      <li>
        <div class="base-search-card__title">${j.position}</div>
        <div class="base-search-card__subtitle">${j.company}</div>
        <div class="job-search-card__location">${j.location}</div>
        <time datetime="2025-03-28">Mar 28</time>
        <div class="job-search-card__salary-info">$120,000 - $160,000</div>
        <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/123"></a>
        <div class="job-search-card__listdate">2 days ago</div>
      </li>`
    )
    .join("\n");
  return `<html><body><ul>${lis}</ul></body></html>`;
}

describe("linkedin service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("searchJobs", () => {
    it("parses job listings from LinkedIn HTML", async () => {
      const html = buildJobListingHtml([
        { position: "Senior Engineer", company: "Acme Corp", location: "Remote" },
        { position: "Staff Engineer", company: "BigCo", location: "New York" },
      ]);

      // First call returns results, second returns empty (end of pagination)
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ...mockResponse, text: vi.fn().mockResolvedValue(html) })
        .mockResolvedValueOnce({ ...mockResponse, text: vi.fn().mockResolvedValue("<html><body><ul></ul></body></html>") });

      const jobs = await searchJobs({ keywords: "engineer" });

      expect(jobs).toHaveLength(2);
      expect(jobs[0].position).toBe("Senior Engineer");
      expect(jobs[0].company).toBe("Acme Corp");
      expect(jobs[0].location).toBe("Remote");
      expect(jobs[0].salary).toBe("$120,000 - $160,000");
      expect(jobs[0].jobUrl).toBe("https://www.linkedin.com/jobs/view/123");
      expect(jobs[0].agoTime).toBe("2 days ago");
      expect(jobs[0].source).toBe("linkedin");
      expect(jobs[1].position).toBe("Staff Engineer");
      expect(jobs[1].source).toBe("linkedin");
    });

    it("builds the search URL with correct filter parameters", async () => {
      vi.mocked(fetch).mockResolvedValue({ ...mockResponse, text: vi.fn().mockResolvedValue("<html><body><ul></ul></body></html>") });

      await searchJobs({
        keywords: "typescript",
        location: "Remote",
        dateSincePosted: "past week",
        jobType: "full time",
        remoteFilter: "remote",
        experienceLevel: "senior",
        salary: "120000",
        sortBy: "recent",
      });

      expect(vi.mocked(fetch)).toHaveBeenCalled();
      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain("keywords=typescript");
      expect(url).toContain("location=Remote");
      expect(url).toContain("f_TPR=r604800"); // past week
      expect(url).toContain("f_JT=F"); // full time
      expect(url).toContain("f_WT=2"); // remote
      expect(url).toContain("f_E=4"); // senior
      expect(url).toContain("f_SB2=5"); // 120000
      expect(url).toContain("sortBy=DD"); // recent
    });

    it("returns empty array when no results found", async () => {
      vi.mocked(fetch).mockResolvedValue({ ...mockResponse, text: vi.fn().mockResolvedValue("<html><body><ul></ul></body></html>") });

      const jobs = await searchJobs({ keywords: "nonexistent-role-xyz" });
      expect(jobs).toEqual([]);
    });

    it("stops after MAX_CONSECUTIVE_ERRORS", async () => {
      vi.mocked(fetch).mockRejectedValue(new Error("Network error"));

      const jobs = await searchJobs({ keywords: "error-test" });

      // Should have retried 3 times (MAX_CONSECUTIVE_ERRORS) then stopped
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
      expect(jobs).toEqual([]);
    });

    it("uses shared job cache for storing results", async () => {
      const html = buildJobListingHtml([
        { position: "Cache Test", company: "CacheCo", location: "Remote" },
      ]);
      vi.mocked(fetch)
        .mockResolvedValueOnce({ ...mockResponse, text: vi.fn().mockResolvedValue(html) })
        .mockResolvedValueOnce({ ...mockResponse, text: vi.fn().mockResolvedValue("<html><body><ul></ul></body></html>") });

      await searchJobs({ keywords: "cache-store-test" });

      expect(vi.mocked(setCachedJobs)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(setCachedJobs).mock.calls[0][0]).toContain("linkedin:");
    });

    it("returns cached results when available", async () => {
      const cachedJobs = [{
        position: "Cached", company: "Co", location: "Remote",
        date: "", salary: "", jobUrl: "", agoTime: "", source: "linkedin" as const,
      }];
      vi.mocked(getCachedJobs).mockReturnValueOnce(cachedJobs);

      const jobs = await searchJobs({ keywords: "cached-query" });
      expect(jobs).toBe(cachedJobs);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("skips list items without position or company", async () => {
      const html = `<html><body><ul>
        <li><div class="base-search-card__title"></div><div class="base-search-card__subtitle">SomeCo</div></li>
        <li><div class="base-search-card__title">Good Job</div><div class="base-search-card__subtitle">GoodCo</div>
          <div class="job-search-card__location">NYC</div>
          <time datetime="2025-04-01">Apr 1</time>
          <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/456"></a>
          <div class="job-search-card__listdate">1 day ago</div>
        </li>
      </ul></body></html>`;

      vi.mocked(fetch)
        .mockResolvedValueOnce({ ...mockResponse, text: vi.fn().mockResolvedValue(html) })
        .mockResolvedValueOnce({ ...mockResponse, text: vi.fn().mockResolvedValue("<html><body><ul></ul></body></html>") });

      const jobs = await searchJobs({ keywords: "filter-test" });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].position).toBe("Good Job");
    });
  });

  describe("fetchJobDescription", () => {
    it("rejects non-LinkedIn URLs", async () => {
      await expect(fetchJobDescription("https://evil.com/jobs/view/123")).rejects.toThrow(
        "job_url must be a LinkedIn URL"
      );
    });

    it("rejects non-HTTPS URLs", async () => {
      await expect(fetchJobDescription("http://www.linkedin.com/jobs/view/123")).rejects.toThrow(
        "job_url must use HTTPS"
      );
    });

    it("rejects URLs with unexpected hostnames", async () => {
      await expect(
        fetchJobDescription("https://linkedin.evil.com/jobs/view/123")
      ).rejects.toThrow("job_url must be a LinkedIn URL");
    });

    it("accepts www.linkedin.com URLs", async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn(() => "https://www.linkedin.com/jobs/view/123"),
        locator: vi.fn(() => ({
          first: vi.fn(() => ({
            textContent: vi.fn(() => Promise.resolve("Job description text here")),
          })),
        })),
      };
      const mockContext = {
        newPage: vi.fn(() => mockPage),
        close: vi.fn(),
      };
      const mockBrowser = {
        newContext: vi.fn(() => mockContext),
      };

      const { getBrowser } = await import("../../src/services/web-scraper.js");
      vi.mocked(getBrowser).mockResolvedValue(mockBrowser as any);

      const description = await fetchJobDescription("https://www.linkedin.com/jobs/view/123");
      expect(description).toBe("Job description text here");
    });

    it("accepts linkedin.com URLs without www", async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn(() => "https://linkedin.com/jobs/view/456"),
        locator: vi.fn(() => ({
          first: vi.fn(() => ({
            textContent: vi.fn(() => Promise.resolve("Another description")),
          })),
        })),
      };
      const mockContext = {
        newPage: vi.fn(() => mockPage),
        close: vi.fn(),
      };
      const mockBrowser = {
        newContext: vi.fn(() => mockContext),
      };

      const { getBrowser } = await import("../../src/services/web-scraper.js");
      vi.mocked(getBrowser).mockResolvedValue(mockBrowser as any);

      const description = await fetchJobDescription("https://linkedin.com/jobs/view/456");
      expect(description).toBe("Another description");
    });

    it("rejects if redirect leads to non-LinkedIn URL", async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn(() => "https://evil.com/phishing"),
        locator: vi.fn(),
      };
      const mockContext = {
        newPage: vi.fn(() => mockPage),
        close: vi.fn(),
      };
      const mockBrowser = {
        newContext: vi.fn(() => mockContext),
      };

      const { getBrowser } = await import("../../src/services/web-scraper.js");
      vi.mocked(getBrowser).mockResolvedValue(mockBrowser as any);

      await expect(
        fetchJobDescription("https://www.linkedin.com/jobs/view/789")
      ).rejects.toThrow("Redirect led to a non-LinkedIn URL");

      // Verify context was closed (cleanup in finally block)
      expect(mockContext.close).toHaveBeenCalled();
    });

    it("rejects if redirect leads to non-HTTPS URL", async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn(() => "http://www.linkedin.com/jobs/view/789"),
        locator: vi.fn(),
      };
      const mockContext = {
        newPage: vi.fn(() => mockPage),
        close: vi.fn(),
      };
      const mockBrowser = {
        newContext: vi.fn(() => mockContext),
      };

      const { getBrowser } = await import("../../src/services/web-scraper.js");
      vi.mocked(getBrowser).mockResolvedValue(mockBrowser as any);

      await expect(
        fetchJobDescription("https://www.linkedin.com/jobs/view/789")
      ).rejects.toThrow("Redirect led to a non-HTTPS URL");
    });

    it("throws when no description text is found on page", async () => {
      const mockPage = {
        goto: vi.fn(),
        url: vi.fn(() => "https://www.linkedin.com/jobs/view/999"),
        locator: vi.fn(() => ({
          first: vi.fn(() => ({
            textContent: vi.fn(() => Promise.resolve(null)),
          })),
        })),
      };
      const mockContext = {
        newPage: vi.fn(() => mockPage),
        close: vi.fn(),
      };
      const mockBrowser = {
        newContext: vi.fn(() => mockContext),
      };

      const { getBrowser } = await import("../../src/services/web-scraper.js");
      vi.mocked(getBrowser).mockResolvedValue(mockBrowser as any);

      await expect(
        fetchJobDescription("https://www.linkedin.com/jobs/view/999")
      ).rejects.toThrow("Could not extract job description");
    });
  });
});
