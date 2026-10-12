# Application equation source integration

Root registered `src/app/math_source_coordinator.rs` and executed all three mounted application checks: **3 passed, 0 failed**. [parent-gates.json](parent-gates.json) records the tested coordinator, converter, fixture hashes and retained log.

The actual Submit executor calls `document_edit::apply_html` with a copy of the current manuscript captured for this folio/visit. It checks the same canonical conversion and budget used by Save without changing disk or app metadata. Accepted edits enter the real editor command/history, then the existing Save pipeline persists them. This test uses the actual Store and reloads exact equation whitespace, the original import provenance and untouched neighboring children.

Source and Dossier route transitions clear the actual retained form/context; returning to Write creates a fresh visit. The current scope is refreshed at Save and quiet autosave boundaries. Ordinary typing does not copy the manuscript or run canonical conversion.

These checks use mounted GPUI test windows. They do not establish X11/Wayland input, rendering, OS IME, browser baseline equivalence or complete parity. The application enables inline editing after its separate six-test retained-child integration gate. The third application test opens that actual inline child and submits through the same real conversion and Save pipeline. The earlier block-only gate is retained in parent-gates-block.json.
