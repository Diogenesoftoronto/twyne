---
twyne: minor
---

Twyne 0.13 turns the writing desk into a place you can inspect, recover, and
extend without giving up its local-first center.

**Your draft has a memory.** Revision checkpoints give you named moments to
return to, while the privacy ledger makes the boundary between local, synced,
published, and provider-bound data visible. Account recovery and collaboration
invitations now preserve the work in front of you when authentication or
delivery needs attention instead of presenting a success-looking dead end.

**Research becomes something you can arrange.** The apparatus gains a source
canvas for laying out evidence and relationships, including streamed OpenUI
cards and inspectors. Sources can be extracted from documents, reached through
configured MCP research servers, and carried through the dossier and apparatus
without flattening them into an anonymous block of text.

**Local AI is a real route, not a checkbox.** Browser models can be discovered,
downloaded, cached, and used from the same generation path as remote providers.
Reasoning, errors, model availability, and recovery remain visible, and voice
playback now has a queue with next, previous, and replay controls rather than a
single fire-and-forget utterance.

**The manuscript travels more faithfully.** DOCX import and export join the
existing readable formats, inline notes survive exchange, and folio state,
editor preferences, revisions, and collaboration data move through a hardened
local-to-Convex sync path with stricter identity ownership and conflict handling.

**The toolchain opens up.** The Twyne CLI package adds Codex and Anthropic SDK
adapters that reuse each provider's official local sign-in, while prompts move
into reviewable files with regression tests and an opt-in optimization harness.
The distinction stays explicit: Twyne credentials authorize Twyne, and provider
credentials stay on their provider's native transport.

This is a broad new product surface, so it ships as a minor release.
