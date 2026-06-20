import { creemApiBase } from "../convex/lib/creem";

const apiKey = process.env.CREEM_API_KEY;
const productId = process.env.PUBLIC_CREEM_PRODUCT_PRO;

if (!apiKey) throw new Error("CREEM_API_KEY is required");
if (!productId) throw new Error("PUBLIC_CREEM_PRODUCT_PRO is required");
if (!apiKey.startsWith("creem_test_")) {
  throw new Error("Refusing to run the smoke test with a non-test Creem key");
}

const baseUrl = creemApiBase(apiKey, process.env.CREEM_API_BASE);
const productResponse = await fetch(
  `${baseUrl}/products?product_id=${encodeURIComponent(productId)}`,
  { headers: { "x-api-key": apiKey } },
);
if (!productResponse.ok) {
  throw new Error(
    `Creem product lookup failed (${productResponse.status}): ${await productResponse.text()}`,
  );
}

const product = (await productResponse.json()) as {
  id?: string;
  mode?: string;
  billing_type?: string;
  status?: string;
};
if (product.id !== productId || product.mode !== "test") {
  throw new Error("Configured product does not belong to Creem test mode");
}
if (product.billing_type !== "recurring" || product.status !== "active") {
  throw new Error("Configured product is not an active recurring product");
}

const requestId = `e2e-smoke-${crypto.randomUUID()}`;
const checkoutResponse = await fetch(`${baseUrl}/checkouts`, {
  method: "POST",
  headers: {
    "x-api-key": apiKey,
    "content-type": "application/json",
  },
  body: JSON.stringify({
    product_id: productId,
    request_id: requestId,
    success_url:
      process.env.CREEM_SUCCESS_URL ??
      "https://www.twyne.love/pricing?checkout=success",
    metadata: { userId: requestId, source: "automated-smoke" },
  }),
});
if (!checkoutResponse.ok) {
  throw new Error(
    `Creem checkout creation failed (${checkoutResponse.status}): ${await checkoutResponse.text()}`,
  );
}

const checkout = (await checkoutResponse.json()) as {
  id?: string;
  checkout_url?: string;
  status?: string;
};
const checkoutUrl = new URL(checkout.checkout_url ?? "");
if (!checkout.id || checkout.status !== "pending") {
  throw new Error("Creem did not return a pending checkout");
}
if (!checkoutUrl.hostname.endsWith("creem.io")) {
  throw new Error(`Unexpected checkout host: ${checkoutUrl.hostname}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      mode: product.mode,
      productId,
      checkoutId: checkout.id,
      checkoutHost: checkoutUrl.hostname,
    },
    null,
    2,
  ),
);
