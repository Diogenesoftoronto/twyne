# Unapplied field-evidence follow-up

The actual textarea's computed `ui-monospace` declaration and outer rectangle
cannot prove its selected face, visible text rows or painted caret. The inspected
CDP textarea platform-font lists are empty. DOMSnapshot includes the textarea
element, but does not expose its painted value as visible text fragments.

Parent may inspect a bounded subtree of the **actual retained textarea**, including
UA shadow nodes if the current CDP backend exposes them. Preserve backend-node
ownership, raw value, UTF-16 selection, current focus, Source/CSS/font hashes and
the same fresh-frame/coherent-geometry guards. Do not add a shadow-text clone,
change Source styles, inject a guessed font or use another control's text as
textarea evidence.

If an actual painted value node is exposed, record its selected font identity,
computed font/line/wrapping styles and raw fragment ranges/quads. Any association
must be to the real field and unchanged value. A browser-selected font query on
an element with no painted glyphs is still insufficient. If the backend exposes
no painted field node, retain an explicit unavailable receipt.

Logical `selectionStart`/`selectionEnd` remain logical UTF-16 endpoints. A
manuscript `coordsAtPos` rectangle, label fragment, textarea height, line-height
or preview wrapper cannot establish the field's painted caret or TeX baseline.
Any future field-row/caret admission needs a separately reviewed observed
protocol and negative tests. The current checker deliberately has no automatic
upgrade path based on nonempty selected-font lists alone.

This proposal is not applied or executed. The independently qualified
prose/first-label baseline contract remains separate from this missing field
evidence, all screenshots, native renderer metrics and the full product route.
