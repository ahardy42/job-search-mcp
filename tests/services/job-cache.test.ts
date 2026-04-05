import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCachedJobs, setCachedJobs, clearExpiredJobs } from "../../src/services/job-cache.js";
import type { JobListing } from "../../src/services/linkedin.js";

function makeJob(overrides: Partial<JobListing> = {}): JobListing {
  return {
    position: "Engineer",
    company: "TestCo",
    location: "Remote",
    date: "2025-04-01",
    salary: "$100k",
    jobUrl: "https://example.com/job/1",
    agoTime: "1 day ago",
    source: "linkedin",
    ...overrides,
  };
}

describe("job-cache service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Clear any cached data between tests by setting expired entries
    // then clearing them
    clearExpiredJobs();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for a cache miss", () => {
    expect(getCachedJobs("nonexistent-key")).toBeNull();
  });

  it("stores and retrieves jobs", () => {
    const jobs = [makeJob(), makeJob({ position: "Staff Engineer" })];
    setCachedJobs("test-key", jobs);

    const cached = getCachedJobs("test-key");
    expect(cached).toHaveLength(2);
    expect(cached![0].position).toBe("Engineer");
    expect(cached![1].position).toBe("Staff Engineer");
  });

  it("returns null after TTL expires", () => {
    setCachedJobs("expiring-key", [makeJob()]);

    // Advance past 1hr TTL
    vi.advanceTimersByTime(1000 * 60 * 60 + 1);

    expect(getCachedJobs("expiring-key")).toBeNull();
  });

  it("returns data before TTL expires", () => {
    setCachedJobs("fresh-key", [makeJob()]);

    // Advance to just under 1hr
    vi.advanceTimersByTime(1000 * 60 * 59);

    expect(getCachedJobs("fresh-key")).toHaveLength(1);
  });

  it("overwrites existing cache entries", () => {
    setCachedJobs("overwrite-key", [makeJob({ position: "Old" })]);
    setCachedJobs("overwrite-key", [makeJob({ position: "New" })]);

    const cached = getCachedJobs("overwrite-key");
    expect(cached).toHaveLength(1);
    expect(cached![0].position).toBe("New");
  });

  it("isolates different cache keys", () => {
    setCachedJobs("key-a", [makeJob({ position: "Job A" })]);
    setCachedJobs("key-b", [makeJob({ position: "Job B" })]);

    expect(getCachedJobs("key-a")![0].position).toBe("Job A");
    expect(getCachedJobs("key-b")![0].position).toBe("Job B");
  });

  it("clearExpiredJobs removes only expired entries", () => {
    setCachedJobs("old-key", [makeJob({ position: "Old" })]);
    vi.advanceTimersByTime(1000 * 60 * 60 + 1);

    setCachedJobs("new-key", [makeJob({ position: "New" })]);

    clearExpiredJobs();

    expect(getCachedJobs("old-key")).toBeNull();
    expect(getCachedJobs("new-key")).toHaveLength(1);
  });
});
