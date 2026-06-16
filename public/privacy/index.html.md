# Privacy Policy

> What Twyne stores, where it lives, and who can see it.
> Last updated: 15 June 2026.

This policy explains how Twyne handles information when you use the writing
desk, sync, hosted AI, publishing, analytics, and payments. It is written
for clarity; if any feature says it will send data to a third party, the
sections below explain when and why.

## Local-first by default

Twyne is designed to keep your writing on your own device. Your brief,
folios, drafts, persona notes, and settings are stored in your browser's
IndexedDB. If you never sign in, this data does not leave your machine
through Twyne.

Browser storage is controlled by the browser profile and device where you
use Twyne. Clearing site data, using private browsing, resetting the app,
or losing access to that device may remove local-only work, so you should
export important folios or enable sync if you want a backup.

## When you sign in

Creating an account and signing in enables sync: your folios and related
data are sent to our backend so you can access them on other devices. We
store this data to provide the sync feature and associate it with your
account identifier. You can delete it by deleting your account or clearing
your synced data.

Synced data may include your projects, briefs, folios, comments, citations,
persona settings, publishing state, timestamps, and other records needed to
keep the writing workspace consistent across devices. We do not sell your
synced writing or use it to train general-purpose AI models.

## Authentication

We support passkeys, one-time email codes, and Bluesky / ATProto sign-in. We
store the minimum identifiers needed to authenticate you and maintain your
session. For Bluesky sign-in, authentication is handled through ATProto
OAuth with your chosen provider.

Depending on how you sign in, authentication records may include your email
address, display name, account id, passkey credential metadata, session
tokens, verification-code state, ATProto handle, and OAuth tokens or token
identifiers. These records are used for login, account security, sync,
publishing, and support.

## AI providers and your API keys

When you use AI features with your own key (BYOK), your key is stored
locally in your browser and is used to send requests directly to the AI
provider you chose. Those requests, including the text you send for review,
are processed by that third-party provider under their privacy policy. We
do not need your API key to be stored on our servers.

If you use hosted AI instead of BYOK, the prompt, relevant draft text,
brief, selected persona, and AI response are processed through Twyne's
backend and the configured model provider. Hosted AI requests may also be
recorded as AI observability events so we can debug failures, evaluate
output quality, and understand cost and latency. These events may include
truncated prompt and response text.

In the desktop app, local model features may run through a loopback service
on your own computer when available. In that mode, the local model provider
is managed by the desktop shell and does not require a cloud API key.

## Analytics

We may use PostHog or similar product analytics to understand how Twyne is
used, roll out feature flags, find errors, measure performance, and improve
the product. Analytics may collect page views, feature usage, device and
browser information, approximate location derived from network data, account
identifiers for signed-in users, and event properties.

Twyne does not use product analytics to sell your writing. Some AI
observability events may include prompt and output text as described above;
ordinary page and feature events should not require draft contents. You can
limit analytics through browser settings, content blockers, or any controls
provided in the app.

## Publishing

If you choose to publish a draft (for example to your ATProto / Bluesky
PDS), that content becomes available according to the network you publish
to. Published content may be cached or indexed by third parties even after
you remove it.

For internal reading links or public share views, Twyne stores the
published state and the content needed to render the shared view until you
unpublish or delete it. Anyone with access to a public link may copy or
redistribute what they can read.

## Payments

If paid plans are available and you subscribe, checkout and payment
processing are handled by Creem or another payment processor. Twyne sends
the information needed to create checkout, such as your account identifier,
product id, and, when available, email address. We store subscription
status, product identifiers, payment-provider customer and subscription
ids, current period information, and related webhook data needed to grant
or revoke paid features.

## Your controls

- Export any folio (Markdown, HTML, text, or a `.twyne.json` backup).
- Clear local data from your browser at any time.
- Delete your account and synced data if you signed in.
- Remove saved AI providers and API keys from Settings.
- Unpublish shared or ATProto-published content where supported.
- Use Twyne entirely offline and local-only by not signing in.

## Security and retention

We use reasonable technical and organizational measures to protect the data
Twyne stores, including provider-managed infrastructure, access controls,
and webhook signature verification for payment events. No system can be
guaranteed perfectly secure. You are responsible for securing your own
device, browser profile, account credentials, passkeys, and third-party API
keys.

We keep account, sync, subscription, and operational records for as long as
needed to provide Twyne, meet legal or security obligations, resolve
disputes, and maintain backups. Local-only browser data remains on your
device until you delete it or your browser removes it.

## Third-party services

Twyne relies on third-party services for infrastructure, authentication, AI
providers, ATProto publishing, analytics, and payments. Those services
process information under their own terms and privacy policies when you use
the related feature. Examples include Convex and Better Auth for
backend/auth flows, AI providers such as Anthropic, OpenAI, Google, Rivet,
or OpenAI-compatible providers, PostHog for analytics and feature flags,
ATProto services for Bluesky sign-in or publishing, and Creem for paid
checkout.

## Changes

We may update this policy from time to time; the "last updated" date above
reflects the latest revision. If a change materially affects how we handle
your data, we will take reasonable steps to make the change visible in the
product or on this page.

## Contact

Questions about privacy can be sent to
[support@twyne.love](mailto:support@twyne.love).
