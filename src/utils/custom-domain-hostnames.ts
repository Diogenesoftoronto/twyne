/**
 * Hostname rules for writers' custom domains. Shared by the Convex mutations
 * (the authority) and the settings form (early feedback), so both agree.
 */

import {
  TWYNE_HOST_SUFFIXES,
  isIpAddress,
} from "../../scripts/custom-domain-routing.mjs";

/**
 * Fair-use cap. Hosting on a custom domain has no extra charge; the cap keeps
 * one account from using up the hosting provider's per-service domain limit.
 */
export const CUSTOM_DOMAIN_LIMIT = 3;

export type CustomDomainKind = "apex" | "subdomain";

export type HostnameErrorCode =
  | "HOSTNAME_EMPTY"
  | "HOSTNAME_INVALID"
  | "HOSTNAME_TOO_LONG"
  | "HOSTNAME_IP"
  | "HOSTNAME_LOCAL"
  | "HOSTNAME_TWYNE"
  | "HOSTNAME_PROVIDER"
  | "HOSTNAME_WILDCARD";

export type HostnameResult =
  | { ok: true; hostname: string; kind: CustomDomainKind; zone: string }
  | { ok: false; code: HostnameErrorCode; message: string };

const ERROR_MESSAGES: Record<HostnameErrorCode, string> = {
  HOSTNAME_EMPTY: "Enter a domain, like example.com or pages.example.com.",
  HOSTNAME_INVALID:
    "That isn't a domain name. Use something like example.com or pages.example.com.",
  HOSTNAME_TOO_LONG: "That domain name is too long.",
  HOSTNAME_IP: "Use a domain name, not an IP address.",
  HOSTNAME_LOCAL: "Use a public domain name.",
  HOSTNAME_TWYNE:
    "Twyne addresses come with your account. Add a domain you own instead.",
  HOSTNAME_PROVIDER:
    "That name belongs to a hosting provider. Add a domain you own instead.",
  HOSTNAME_WILDCARD: "Add one domain at a time. Wildcards aren't supported.",
};

/** Names a writer can never claim, beyond Twyne's own hosts. */
const BLOCKED_SUFFIXES = [
  ...TWYNE_HOST_SUFFIXES,
  "railway.dev",
  "railwaydns.net",
  "convex.cloud",
  "convex.site",
  "convex.dev",
  "notorganic.com",
];

const LOCAL_SUFFIXES = [
  "localhost",
  "local",
  "internal",
  "lan",
  "home",
  "test",
  "example",
  "invalid",
  "onion",
];

/**
 * Common two-label public suffixes, so `example.co.uk` is a bare domain and
 * not a subdomain of `co.uk`. Not the full Public Suffix List: the hosting
 * provider's DNS answer (its `zone`) is authoritative once the domain is
 * registered, and corrects the kind when this list misses a suffix.
 */
const MULTI_LABEL_SUFFIXES = new Set([
  "ac.uk",
  "co.uk",
  "gov.uk",
  "ltd.uk",
  "me.uk",
  "net.uk",
  "org.uk",
  "plc.uk",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "id.au",
  "co.nz",
  "net.nz",
  "org.nz",
  "co.jp",
  "ne.jp",
  "or.jp",
  "co.kr",
  "com.br",
  "net.br",
  "org.br",
  "com.mx",
  "com.ar",
  "com.tr",
  "co.za",
  "co.in",
  "net.in",
  "org.in",
  "com.cn",
  "net.cn",
  "org.cn",
  "com.tw",
  "com.hk",
  "com.sg",
  "com.my",
  "co.id",
  "co.il",
  "com.ua",
  "com.pl",
  "co.th",
  "com.vn",
  "com.ph",
  "com.co",
  "com.pe",
  "com.ng",
  "co.ke",
]);

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD_RE = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

function fail(code: HostnameErrorCode): HostnameResult {
  return { ok: false, code, message: ERROR_MESSAGES[code] };
}

function endsWithSuffix(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

/** Error text for a code, for callers that only kept the code. */
export function hostnameErrorMessage(code: HostnameErrorCode): string {
  return ERROR_MESSAGES[code];
}

/**
 * The registrable domain (zone) of a hostname, using the short suffix list
 * above: `pages.example.co.uk` -> `example.co.uk`.
 */
export function registrableDomain(hostname: string): string {
  const labels = hostname.split(".");
  const lastTwo = labels.slice(-2).join(".");
  const take = MULTI_LABEL_SUFFIXES.has(lastTwo) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/**
 * Normalize what a writer typed (`https://Pages.Example.com/path`, a trailing
 * dot, a port, Unicode) to a lowercase ASCII hostname, and validate it.
 */
export function normalizeCustomHostname(input: string): HostnameResult {
  let value = input.trim().toLowerCase();
  if (!value) return fail("HOSTNAME_EMPTY");
  if (value.includes("*")) return fail("HOSTNAME_WILDCARD");
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split(/[/?#]/, 1)[0] ?? "";
  if (value.includes("@")) return fail("HOSTNAME_INVALID");
  if (value.startsWith("[")) return fail("HOSTNAME_IP");
  value = value.replace(/:\d*$/, "").replace(/\.+$/, "");
  if (!value) return fail("HOSTNAME_EMPTY");
  if (/\s/.test(value)) return fail("HOSTNAME_INVALID");
  if (isIpAddress(value)) return fail("HOSTNAME_IP");

  // Unicode names become punycode, the form DNS and TLS certificates use.
  let ascii: string;
  try {
    ascii = new URL(`http://${value}/`).hostname;
  } catch {
    return fail("HOSTNAME_INVALID");
  }
  if (isIpAddress(ascii)) return fail("HOSTNAME_IP");
  if (ascii.length > 253) return fail("HOSTNAME_TOO_LONG");

  const labels = ascii.split(".");
  if (labels.length < 2) {
    return ascii === "localhost"
      ? fail("HOSTNAME_LOCAL")
      : fail("HOSTNAME_INVALID");
  }
  if (labels.some((label) => !LABEL_RE.test(label))) {
    return fail("HOSTNAME_INVALID");
  }
  if (!TLD_RE.test(labels[labels.length - 1]!)) {
    return fail("HOSTNAME_INVALID");
  }
  if (LOCAL_SUFFIXES.some((suffix) => endsWithSuffix(ascii, suffix))) {
    return fail("HOSTNAME_LOCAL");
  }
  if (endsWithSuffix(ascii, "twyne.love")) return fail("HOSTNAME_TWYNE");
  if (BLOCKED_SUFFIXES.some((suffix) => endsWithSuffix(ascii, suffix))) {
    return fail("HOSTNAME_PROVIDER");
  }
  if (MULTI_LABEL_SUFFIXES.has(ascii)) return fail("HOSTNAME_INVALID");

  const zone = registrableDomain(ascii);
  return {
    ok: true,
    hostname: ascii,
    kind: zone === ascii ? "apex" : "subdomain",
    zone,
  };
}
