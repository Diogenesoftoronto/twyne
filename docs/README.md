# Twyne documentation

A guide to using the writing room, understanding its data, and maintaining the app.

**For writers:** open [The Manual](https://www.twyne.love/docs/) in Twyne. It covers
the desk, the House, conversations in the margin, source and proof, and shortcuts.
Numbered visual walkthroughs show the actual controls, with editor illustrations
and optional films at the beginning of relevant chapters. The contents panel
follows your current chapter and shows your reading position as you scroll.

**For contributors:** start with the [project README](../README.md#development),
then follow the guide for the part you are changing.

## The writing room

| Guide                                                 | Use it for                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [The House and the fluid desk](flow-and-context.md)   | Context inheritance, focus, margin conversations and their storage contract.        |
| [Live voice](live-voice.md)                           | Voice sessions, the relay and conversation limits.                                  |
| [Publishing from Twyne](publishing-from-twyne.md)     | Writer-owned PDS publishing and public reading pages.                               |
| [Not Organic identity](notorganic-native-identity.md) | The account boundary and native sign-in design.                                     |
| [Launch film](launch-film.md)                         | The bilingual introduction, contextual chapter films and visual walkthrough assets. |

## Running and maintaining Twyne

| Guide                                                       | Use it for                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------- |
| [Deployment](DEPLOYMENT.md)                                 | Railway, environment variables, domains and the desktop build. |
| [Data and sync architecture](architecture/data-and-sync.md) | The recorded storage/sync architecture and its dated findings. |
| [Internationalisation](i18n.md)                             | Locale selection, translation and preparation commands.        |
| [AI observability](ai-observability.md)                     | Traces, experiments and editorial evaluation.                  |
| [Popmelt integration](popmelt.md)                           | The recorded capture and interaction integration.              |

## Design and implementation records

These describe intent and implementation history. A plan is not evidence that a
feature is deployed or that its provider integration has been exercised.

| Record                                                                                                                        | Subject                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [Native Typst plan](typst-native-editor-plan.md) · [execution record](typst-native-editor-execution.md)                       | Source editing, proof and migration.         |
| [Editorial drafting brief](editorial-drafting-context-brief.md) · [parallel build graph](editor-parallel-build-graph.md)      | Context and editor implementation.           |
| [My Desk specification](my-desk-usage-profile-spec.md)                                                                        | Usage and profile design.                    |
| [Dossier UX changes](changes/dossier-ux-cleanup.md)                                                                           | The recorded refinement of the dossier flow. |
| [Local models plan](local-models-plan.md)                                                                                     | Local model integration.                     |
| [Pricing rollout](pricing-rollout.md)                                                                                         | The recorded pricing proposal and rollout.   |
| [Translation plan](gt-qwik-plan.md) · [authoring brief](gt-qwik-authoring-brief.md) · [verification](gt-qwik-verification.md) | Qwik translation work and its checks.        |

## Artwork and presentation

- [The illustrated manual](manual-visuals.md): component captures, walkthroughs,
  cast portraits and accessible reading/playback.
- [Illuminated initials](illuminated-initials-artwork.md)
- [Social preview artwork](social-preview-artwork.md) and [options](social-preview-options.md)
- [Sunburst stamps](assets/sunburst-stamps.md)
- [Growth strategy](growth-strategy.md)

When updating a guide, describe the current behavior, keep commands copyable,
and distinguish local tests, browser fixtures and real authenticated integration
evidence. Dates and verification boundaries belong with the evidence they qualify.
