/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  createRailwayProvider,
  mapRailwayDomain,
  type ProviderDomainState,
} from "./lib/customDomainProvider";
import { GIVE_UP_AFTER_MS, statusFromProvider } from "./customDomains";

const supportsViteModules = typeof import.meta.glob === "function";
const modules = supportsViteModules ? import.meta.glob("./**/*.ts") : {};
const describeConvex = supportsViteModules ? describe : describe.skip;

async function setup() {
  const t = convexTest(schema, modules);
  const writer = t.withIdentity({ tokenIdentifier: "issuer|writer" });
  const other = t.withIdentity({ tokenIdentifier: "issuer|other" });
  await writer.mutation(api.profiles.claimHandle, { handle: "mara" });
  await other.mutation(api.profiles.claimHandle, { handle: "oskar" });
  return { t, writer, other };
}

function providerState(
  overrides: Partial<ProviderDomainState> = {},
): ProviderDomainState {
  return {
    id: "rw-domain-1",
    hostname: "pages.myfrens.us",
    zone: "myfrens.us",
    apex: false,
    records: [
      {
        type: "CNAME",
        name: "pages",
        fqdn: "pages.myfrens.us",
        value: "abc123.up.railway.app",
        purpose: "traffic",
        ready: false,
      },
      {
        type: "TXT",
        name: "_railway-verify.pages",
        fqdn: "_railway-verify.pages.myfrens.us",
        value: "railway-verify=token",
        purpose: "verification",
        ready: false,
      },
    ],
    verified: false,
    certificate: "pending",
    certificateError: null,
    certificateRetryable: true,
    ...overrides,
  };
}

const ready = (state: ProviderDomainState) => ({
  ...state,
  records: state.records.map((record) => ({ ...record, ready: true })),
  verified: true,
});

describeConvex("custom domain rules", () => {
  test("every write needs a signed-in writer", async () => {
    const { t, writer } = await setup();
    await expect(
      t.mutation(api.customDomains.add, { hostname: "myfrens.us" }),
    ).rejects.toThrow(/Sign in/);
    const { id } = await writer.mutation(api.customDomains.add, {
      hostname: "myfrens.us",
    });
    await expect(
      t.mutation(api.customDomains.recheck, { domainId: id }),
    ).rejects.toThrow(/Sign in/);
    await expect(
      t.mutation(api.customDomains.remove, { domainId: id }),
    ).rejects.toThrow(/Sign in/);
    expect(await t.query(api.customDomains.listMine, {})).toEqual([]);
  });

  test("adds a normalized domain for the writer's handle", async () => {
    const { writer } = await setup();
    const { hostname } = await writer.mutation(api.customDomains.add, {
      hostname: "https://Pages.MyFrens.us/",
    });
    expect(hostname).toBe("pages.myfrens.us");
    const [row] = await writer.query(api.customDomains.listMine, {});
    expect(row).toMatchObject({
      hostname: "pages.myfrens.us",
      kind: "subdomain",
      handle: "mara",
      status: "pending_dns",
      registered: false,
    });
  });

  test("rejects reserved and malformed names", async () => {
    const { writer } = await setup();
    for (const hostname of [
      "twyne.love",
      "mara.twyne.love",
      "x.up.railway.app",
      "10.0.0.1",
      "localhost",
      "not a domain",
    ]) {
      await expect(
        writer.mutation(api.customDomains.add, { hostname }),
      ).rejects.toThrow();
    }
  });

  test("a writer without a Twyne address can't add a domain", async () => {
    const { t } = await setup();
    const newcomer = t.withIdentity({ tokenIdentifier: "issuer|newcomer" });
    await expect(
      newcomer.mutation(api.customDomains.add, { hostname: "myfrens.us" }),
    ).rejects.toThrow(/Claim your Twyne address/);
  });

  test("a domain can't point at someone else's handle", async () => {
    const { writer } = await setup();
    await expect(
      writer.mutation(api.customDomains.add, {
        hostname: "myfrens.us",
        handle: "oskar",
      }),
    ).rejects.toThrow(/isn't yours/);
  });

  test("two writers can't claim one hostname", async () => {
    const { writer, other } = await setup();
    const first = await writer.mutation(api.customDomains.add, {
      hostname: "myfrens.us",
    });
    await expect(
      other.mutation(api.customDomains.add, { hostname: "MYFRENS.US." }),
    ).rejects.toThrow(/Another Twyne writer/);
    // The same writer adding it again gets the existing row.
    expect(
      (await writer.mutation(api.customDomains.add, { hostname: "myfrens.us" }))
        .id,
    ).toBe(first.id);
  });

  test("a failed claim doesn't hold the name; a removed one frees it", async () => {
    const { t, writer, other } = await setup();
    const { id } = await writer.mutation(api.customDomains.add, {
      hostname: "myfrens.us",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("customDomains", id, { status: "failed" });
    });
    const takeover = await other.mutation(api.customDomains.add, {
      hostname: "myfrens.us",
    });
    expect(takeover.id).toBe(id);
    expect(await writer.query(api.customDomains.listMine, {})).toEqual([]);

    await other.mutation(api.customDomains.remove, { domainId: id });
    expect(
      (await writer.mutation(api.customDomains.add, { hostname: "myfrens.us" }))
        .id,
    ).toBe(id);
  });

  test("fair-use cap of three domains", async () => {
    const { writer } = await setup();
    for (const hostname of ["a.example.com", "b.example.com", "c.example.com"])
      await writer.mutation(api.customDomains.add, { hostname });
    await expect(
      writer.mutation(api.customDomains.add, { hostname: "d.example.com" }),
    ).rejects.toThrow(/up to 3 domains/);
  });

  test("only the owner can check or remove a domain", async () => {
    const { writer, other } = await setup();
    const { id } = await writer.mutation(api.customDomains.add, {
      hostname: "myfrens.us",
    });
    await expect(
      other.mutation(api.customDomains.recheck, { domainId: id }),
    ).rejects.toThrow(/isn't on your account/);
    await expect(
      other.mutation(api.customDomains.remove, { domainId: id }),
    ).rejects.toThrow(/isn't on your account/);
    await writer.mutation(api.customDomains.recheck, { domainId: id });
    await writer.mutation(api.customDomains.remove, { domainId: id });
    expect(await writer.query(api.customDomains.listMine, {})).toEqual([]);
  });

  test("resolves a hostname only while the domain is active", async () => {
    const { t, writer } = await setup();
    const { id } = await writer.mutation(api.customDomains.add, {
      hostname: "pages.myfrens.us",
    });
    const resolve = () =>
      t.query(api.customDomains.resolveHost, {
        hostname: "Pages.MyFrens.us:443",
      });
    expect(await resolve()).toBeNull();

    await t.mutation(internal.customDomains.recordProviderState, {
      domainId: id,
      state: providerState(),
    });
    let [row] = await writer.query(api.customDomains.listMine, {});
    expect(row).toMatchObject({ status: "pending_dns", registered: true });
    expect(row!.dnsRecords.map((record) => record.type)).toEqual([
      "CNAME",
      "TXT",
    ]);
    expect(await resolve()).toBeNull();

    await t.mutation(internal.customDomains.recordProviderState, {
      domainId: id,
      state: ready(providerState({ certificate: "issuing" })),
    });
    [row] = await writer.query(api.customDomains.listMine, {});
    expect(row!.status).toBe("issuing_certificate");
    expect(await resolve()).toBeNull();

    await t.mutation(internal.customDomains.recordProviderState, {
      domainId: id,
      state: ready(providerState({ certificate: "valid" })),
    });
    [row] = await writer.query(api.customDomains.listMine, {});
    expect(row!.status).toBe("active");
    expect(row!.activatedAt).not.toBeNull();
    expect(await resolve()).toEqual({ handle: "mara" });

    await writer.mutation(api.customDomains.remove, { domainId: id });
    expect(await resolve()).toBeNull();
  });

  test("the provider's zone corrects the domain kind", async () => {
    const { t, writer } = await setup();
    const { id } = await writer.mutation(api.customDomains.add, {
      hostname: "example.gov.ac",
    });
    await t.mutation(internal.customDomains.recordProviderState, {
      domainId: id,
      state: providerState({ hostname: "example.gov.ac", apex: true }),
    });
    const [row] = await writer.query(api.customDomains.listMine, {});
    expect(row!.kind).toBe("apex");
  });

  test("waiting gives up after 72 hours", async () => {
    vi.useFakeTimers();
    try {
      const { t, writer } = await setup();
      const { id } = await writer.mutation(api.customDomains.add, {
        hostname: "myfrens.us",
      });
      vi.setSystemTime(Date.now() + GIVE_UP_AFTER_MS + 1);
      await t.mutation(internal.customDomains.recordProviderState, {
        domainId: id,
        state: providerState(),
      });
      const [row] = await writer.query(api.customDomains.listMine, {});
      expect(row).toMatchObject({ status: "failed" });
      expect(row!.lastError).toMatch(/weren't found within 3 days/);
      // Checking again starts a new wait.
      await writer.mutation(api.customDomains.recheck, { domainId: id });
      const [again] = await writer.query(api.customDomains.listMine, {});
      expect(again!.status).toBe("pending_dns");
    } finally {
      vi.useRealTimers();
    }
  });

  test("a registration that lands after removal is cleaned up", async () => {
    const { t, writer } = await setup();
    const { id } = await writer.mutation(api.customDomains.add, {
      hostname: "myfrens.us",
    });
    await writer.mutation(api.customDomains.remove, { domainId: id });
    await t.mutation(internal.customDomains.recordProviderState, {
      domainId: id,
      state: providerState(),
    });
    const row = await t.run((ctx) => ctx.db.get("customDomains", id));
    expect(row).toMatchObject({
      status: "removed",
      providerDomainId: "rw-domain-1",
    });
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled.map((job) => job.name)).toContain(
      "customDomainsSync:unregister",
    );
  });
});

describe("provider mapping", () => {
  const railway = {
    id: "d1",
    domain: "myfrens.us",
    status: {
      verified: false,
      verificationDnsHost: "_railway-verify",
      verificationToken: "railway-verify=abc",
      certificateStatus: "CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP",
      certificateErrorMessage: null,
      certificateRetryable: true,
      dnsRecords: [
        {
          hostlabel: "",
          fqdn: "myfrens.us",
          zone: "myfrens.us",
          recordType: "DNS_RECORD_TYPE_CNAME",
          requiredValue: "xyz.up.railway.app",
          currentValue: "",
          status: "DNS_RECORD_STATUS_REQUIRES_UPDATE",
          purpose: "DNS_RECORD_PURPOSE_TRAFFIC_ROUTE",
        },
      ],
    },
  };

  test("a bare-domain CNAME is shown as ALIAS, with the TXT record", () => {
    const state = mapRailwayDomain(railway);
    expect(state).toMatchObject({ apex: true, zone: "myfrens.us" });
    expect(state.records).toEqual([
      {
        type: "ALIAS",
        name: "@",
        fqdn: "myfrens.us",
        value: "xyz.up.railway.app",
        purpose: "traffic",
        ready: false,
      },
      {
        type: "TXT",
        name: "_railway-verify",
        fqdn: "_railway-verify.myfrens.us",
        value: "railway-verify=abc",
        purpose: "verification",
        ready: false,
      },
    ]);
    expect(state.certificate).toBe("issuing");
    expect(statusFromProvider(state).status).toBe("pending_dns");
  });

  test("certificate states map onto the lifecycle", () => {
    expect(statusFromProvider(ready(providerState())).status).toBe(
      "issuing_certificate",
    );
    expect(
      statusFromProvider(providerState({ certificate: "valid" })).status,
    ).toBe("active");
    expect(
      statusFromProvider(
        providerState({
          certificate: "failed",
          certificateRetryable: false,
          certificateError: "CAA forbids",
        }),
      ),
    ).toEqual({ status: "failed", error: "CAA forbids" });
  });

  test("registration adopts a domain the service already has", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string };
      calls.push(body.query.includes("customDomainCreate") ? "create" : "list");
      if (body.query.includes("customDomainCreate")) {
        return Response.json({ errors: [{ message: "Domain already exists" }] });
      }
      return Response.json({
        data: { domains: { customDomains: [railway] } },
      });
    }) as unknown as typeof fetch;
    const provider = createRailwayProvider(
      {
        projectToken: "t",
        projectId: "p",
        environmentId: "e",
        serviceId: "s",
      },
      fetchImpl,
    );
    expect((await provider.register("myfrens.us")).id).toBe("d1");
    expect(calls).toEqual(["create", "list"]);
  });
});
