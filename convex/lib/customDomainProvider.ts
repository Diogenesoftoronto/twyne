/**
 * Where writers' custom domains are registered so the edge routes them to
 * Twyne and issues their TLS certificates.
 *
 * Today that is Railway, which serves Twyne. The interface is deliberately
 * small (register, read, unregister) so another host, such as Cloudflare for
 * SaaS custom hostnames, can replace it without touching the lifecycle in
 * `convex/customDomains.ts`.
 *
 * Railway limit: custom domains are counted per service. Pro allows 20 per
 * service by default (raised on request through Railway support); Hobby
 * allows 2. Twyne's own `twyne.love` and `*.twyne.love` already use two of
 * the production service's slots, which is why writers get a fair-use cap and
 * why a large number of writer domains needs a provider built for it.
 */

import { v } from "convex/values";

export type DnsRecordType = "CNAME" | "ALIAS" | "TXT" | "A";
export type DnsRecordPurpose = "traffic" | "verification" | "certificate";

export interface CustomDomainDnsRecord {
  type: DnsRecordType;
  /** Name relative to the zone, as most DNS hosts ask for it. "@" is the bare domain. */
  name: string;
  fqdn: string;
  value: string;
  purpose: DnsRecordPurpose;
  /** Provider's view: true when it sees the required value. */
  ready: boolean;
}

/** Stored on `customDomains.dnsRecords`; mirrors `CustomDomainDnsRecord`. */
export const customDomainDnsRecordValidator = v.object({
  type: v.union(
    v.literal("CNAME"),
    v.literal("ALIAS"),
    v.literal("TXT"),
    v.literal("A"),
  ),
  name: v.string(),
  fqdn: v.string(),
  value: v.string(),
  purpose: v.union(
    v.literal("traffic"),
    v.literal("verification"),
    v.literal("certificate"),
  ),
  ready: v.boolean(),
});

export const providerDomainStateValidator = v.object({
  id: v.string(),
  hostname: v.string(),
  zone: v.union(v.string(), v.null()),
  apex: v.union(v.boolean(), v.null()),
  records: v.array(customDomainDnsRecordValidator),
  verified: v.boolean(),
  certificate: v.union(
    v.literal("pending"),
    v.literal("issuing"),
    v.literal("valid"),
    v.literal("failed"),
  ),
  certificateError: v.union(v.string(), v.null()),
  certificateRetryable: v.boolean(),
});

export type CertificateState = "pending" | "issuing" | "valid" | "failed";

export interface ProviderDomainState {
  id: string;
  hostname: string;
  /** The DNS zone the records live in, when the provider reports it. */
  zone: string | null;
  apex: boolean | null;
  records: CustomDomainDnsRecord[];
  /** Ownership verified (the TXT record, for Railway). */
  verified: boolean;
  certificate: CertificateState;
  certificateError: string | null;
  certificateRetryable: boolean;
}

export interface CustomDomainProvider {
  readonly name: "railway";
  register(hostname: string): Promise<ProviderDomainState>;
  /** Null when the provider no longer has the domain. */
  get(id: string): Promise<ProviderDomainState | null>;
  unregister(id: string): Promise<void>;
}

export class CustomDomainProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "CustomDomainProviderError";
  }
}

/* ── Railway ──────────────────────────────────────────────────────── */

export interface RailwayConfig {
  /** Project token scoped to one environment (preferred), sent as Project-Access-Token. */
  projectToken?: string;
  /** Account or team token, sent as a bearer token. */
  apiToken?: string;
  projectId: string;
  environmentId: string;
  serviceId: string;
  endpoint?: string;
}

const RAILWAY_ENDPOINT = "https://backboard.railway.com/graphql/v2";

const DOMAIN_FIELDS = `
  id
  domain
  status {
    verified
    verificationDnsHost
    verificationToken
    certificateStatus
    certificateErrorMessage
    certificateRetryable
    dnsRecords {
      hostlabel
      fqdn
      zone
      recordType
      requiredValue
      currentValue
      status
      purpose
    }
  }
`;

interface RailwayDnsRecord {
  hostlabel: string;
  fqdn: string;
  zone: string;
  recordType: string;
  requiredValue: string;
  currentValue: string;
  status: string;
  purpose: string;
}

interface RailwayCustomDomain {
  id: string;
  domain: string;
  status: {
    verified: boolean;
    verificationDnsHost: string | null;
    verificationToken: string | null;
    certificateStatus: string;
    certificateErrorMessage: string | null;
    certificateRetryable: boolean | null;
    dnsRecords: RailwayDnsRecord[];
  };
}

/** Read Railway settings from the Convex deployment's environment. */
export function railwayConfigFromEnv(
  env: Record<string, string | undefined>,
): RailwayConfig | null {
  const projectToken = env.CUSTOM_DOMAINS_RAILWAY_PROJECT_TOKEN?.trim();
  const apiToken = env.CUSTOM_DOMAINS_RAILWAY_API_TOKEN?.trim();
  const projectId = env.CUSTOM_DOMAINS_RAILWAY_PROJECT_ID?.trim();
  const environmentId = env.CUSTOM_DOMAINS_RAILWAY_ENVIRONMENT_ID?.trim();
  const serviceId = env.CUSTOM_DOMAINS_RAILWAY_SERVICE_ID?.trim();
  if (!(projectToken || apiToken) || !projectId || !environmentId || !serviceId)
    return null;
  return { projectToken, apiToken, projectId, environmentId, serviceId };
}

function isApexLabel(label: string): boolean {
  return label === "" || label === "@";
}

/** Map Railway's answer onto the provider-neutral shape. */
export function mapRailwayDomain(
  domain: RailwayCustomDomain,
): ProviderDomainState {
  const records: CustomDomainDnsRecord[] = [];
  let zone: string | null = null;
  let apex: boolean | null = null;

  for (const record of domain.status.dnsRecords) {
    zone ??= record.zone || null;
    const type = record.recordType.replace("DNS_RECORD_TYPE_", "");
    const purpose: DnsRecordPurpose =
      record.purpose === "DNS_RECORD_PURPOSE_ACME_DNS01_CHALLENGE"
        ? "certificate"
        : "traffic";
    const bare = isApexLabel(record.hostlabel);
    if (purpose === "traffic") apex = bare;
    records.push({
      // Railway asks for a CNAME at the bare domain; DNS hosts call that
      // ALIAS, ANAME or a flattened CNAME.
      type:
        type === "CNAME" && bare
          ? "ALIAS"
          : type === "TXT" || type === "A"
            ? type
            : "CNAME",
      name: bare ? "@" : record.hostlabel,
      fqdn: record.fqdn,
      value: record.requiredValue,
      purpose,
      ready: record.status === "DNS_RECORD_STATUS_PROPAGATED",
    });
  }

  const host = domain.status.verificationDnsHost;
  const token = domain.status.verificationToken;
  if (host && token) {
    // Railway reports the host relative to the zone (`_railway-verify.pages`).
    const suffix = zone ? `.${zone}` : null;
    const absolute = suffix !== null && host.endsWith(suffix);
    records.push({
      type: "TXT",
      name: absolute ? host.slice(0, -suffix.length) : host,
      fqdn: absolute || zone === null ? host : `${host}.${zone}`,
      value: token,
      purpose: "verification",
      ready: domain.status.verified,
    });
  }

  const certificateStatus = domain.status.certificateStatus;
  const certificate: CertificateState =
    certificateStatus === "CERTIFICATE_STATUS_TYPE_VALID"
      ? "valid"
      : certificateStatus === "CERTIFICATE_STATUS_TYPE_ISSUE_FAILED"
        ? "failed"
        : certificateStatus === "CERTIFICATE_STATUS_TYPE_ISSUING" ||
            certificateStatus ===
              "CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP"
          ? "issuing"
          : "pending";

  return {
    id: domain.id,
    hostname: domain.domain,
    zone,
    apex,
    records,
    verified: domain.status.verified,
    certificate,
    certificateError: domain.status.certificateErrorMessage || null,
    certificateRetryable: domain.status.certificateRetryable !== false,
  };
}

export function createRailwayProvider(
  config: RailwayConfig,
  fetchImpl: typeof fetch = fetch,
): CustomDomainProvider {
  async function request<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.projectToken) {
      headers["Project-Access-Token"] = config.projectToken;
    } else if (config.apiToken) {
      headers.Authorization = `Bearer ${config.apiToken}`;
    }
    let response: Response;
    try {
      response = await fetchImpl(config.endpoint ?? RAILWAY_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      throw new CustomDomainProviderError(
        `Couldn't reach Railway: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    }
    const body = (await response.json().catch(() => null)) as {
      data?: T;
      errors?: Array<{ message: string }>;
    } | null;
    if (body?.errors?.length) {
      throw new CustomDomainProviderError(
        body.errors.map((error) => error.message).join("; "),
        response.status >= 500 || response.status === 429,
      );
    }
    if (!response.ok || !body?.data) {
      throw new CustomDomainProviderError(
        `Railway answered HTTP ${response.status}`,
        response.status >= 500 || response.status === 429,
      );
    }
    return body.data;
  }

  /** The service's existing registration for a hostname, if any. */
  async function findOnService(
    hostname: string,
  ): Promise<RailwayCustomDomain | null> {
    const data = await request<{
      domains: { customDomains: RailwayCustomDomain[] };
    }>(
      `query ServiceDomains($projectId: String!, $environmentId: String!, $serviceId: String!) {
        domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
          customDomains { ${DOMAIN_FIELDS} }
        }
      }`,
      {
        projectId: config.projectId,
        environmentId: config.environmentId,
        serviceId: config.serviceId,
      },
    );
    return (
      data.domains.customDomains.find(
        (domain) => domain.domain.toLowerCase() === hostname,
      ) ?? null
    );
  }

  return {
    name: "railway",
    async register(hostname) {
      try {
        const data = await request<{
          customDomainCreate: RailwayCustomDomain;
        }>(
          `mutation CreateCustomDomain($input: CustomDomainCreateInput!) {
            customDomainCreate(input: $input) { ${DOMAIN_FIELDS} }
          }`,
          {
            input: {
              domain: hostname,
              projectId: config.projectId,
              environmentId: config.environmentId,
              serviceId: config.serviceId,
            },
          },
        );
        return mapRailwayDomain(data.customDomainCreate);
      } catch (error) {
        // A retry after a lost response, or a re-claim of a domain this
        // service still has: adopt the registration instead of failing.
        const existing = await findOnService(hostname).catch(() => null);
        if (existing) return mapRailwayDomain(existing);
        throw error;
      }
    },
    async get(id) {
      try {
        const data = await request<{ customDomain: RailwayCustomDomain }>(
          `query CustomDomain($id: String!, $projectId: String!) {
            customDomain(id: $id, projectId: $projectId) { ${DOMAIN_FIELDS} }
          }`,
          { id, projectId: config.projectId },
        );
        return mapRailwayDomain(data.customDomain);
      } catch (error) {
        if (
          error instanceof CustomDomainProviderError &&
          /not found|does not exist/i.test(error.message)
        ) {
          return null;
        }
        throw error;
      }
    },
    async unregister(id) {
      try {
        await request<{ customDomainDelete: boolean }>(
          `mutation DeleteCustomDomain($id: String!) {
            customDomainDelete(id: $id)
          }`,
          { id },
        );
      } catch (error) {
        if (
          error instanceof CustomDomainProviderError &&
          /not found|does not exist/i.test(error.message)
        ) {
          return;
        }
        throw error;
      }
    },
  };
}

/** The configured provider, or null when this deployment has none. */
export function customDomainProviderFromEnv(
  env: Record<string, string | undefined>,
): CustomDomainProvider | null {
  const railway = railwayConfigFromEnv(env);
  return railway ? createRailwayProvider(railway) : null;
}
