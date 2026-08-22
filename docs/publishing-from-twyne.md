# Publishing from Twyne

Twyne offers three separate ways to make a folio public. Choose the one that
matches where you want the finished piece to live.

## 1. Publish on Twyne

Use this for the quickest public link hosted by Twyne.

1. Open the folio you want to publish.
2. Open the **File** menu in the editor toolbar, then open **Share**.
3. Press **Publish now**.
4. Copy the resulting link or open the public reading view.

Anyone with that link can read the piece but cannot edit it. Press
**Unpublish** in the same panel to take the Twyne-hosted page down. This option
requires a Twyne email or passkey account; it is not available in a Bluesky
session. A regular writer publishes a shareable post under their claimed
writer handle. A Twyne blog administrator publishes to the main `/blog` feed;
non-administrators cannot publish to that feed.

## 2. Publish to your ATProto PDS (Bluesky)

Use this when your own ATProto repository should be the source of truth.

1. Sign in to Twyne with Bluesky or another ATProto provider that supports
   OAuth.
2. Open the folio, then **File** > **Share**.
3. In **Your own repo**, press **Publish to your PDS**.
4. Copy the record URI, open its reading view, or inspect the ATProto record.

Twyne creates or reuses a `site.standard.publication` record and files the
folio as a `site.standard.document` with its Markdown content. **Re-publish
(update)** updates the same PDS document record; **Unpublish from PDS** deletes
that document from your PDS. Twyne keeps the record key locally only so it can
update or remove the correct record later.

## 3. Publish to an existing Micropub site

Use this only if you already operate a site with a Micropub endpoint.

1. Open **File** > **Share** and find the Micropub section.
2. Enter your HTTPS Micropub endpoint and an access token.
3. Publish the folio.

Twyne sends the title and article HTML to that endpoint as a published
Micropub entry. The access token is used for that request and is not retained
by Twyne.

## Relationship to Keating

Twyne's PDS publishing uses the same Standard.site document format that
Keating reads, but it creates or reuses the writer's *Twyne* publication. It
does not automatically add a post to Keating's configured publication. To put
the same work in Keating, create or update a `site.standard.document` in the
ATProto repository configured for Keating, point its `site` field at Keating's
`site.standard.publication` record, and use a path such as `/blog/my-post`.
See the Keating guide for the one-time publication setup and its environment
configuration.
