# Twyne pricing: new subscriptions

The new plan is `twyne_pro_v2`: USD 29/month before tax, with USD 10 in monthly retail Not Organic service credit. Unused included credit rolls over for one billing cycle. Top-ups are optional. Custom training and hosted voice are not part of this plan. BYOK and supported local writing remain available without this subscription.

The previous USD 12 checkout is no longer the entry point for new sales. Existing legacy subscriptions, webhook handling, prices and entitlements are unchanged. The new plan is a hosted editorial AI wallet plan; it does not grant legacy-only voice, research, collaboration or priority features.

## Activation

New checkout is disabled by default. Before enabling:

1. Deploy and map the provider plan `twyne_pro_v2` to the USD 29 monthly payment price and USD 10 grant; verify payment webhook and renewal/rollover behavior.
2. Deploy the Not Organic `/v1/wallet` product-scoped `subscriptions` summary, which supplies plan, product, status and billing period timestamps in milliseconds.
3. Verify linked account access, server-held assertion signing and `NOTORGANIC_ENABLED=true` inference with actual wallet debits. Missing identity or token exchange errors must stop the hosted path instead of spending legacy server-provider funds.
4. Set server `NOTORGANIC_TWYNE_PRO_V2_ENABLED=true` and build frontend with `PUBLIC_NOTORGANIC_TWYNE_PRO_V2_ENABLED=true`. Both gates must be enabled; unmapped provider checkout still rejects the purchase.
5. Verify signed-in checkout and confirmed wallet status. A return URL never grants paid status. Check BYOK/local and existing legacy subscribers separately.

New subscription UI intentionally excludes legacy-only feature promises. Payment provider configuration and real purchase verification are deployment boundaries, not inferred from source tests.

## One-time credit packs

Free accounts can buy `twyne_credit_10`, `twyne_credit_25` or `twyne_credit_50` through the same authenticated checkout action using `pack_id`, independently of Pro. No recurring payment or premium entitlement is created. Hosted editorial requests already use the linked account wallet without a Pro check; legacy voice, research and collaboration gates are unchanged.

Credit packs use the existing server `NOTORGANIC_ENABLED=true` gate, independently of the Pro subscription flags. The pricing page also requires `checkout.available=true` and each pack in authenticated wallet `checkout.packIds`; it never enables an unmapped amount based on a UI constant. Keep the Pro gates disabled if only one-time purchases are ready.
