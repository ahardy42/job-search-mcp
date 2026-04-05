import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CHARACTER_LIMIT = 25000;
export const LINKEDIN_HOST = "www.linkedin.com";
export const BATCH_SIZE = 25;
export const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour
export const REQUEST_TIMEOUT_MS = 10000;
export const MAX_CONSECUTIVE_ERRORS = 3;
export const BASE_DELAY_MS = 2000;

export const HIMALAYAS_HOST = "himalayas.app";
export const HIMALAYAS_API_BASE = "https://himalayas.app/jobs/api";
export const HIMALAYAS_PAGE_SIZE = 20;
export const HIMALAYAS_MAX_COUNT = 100;

export const PROFILE_DIR = process.env.PROFILE_DIR || path.resolve(__dirname, "..", "profile");
export const RESEARCH_CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
export const MAX_SEARCH_RESULTS = 10;
