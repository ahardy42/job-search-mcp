# Job Board API & Scraping Viability: Comparative Analysis

*Date: 2026-04-05 | Sources: 18*

---

## Overview

The `job_search` tool currently scrapes LinkedIn's public guest API as its sole data source. This analysis evaluates 12 alternative job boards for API/scraping viability to augment search coverage, enable result de-duplication, and reduce dependency on a single source that aggressively rate-limits.

**Evaluation criteria:**
- **Auth Required** — Does the source require API keys or registration?
- **Rate Limits** — How restrictive is access?
- **Data Quality** — Richness of fields returned (salary, description, etc.)
- **Integration Effort** — How much work to add to the existing MCP server?
- **Job Volume** — How many listings are available?
- **Remote Focus** — Does it specialize in remote/WFH roles?
- **De-dupe Risk** — Likelihood of overlapping with LinkedIn results

---

## Comparison Summary

| Criterion | RemoteOK | Remotive | Himalayas | Arbeitnow | Adzuna | Indeed (via ts-jobspy) | WeWorkRemotely | Glassdoor | ZipRecruiter | JSearch (RapidAPI) | Google Jobs (SerpApi) | FlexJobs |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Auth Required** | None | None | None | None | API Key | None (scraping) | Token required | None (scraping) | Partner only | API Key | API Key | Paid subscription |
| **Rate Limits** | Generous | 2 req/min | Rate-limited (429) | Unknown | Tier-based | Minimal (Indeed) | 1000/day | Anti-bot | Cloudflare | Tier-based | 100 free/mo | N/A |
| **Data Quality** | Good | Good | Excellent | Basic | Excellent | Good | Good | Good | Good | Excellent | Excellent | N/A |
| **Integration Effort** | Very Low | Very Low | Low | Very Low | Low | Medium | Medium | High | High | Low | Low | N/A |
| **Job Volume** | ~30K+ | ~5K | ~10K | ~5K (EU) | Millions | Millions | ~5K | Millions | Millions | Aggregated | Aggregated | ~50K |
| **Remote Focus** | 100% remote | 100% remote | 100% remote | EU/visa jobs | General | General | 100% remote | General | General | General | General | Remote/flex |
| **De-dupe Risk** | Low | Low | Low | Low | Medium | High | Low | High | High | High | High | N/A |

**Rating key:** Very Low/Low/Medium/High effort; Generous/Minimal/Restrictive rate limits.

---

## Detailed Analysis

### Tier 1: Free Public JSON APIs (No Auth) — Recommended First

#### RemoteOK

**Endpoint:** `GET https://remoteok.com/api`

**Strengths:**
- Completely free, no auth, CORS-enabled [1]
- Returns JSON array with id, slug, company, position, date, description (HTML), tags, location, salary_min/max, apply_url, company_logo [1]
- 100% uptime, ~94ms response time [1]
- 30K+ remote jobs, claims 80% coverage of remote jobs on the web [1]
- Low overlap with LinkedIn — curated remote-only board

**Weaknesses:**
- Must credit RemoteOK and link back to job URL [1]
- Salary data sparse (most listings show 0/0) [1]
- Single endpoint with no search/filter params — must fetch all and filter client-side [1]
- Jobs include hidden verification words for applicants [1]

**Best For:** Broad remote job coverage with minimal integration effort. Fetch-all-and-filter approach fits well with the existing caching pattern.

---

#### Remotive

**Endpoint:** `GET https://remotive.com/api/remote-jobs`

**Strengths:**
- Free, no auth required [2][3]
- Server-side filtering: `category`, `company_name`, `search`, `limit` params [3]
- Clean JSON response: id, url, title, company_name, company_logo, category, job_type, publication_date, candidate_required_location, salary, description [3]
- Categories endpoint for dynamic filter options [3]
- Low LinkedIn overlap — independent curated remote board

**Weaknesses:**
- Max 2 requests/minute, recommended max 4x/day [3]
- Jobs delayed 24 hours from posting [3]
- Must credit Remotive and link back [3]
- Prohibited from submitting data to Google Jobs, LinkedIn Jobs [3]
- ~5K listings (smaller pool)

**Best For:** Targeted remote job searches with server-side filtering. Rate limits align well with MCP tool usage patterns (human-initiated, not bulk).

---

#### Himalayas

**Endpoints:**
- Browse: `GET https://himalayas.app/jobs/api`
- Search: `GET https://himalayas.app/jobs/api/search`

**Strengths:**
- Free, no auth, documented OpenAPI 3.1 spec [4]
- Rich search params: q, country, worldwide, seniority, employment_type, company, timezone, sort [4]
- Excellent data quality: title, excerpt, companyName, companyLogo, employmentType, minSalary, maxSalary, seniority, currency, locationRestrictions, timezoneRestrictions, categories, description (sanitized HTML), pubDate, expiryDate, applicationLink [4]
- Salary data consistently included [4]
- Also offers an MCP server (potential reference implementation) [4]

**Weaknesses:**
- Max 20 results per request (recently reduced from higher limit) [4]
- Rate-limited (429 on excess), refreshes every 24hr [4]
- Must include visible link back to himalayas.app [4]
- ~10K listings (medium pool)

**Best For:** Highest data quality among free APIs. Seniority and timezone filtering maps well to existing tool params.

---

#### Arbeitnow

**Endpoint:** `GET https://www.arbeitnow.com/api/job-board-api`

**Strengths:**
- Free, no auth required [5]
- Aggregates from multiple ATS (Greenhouse, SmartRecruiters, Join.com, Team Tailor, Recruitee, Comeet) [5]
- Visa sponsorship filter [5]
- EU/international focus fills geographic gap [5]

**Weaknesses:**
- Limited filter params (visa_sponsorship boolean only documented) [5]
- Rate limits not documented [5]
- Basic data fields compared to Himalayas [5]
- EU-focused — less relevant for US remote searches [5]

**Best For:** Supplementing EU/international job coverage. Good for users seeking visa sponsorship roles.

---

### Tier 2: API Key Required (Free Tier Available)

#### Adzuna

**Endpoint:** `GET https://api.adzuna.com/v1/api/jobs/{country}/search/{page}`

**Strengths:**
- Covers multiple countries (UK, US, AU, etc.) [6]
- Nine endpoints including salary trends and vacancy data [6]
- Multiple response formats (JSON, JSONP, XML, XLSX) [6]
- Large dataset — millions of listings [6]
- Good for non-remote general job searches

**Weaknesses:**
- Requires registration + API key (app_id + app_key) [6]
- Free tier rate limits not clearly documented [6]
- Higher LinkedIn de-dupe risk (aggregates from same sources) [6]

**Best For:** General job search expansion beyond remote-only, salary trend analysis.

---

#### JSearch (RapidAPI)

**Strengths:**
- Aggregates from LinkedIn, Indeed, Glassdoor, ZipRecruiter, Google Jobs [7]
- 30+ data points per job [7]
- Real-time data from Google for Jobs [7]
- Single API covers multiple boards

**Weaknesses:**
- Requires RapidAPI key [7]
- Free tier limited (specifics unclear, likely ~100 searches/mo) [7]
- Paid tiers start at $30-75/mo [7]
- High de-dupe risk since it aggregates the same major boards [7]
- Adds external dependency on RapidAPI platform

**Best For:** If budget allows, this is a single integration that covers multiple boards. Not ideal for a free/open-source tool.

---

### Tier 3: Scraping Required (No Public API)

#### Indeed (via ts-jobspy)

**Strengths:**
- Massive job volume (millions of listings) [8]
- ts-jobspy provides TypeScript-native scraping library [9]
- Indeed has minimal rate limiting compared to LinkedIn [8]
- Rich data: title, company, location, salary, description, job_type [9]
- Concurrent scraping of multiple boards [9]

**Weaknesses:**
- ts-jobspy currently only supports LinkedIn and Indeed (others "under maintenance") [9]
- Requires Node.js 20+ [9]
- Capped at ~1000 jobs per search [8]
- Scraping (not API) — subject to breakage on site changes [8]
- High LinkedIn de-dupe risk (Indeed aggregates many of the same jobs) [8]
- Legal gray area re: Indeed's ToS [8]

**Best For:** Significantly expanding volume if rate limits on free APIs prove insufficient. Worth monitoring ts-jobspy's Glassdoor/ZipRecruiter support maturity.

---

#### WeWorkRemotely

**Strengths:**
- High-quality curated remote jobs (~5K) [10]
- Official JSON API exists at `/api/v1/remote-jobs/` [10]
- Low LinkedIn overlap — independent board [10]

**Weaknesses:**
- Requires API token (must email for access) [10]
- 1000 requests/day limit [10]
- Must route applications through WWR website [10]
- Token acquisition is a manual process [10]

**Best For:** High-quality remote roles, but gated access makes it less suitable for an open-source tool.

---

#### Glassdoor

**Strengths:**
- Large dataset with unique company review/salary data [11]
- Some public pages accessible without login [11]

**Weaknesses:**
- No public API [11]
- Heavy anti-bot protections [11]
- Requires browser automation (Playwright) [11]
- Login wall for many features [11]
- Complex scraping with CAPTCHA challenges [11]

**Best For:** Company research (already covered by `company_research` tool). Not viable for primary job search.

---

#### ZipRecruiter

**Strengths:**
- Large US job market coverage [12]
- Partner API exists [12]

**Weaknesses:**
- API access restricted to approved partners [12]
- Cloudflare bot protection blocks common scrapers [12]
- Requires JavaScript rendering for scraping [12]
- Complex anti-bot measures [12]

**Best For:** Only viable through ts-jobspy or paid scraping services. Not recommended for direct integration.

---

#### FlexJobs

**Weaknesses:**
- Paid subscription site ($25-50/mo) [13]
- No public API or scrapeable listings [13]
- Jobs behind paywall

**Best For:** Not viable for integration.

---

#### Google Jobs (via SerpApi)

**Strengths:**
- Aggregates from all major boards [14]
- Excellent de-duplication built-in [14]
- Rich structured data [14]

**Weaknesses:**
- SerpApi Developer plan: $75/mo for 5K searches [14]
- Free tier: ~100 searches/month [14]
- Adds paid dependency [14]

**Best For:** Premium option if budget available. Good de-duplication.

---

## Recommendation

### Phase 1 — Immediate (Low Effort, High Value)

Integrate these three free, no-auth JSON APIs alongside LinkedIn:

1. **RemoteOK** — Fetch all, cache locally (24hr TTL), filter client-side. Minimal code: single fetch + JSON parse.
2. **Remotive** — Use server-side search params. Respects 2/min rate limit naturally via MCP tool invocation pattern.
3. **Himalayas** — Best data quality. Map seniority/employment_type params to existing tool schema.

**Architecture approach:**
- Create a `src/services/` file per source (matching existing `linkedin.ts` pattern)
- Each exports a `searchJobs()` returning the same `JobListing` interface
- Add a `source` field to `JobListing` for attribution
- De-duplicate across sources by normalizing: lowercase company + title + location → hash → Set-based de-dupe
- Aggregate results, sort by date, truncate to `CHARACTER_LIMIT`

### Phase 2 — Medium Term

4. **Arbeitnow** — Add for EU/international coverage if user demand exists.
5. **Adzuna** — Add for general (non-remote) job coverage. Requires env var for API key.

### Phase 3 — Future Consideration

6. **ts-jobspy (Indeed)** — Monitor the TypeScript port's maturity. When Glassdoor/ZipRecruiter support stabilizes, this single dependency covers 5 boards. However, it's a scraping library (not API), so expect maintenance burden.
7. **WeWorkRemotely** — Only if API token can be obtained. Manual process makes it unsuitable for general distribution.

### Not Recommended

- **Glassdoor** — No API, heavy anti-bot. Already covered by `company_research` tool for reviews.
- **ZipRecruiter** — Partner-only API, Cloudflare protection.
- **FlexJobs** — Paywall, no API.
- **JSearch/SerpApi** — Paid services not appropriate for a free open-source MCP tool.

### De-duplication Strategy

Jobs from different sources frequently overlap (Indeed/LinkedIn especially). Recommended approach:
1. Normalize: `(company.toLowerCase().trim() + title.toLowerCase().trim() + location.toLowerCase().trim())`
2. Hash the normalized string (simple string hash or MD5)
3. Use a Set to track seen hashes across sources
4. Prefer the listing with the most complete data (salary, description length) when duplicates found
5. Tag each result with `source: "linkedin" | "remoteok" | "remotive" | "himalayas"` for transparency

---

## Sources

1. [RemoteOK API](https://remoteok.com/api) — Free public JSON endpoint, 100% uptime, ~94ms response
2. [Remotive Remote Jobs API (GitHub)](https://github.com/remotive-com/remote-jobs-api) — Official API docs with endpoint/param reference
3. [Remotive API Documentation](https://remotive.com/api/remote-jobs) — Endpoint, categories, rate limits
4. [Himalayas Remote Jobs API Reference](https://himalayas.app/docs/remote-jobs-api) — Full OpenAPI 3.1 documentation
5. [Arbeitnow Job Board API](https://www.arbeitnow.com/blog/job-board-api) — Free public API for EU jobs
6. [Adzuna Developer API](https://developer.adzuna.com/overview) — Multi-country job search API with key
7. [JSearch API on RapidAPI](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch) — Aggregated job search API
8. [JobSpy GitHub (Python)](https://github.com/speedyapply/JobSpy) — Multi-board scraper library
9. [ts-jobspy GitHub (TypeScript)](https://github.com/alpharomercoma/ts-jobspy) — TypeScript port of JobSpy
10. [WeWorkRemotely API](https://weworkremotely.com/api) — Official API documentation and terms
11. [How to Scrape Glassdoor (2026)](https://scrapfly.io/blog/posts/how-to-scrape-glassdoor) — Scraping guide and anti-bot analysis
12. [ZipRecruiter API Overview](https://publicapis.io/zip-recruiter-api) — Partner API documentation
13. [FlexJobs](https://www.flexjobs.com/) — Paid subscription remote job board
14. [SerpApi Google Jobs API](https://serpapi.com/google-jobs-api) — Google Jobs scraping service
15. [Free Public APIs - RemoteOK](https://www.freepublicapis.com/remote-ok-jobs-api) — API reliability metrics
16. [Remotive Helpdesk - Public API](https://support.remotive.com/en/article/list-remote-jobs-public-api-105pww2/) — Official usage guidelines
17. [Arbeitnow Postman Docs](https://documenter.getpostman.com/view/18545278/UVJbJdKh) — Full API specification
18. [Himalayas MCP Server](https://himalayas.app/mcp) — Reference MCP implementation for job search
