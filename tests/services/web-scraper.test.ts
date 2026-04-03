import { describe, it, expect, vi, beforeEach } from "vitest";
import { isIP } from "net";

// We need to test the internal functions. Since isPrivateIP and validateExternalUrl
// are not exported, we'll test them via scrapePageContent which calls them,
// and also re-implement the logic tests for isPrivateIP directly.

// Mock playwright to avoid launching a real browser
vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(() =>
      Promise.resolve({
        newContext: vi.fn(),
        close: vi.fn(),
      })
    ),
  },
}));

// Mock dns/promises for validateExternalUrl tests
vi.mock("dns/promises", () => ({
  lookup: vi.fn(),
}));

import { lookup } from "dns/promises";

const mockedLookup = vi.mocked(lookup);

// Import after mocks
import { scrapePageContent } from "../../src/services/web-scraper.js";

describe("web-scraper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("URL validation (via scrapePageContent)", () => {
    it("rejects HTTP URLs (requires HTTPS)", async () => {
      await expect(scrapePageContent("http://example.com")).rejects.toThrow(
        "URL must use HTTPS"
      );
    });

    it("rejects localhost URLs", async () => {
      await expect(scrapePageContent("https://localhost/admin")).rejects.toThrow(
        "URL must not target internal/private network addresses"
      );
    });

    it("rejects .internal domains", async () => {
      await expect(scrapePageContent("https://app.internal/api")).rejects.toThrow(
        "URL must not target internal/private network addresses"
      );
    });

    it("rejects .local domains", async () => {
      await expect(scrapePageContent("https://printer.local/config")).rejects.toThrow(
        "URL must not target internal/private network addresses"
      );
    });

    it("rejects IP literal 127.0.0.1 (loopback)", async () => {
      await expect(scrapePageContent("https://127.0.0.1/admin")).rejects.toThrow(
        "URL must not target internal/private network addresses"
      );
    });

    it("rejects IP literal 10.x.x.x (private)", async () => {
      await expect(scrapePageContent("https://10.0.0.1/secret")).rejects.toThrow(
        "URL must not target internal/private network addresses"
      );
    });

    it("rejects IP literal 172.16.x.x (private)", async () => {
      await expect(scrapePageContent("https://172.16.0.1/admin")).rejects.toThrow(
        "URL must not target internal/private network addresses"
      );
    });

    it("rejects IP literal 192.168.x.x (private)", async () => {
      await expect(scrapePageContent("https://192.168.1.1/admin")).rejects.toThrow(
        "URL must not target internal/private network addresses"
      );
    });

    it("rejects IP literal 169.254.x.x (link-local)", async () => {
      await expect(scrapePageContent("https://169.254.169.254/metadata")).rejects.toThrow(
        "URL must not target internal/private network addresses"
      );
    });

    it("rejects IP literal 0.0.0.0", async () => {
      await expect(scrapePageContent("https://0.0.0.0/")).rejects.toThrow(
        "URL must not target internal/private network addresses"
      );
    });

    it("rejects IPv6 loopback [::1]", async () => {
      await expect(scrapePageContent("https://[::1]/admin")).rejects.toThrow(
        "URL must not target internal/private network addresses"
      );
    });

    it("rejects hostnames that resolve to private IPs (DNS rebinding prevention)", async () => {
      mockedLookup.mockResolvedValue({ address: "127.0.0.1", family: 4 } as any);

      await expect(scrapePageContent("https://evil-rebind.example.com/")).rejects.toThrow(
        /resolves to private address/
      );
    });

    it("rejects hostnames that resolve to 10.x.x.x", async () => {
      mockedLookup.mockResolvedValue({ address: "10.0.0.5", family: 4 } as any);

      await expect(scrapePageContent("https://internal-proxy.example.com/")).rejects.toThrow(
        /resolves to private address/
      );
    });

    it("rejects hostnames resolving to 169.254.x.x (cloud metadata)", async () => {
      mockedLookup.mockResolvedValue({ address: "169.254.169.254", family: 4 } as any);

      await expect(scrapePageContent("https://metadata.example.com/")).rejects.toThrow(
        /resolves to private address/
      );
    });

    it("rejects IPv6 link-local fe80:: addresses", async () => {
      await expect(scrapePageContent("https://[fe80::1]/admin")).rejects.toThrow(
        "URL must not target internal/private network addresses"
      );
    });

    it("rejects IPv6 unique-local fc00::/fd00:: addresses", async () => {
      await expect(scrapePageContent("https://[fc00::1]/")).rejects.toThrow(
        "URL must not target internal/private network addresses"
      );
      await expect(scrapePageContent("https://[fd12::1]/")).rejects.toThrow(
        "URL must not target internal/private network addresses"
      );
    });

    it("allows valid 172.x addresses outside the private range", async () => {
      // 172.32.0.1 is NOT in the 172.16.0.0/12 range, so it should be allowed
      // DNS will be looked up for non-IP hostnames; for IP literals it goes direct
      // 172.32.0.1 as IP literal should pass the private IP check
      // Actually 172.32.x.x IS public. Let's check:
      // 172.16-31.x.x = private, 172.32+ = public
      // But scrapePageContent will still try to launch a browser, so we just verify
      // the URL validation passes by checking it doesn't throw the private IP error
      mockedLookup.mockResolvedValue({ address: "172.32.0.1", family: 4 } as any);

      // This will fail later (no real browser), but it should NOT fail on URL validation
      const promise = scrapePageContent("https://172.32.0.1/page");
      await expect(promise).rejects.not.toThrow(
        "URL must not target internal/private network addresses"
      );
    });
  });

  describe("isPrivateIP logic coverage", () => {
    // Since isPrivateIP is not exported, we test the logic by verifying
    // that scrapePageContent with IP-literal URLs correctly rejects/accepts

    const privateIPs = [
      "127.0.0.1",
      "127.255.255.255",
      "10.0.0.0",
      "10.255.255.255",
      "172.16.0.0",
      "172.31.255.255",
      "192.168.0.0",
      "192.168.255.255",
      "169.254.0.0",
      "169.254.255.255",
      "0.0.0.0",
    ];

    for (const ip of privateIPs) {
      it(`rejects private IP literal ${ip}`, async () => {
        await expect(scrapePageContent(`https://${ip}/`)).rejects.toThrow(
          "URL must not target internal/private network addresses"
        );
      });
    }

    const publicIPs = ["8.8.8.8", "1.1.1.1", "203.0.113.1", "172.32.0.1"];

    for (const ip of publicIPs) {
      it(`allows public IP literal ${ip} past URL validation`, async () => {
        const promise = scrapePageContent(`https://${ip}/`);
        // Should not fail on URL validation (will fail on browser mock)
        await expect(promise).rejects.not.toThrow(
          "URL must not target internal/private network addresses"
        );
      });
    }
  });
});
