import { describe, expect, test } from "bun:test";
import {
  normalizeCustomHostname,
  registrableDomain,
} from "../src/utils/custom-domain-hostnames";

const ok = (input: string) => {
  const result = normalizeCustomHostname(input);
  if (!result.ok) throw new Error(`${input}: ${result.code}`);
  return result;
};
const code = (input: string) => {
  const result = normalizeCustomHostname(input);
  return result.ok ? "OK" : result.code;
};

describe("custom domain hostnames", () => {
  test("normalizes what writers paste", () => {
    expect(ok("  MyFrens.US  ").hostname).toBe("myfrens.us");
    expect(ok("https://Pages.MyFrens.us/some/path?x=1").hostname).toBe(
      "pages.myfrens.us",
    );
    expect(ok("pages.myfrens.us.").hostname).toBe("pages.myfrens.us");
    expect(ok("pages.myfrens.us:8443").hostname).toBe("pages.myfrens.us");
    expect(ok("bücher.de").hostname).toBe("xn--bcher-kva.de");
  });

  test("tells bare domains from subdomains", () => {
    expect(ok("myfrens.us")).toMatchObject({ kind: "apex", zone: "myfrens.us" });
    expect(ok("pages.myfrens.us")).toMatchObject({
      kind: "subdomain",
      zone: "myfrens.us",
    });
    expect(ok("example.co.uk").kind).toBe("apex");
    expect(ok("reports.example.co.uk")).toMatchObject({
      kind: "subdomain",
      zone: "example.co.uk",
    });
    expect(ok("a.b.example.com").kind).toBe("subdomain");
    expect(registrableDomain("x.y.example.com.au")).toBe("example.com.au");
  });

  test("rejects Twyne's own hosts", () => {
    expect(code("twyne.love")).toBe("HOSTNAME_TWYNE");
    expect(code("www.twyne.love")).toBe("HOSTNAME_TWYNE");
    expect(code("mara.twyne.love")).toBe("HOSTNAME_TWYNE");
    expect(code("twyne.love.example.com")).toBe("OK");
  });

  test("rejects hosting provider names", () => {
    expect(code("twyne-production.up.railway.app")).toBe("HOSTNAME_PROVIDER");
    expect(code("railway.app")).toBe("HOSTNAME_PROVIDER");
    expect(code("acoustic-meerkat-189.convex.cloud")).toBe("HOSTNAME_PROVIDER");
  });

  test("rejects IPs, local names and malformed input", () => {
    expect(code("")).toBe("HOSTNAME_EMPTY");
    expect(code("https://")).toBe("HOSTNAME_EMPTY");
    expect(code("192.168.1.10")).toBe("HOSTNAME_IP");
    expect(code("[::1]")).toBe("HOSTNAME_IP");
    expect(code("localhost")).toBe("HOSTNAME_LOCAL");
    expect(code("printer.local")).toBe("HOSTNAME_LOCAL");
    expect(code("site.test")).toBe("HOSTNAME_LOCAL");
    expect(code("*.example.com")).toBe("HOSTNAME_WILDCARD");
    for (const bad of [
      "example",
      "exa mple.com",
      "-example.com",
      "example-.com",
      "ex_ample.com",
      "example..com",
      "example.c0m",
      "user@example.com",
      "co.uk",
      `${"a".repeat(64)}.com`,
    ]) {
      expect(code(bad)).toBe("HOSTNAME_INVALID");
    }
    expect(code(`${"a.".repeat(127)}com`)).toBe("HOSTNAME_TOO_LONG");
  });
});
