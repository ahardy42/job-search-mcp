import { CACHE_TTL_MS } from "../constants.js";
import type { JobListing } from "./linkedin.js";

interface CacheEntry {
  data: JobListing[];
  timestamp: number;
}

const store = new Map<string, CacheEntry>();

export function getCachedJobs(key: string): JobListing[] | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

export function setCachedJobs(key: string, jobs: JobListing[]): void {
  store.set(key, { data: jobs, timestamp: Date.now() });
}

export function clearExpiredJobs(): void {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.timestamp > CACHE_TTL_MS) {
      store.delete(key);
    }
  }
}
