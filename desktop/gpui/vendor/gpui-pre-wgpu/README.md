# Twyne's pinned text renderer seam

This is the published `gpui-pre-wgpu` 0.3.7 crate, pinned to the same GPUI
snapshot already used by GPUI Kit 0.7.0. The original crate archive checksum
is `f0b02657b56b09140ce542f5e4434fb96d9fdaba0fd0035ba7dba13c171ddb9b`.
`UPSTREAM-SHA256.txt` records every copied upstream file before this patch.
The upstream Apache 2.0 license is retained in `LICENSE-APACHE`.

The Linux Cosmic Text font loader originally rejects any font lacking a Latin
`m`, including CJK-only Droid Sans Fallback used by the original Twyne browser.
Twyne permits such a font only when a caller explicitly names it in a fallback
chain. Primary fonts retain the existing Latin validation and Windows caption
icon exceptions. Primary and explicit fallback loads have separate cache keys,
including the loaded face key, so a previously loaded fallback cannot become a
primary font by a cache hit. A rejected primary face stays in the database so
later explicit fallback requests do not depend on font request order.

No shaping, glyph rasterization, line breaking, renderer or platform selection
code changes. The writing font chooses its original packaged Droid fallback;
the primary writing fonts and Source monospace font remain the original ones.
Application tests and the isolated native glyph/raster fixtures exercise this
crate through the actual GPUI text system. Published upstream unit tests refer
to fonts outside the crate archive and are not claimed as a standalone gate.
