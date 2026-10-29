# Comments and passage connections — design reference

Reference material only. These files do not implement or enable application changes.

- [Design specification](specification.md) — full specification with all 12 concepts linked to bundled local PNGs.
- [Original Page snapshot](source-page.md) — unchanged source Markdown, retaining the original image references.
- [Source asset inventory](source-assets.json) — exact source references, byte sizes, dimensions and SHA-256 checksums.
- [Original Page](https://chatgpt.com/space/page_b836188445fc8191a0fabf4c9add44b3).
- [Checksums](SHA256SUMS) — checksums for the specification, snapshot, index, inventory, ZIP and all images.

## Import and verification

Imported from source Page sequence 4 on 2026-10-27. The initial Library materialization route could not provide downloads; an independently authorized Page-reference read supplied all 12 original PNGs. Every local PNG matches the byte size and SHA-256 returned by that read. All 12 decode successfully and their pixels were inspected in a contact sheet.

The ZIP is newly assembled from these verified originals; it is not the older generated ZIP. Its integrity was checked, its 12 entries match the local images byte-for-byte, and the archived PNGs are unchanged.

These are proposed designs using synthetic content, not screenshots of implemented fixes. The ten portrait-led proposals supersede the small-avatar treatment in the first two concepts, which remain for comparison. No portraits or concepts were regenerated.

## Image index

| Concept | Image | Dimensions |
| --- | --- | --- |
| Earlier: Rich compact comments | [PNG](images/early-01-rich-compact-comments.png) | 1619 × 971 |
| Earlier: Connection explanation and persona perspective | [PNG](images/early-02-connection-explanation.png) | 1625 × 968 |
| 01 Margin portrait card | [PNG](images/01-margin-portrait-card.png) | 1536 × 1024 |
| 02 Inline editorial interlude | [PNG](images/02-inline-editorial-interlude.png) | 1536 × 1024 |
| 03 Expanded reading sidebar | [PNG](images/03-expanded-reading-sidebar.png) | 1536 × 1024 |
| 04 Bottom review dock | [PNG](images/04-bottom-review-dock.png) | 1536 × 1024 |
| 05 Editorial board | [PNG](images/05-editorial-board.png) | 1536 × 1024 |
| 06 Focus review | [PNG](images/06-focus-review.png) | 1536 × 1024 |
| 07 Split revision workspace | [PNG](images/07-split-revision-workspace.png) | 1536 × 1024 |
| 08 Mobile reading sheet | [PNG](images/08-mobile-reading-sheet.png) | 1024 × 1536 |
| 09 Linked passages dossier | [PNG](images/09-linked-passages-dossier.png) | 1536 × 1024 |
| 10 Long conversation journal | [PNG](images/10-long-conversation-journal.png) | 1536 × 1024 |

Start with 01 for everyday writing, 03 for detailed discussion, and 08 as the mobile counterpart. Other layouts are alternatives for particular review tasks, not ten required modes.

Repository work was limited to this reference folder. Unrelated edits were preserved. No application implementation, commit, push or deployment was requested.

