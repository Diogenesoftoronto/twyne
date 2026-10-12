// Exported from Twyne. Editing this file does not change your saved folio.

#set document(title: "Native proof parity")

#let twyne-initial-mode = "illuminated"
#let twyne-initial-size = 56.7pt
#let twyne-initial-letter = "A"
#let twyne-initial-artwork(glyph, size) = image("/twyne-decoration/initial-a.png", width: size, height: size, alt: glyph)

#set text(font: ("Lora", "Libertinus Serif"), size: 13.5pt, fill: rgb("#1f1b16"), lang: "en", number-type: "old-style")
#set par(leading: 0.8em, spacing: 0.45em, justify: true)
#set heading(numbering: none)
#show heading: set text(font: ("Libre Baskerville", "Libertinus Serif"), weight: 700)
#show heading: set par(justify: false, leading: 0.4em)
#show heading.where(level: 1): set text(size: 30pt, tracking: -0.01em)
#show heading.where(level: 1): it => block(sticky: true, width: 100%, above: 48pt, below: 24pt)[
  #set align(center)
  #block(above: 0pt, below: 0pt, it.body)
  #block(above: 9pt, below: 0pt, text(font: "DejaVu Sans Mono", size: 12pt, fill: rgb("#c1272d"), "✦"))
]
#show heading.where(level: 2): set text(size: 18pt)
#show heading.where(level: 2): set block(sticky: true, above: 36pt, below: 16pt)
#show heading.where(level: 3): set text(font: ("DM Sans", "DM Sans 9pt"), size: 9pt, tracking: 0.32em, fill: rgb("#c1272d"))
#show heading.where(level: 3): it => block(sticky: true, above: 28pt, below: 12pt, upper(it.body))
#show heading.where(level: 4): set block(sticky: true, above: 24pt, below: 10pt)
#show heading.where(level: 5): set block(sticky: true, above: 20pt, below: 9pt)
#show heading.where(level: 6): set block(sticky: true, above: 18pt, below: 8pt)
#show link: set text(fill: rgb("#2c4a7c"))
#show link: underline.with(stroke: 0.75pt, offset: 2pt)
#show quote.where(block: true): it => block(width: 100%, inset: (x: 1.25em, y: 0.4em), stroke: (left: 2.25pt + rgb("#c1272d")), above: 1.2em, below: 1.2em)[
  #set text(font: ("Libre Baskerville", "Libertinus Serif"), size: 1.25em, fill: rgb("#4a3f33"), style: "italic")
  #set par(leading: 0.55em, justify: false)
  #it.body
  #if it.attribution != none { align(right, [— #it.attribution]) }
]
#show raw: set text(font: "DejaVu Sans Mono", size: 0.88em)
#show raw.where(block: true): set text(fill: rgb("#f4ecd8"), size: 10.5pt)
#show raw.where(block: true): set block(width: 100%, fill: rgb("#1f1b16"), inset: (x: 1.25em, y: 1em), radius: 2pt, above: 1em, below: 1em)
#show math.equation: set text(font: "Libertinus Math")
#set list(indent: 1.2em, body-indent: 0.4em)
#set enum(indent: 1.2em, body-indent: 0.4em)
#set table(inset: (x: 0.8em, y: 0.55em), stroke: 0.75pt + rgb("#ddd0b1"))
#show table: set text(font: ("DM Sans", "DM Sans 9pt"), size: 11.4pt)
#show table: set par(justify: false)
#show table: it => { show par: it => it; it }
#show figure.caption: set text(font: ("DM Sans", "DM Sans 9pt"), size: 9.36pt, fill: rgb("#4a3f33"))
#show footnote.entry: set text(size: 0.85em, fill: rgb("#4a3f33"))
#set footnote.entry(separator: line(length: 30%, stroke: 0.6pt + rgb("#ddd0b1")))
#set line(stroke: 0.6pt + rgb("#ddd0b1"))
#let twyne-opening-seen = state("twyne-editorial-opening", false)
#let twyne-opening-depth = state("twyne-editorial-depth", 0)
#let twyne-nested(body) = {
  twyne-opening-depth.update(n => n + 1)
  body
  twyne-opening-depth.update(n => n - 1)
}
#let twyne-initial-parts(body) = {
  if body.func() == smartquote or body.func() == metadata or ("space", "tag").contains(repr(body.func())) {
    (initial: none, prefix: body, rest: [], skip: true)
  } else if body.func() == text and body.has("text") {
    let letters = body.text.clusters()
    let offset = 0
    while offset < letters.len() and (letters.at(offset).trim() == "" or ("“", "‘", "\"", "'", "«", "‹", "「", "『", "(", "[", "{", "¿", "¡").contains(letters.at(offset))) { offset += 1 }
    if offset == letters.len() { return (initial: none, prefix: body, rest: [], skip: true) }
    if letters.at(offset).match(regex("^[\\p{L}\\p{N}]")) == none { return (initial: none, prefix: [], rest: body, skip: false) }
    (initial: letters.at(offset), prefix: text(letters.slice(0, offset).join()), rest: text(letters.slice(offset + 1).join()), skip: false)
  } else if body.has("children") and body.children.len() > 0 {
    let prefix = []
    for (index, child) in body.children.enumerate() {
      let first = twyne-initial-parts(child)
      if first.initial != none { return (initial: first.initial, prefix: prefix + first.prefix, rest: first.rest + body.children.slice(index + 1).join(), skip: false) }
      if not first.skip { return (initial: none, prefix: [], rest: body, skip: false) }
      prefix += child
    }
    (initial: none, prefix: body, rest: [], skip: true)
  } else if body.has("child") and body.has("styles") {
    let first = twyne-initial-parts(body.child)
    (initial: first.initial, prefix: body.func()(first.prefix, body.styles), rest: body.func()(first.rest, body.styles), skip: first.skip)
  } else if (strong, emph, underline, strike, super, sub, link).contains(body.func()) {
    let first = twyne-initial-parts(body.body)
    let fields = body.fields()
    let discarded = fields.remove("body")
    let wrap(content) = if body.func() == link { link(fields.dest, content) } else { body.func()(content, ..fields) }
    (initial: first.initial, prefix: wrap(first.prefix), rest: wrap(first.rest), skip: first.skip)
  } else { (initial: none, prefix: [], rest: body, skip: false) }
}
// Keep rich inline styling while finding word boundaries for the side of the
// drop cap. Adjacent marked fragments of one word must stay together.
#let twyne-opening-tokens(body) = {
  if body.func() == text and body.has("text") {
    body.text.matches(regex("\\s+|[^\\s]+")).map(part => (
      body: text(part.text), space: part.text.trim() == "",
    ))
  } else if body.has("children") {
    body.children.fold((), (tokens, child) => tokens + twyne-opening-tokens(child))
  } else if body.has("child") and body.has("styles") {
    twyne-opening-tokens(body.child).map(token => (
      body: body.func()(token.body, body.styles), space: token.space,
    ))
  } else if (strong, emph, underline, strike, super, sub, link, highlight, smallcaps).contains(body.func()) {
    let fields = body.fields()
    let discarded = fields.remove("body")
    let wrap(content) = if body.func() == link { link(fields.dest, content) } else { body.func()(content, ..fields) }
    twyne-opening-tokens(body.body).map(token => (body: wrap(token.body), space: token.space))
  } else { ((body: body, space: body.func() == [ ].func()),) }
}
#let twyne-opening-line(body) = [#par(body)<twyne-opening-line>]
#let twyne-wrap-opening(initial, body) = layout(bounds => {
  show par: it => it
  let cap = measure(initial)
  let gap = 0.14 * twyne-initial-size
  let width = bounds.width - cap.width - gap
  // Very narrow columns still retain all manuscript content.
  if width < (2em).to-absolute() { return initial + h(gap) + body }
  let tokens = twyne-opening-tokens(body)
  let breaks = tokens.enumerate().filter(pair => pair.at(1).space).map(pair => pair.at(0))
  breaks.push(tokens.len())
  let join(start, end) = tokens.slice(start, end).map(token => token.body).join()
  // Measure with the active font, paragraph leading and actual column width.
  // Binary search bounds the work even for a long opening paragraph.
  let low = 0
  let high = breaks.len()
  while low < high {
    let middle = calc.floor((low + high) / 2)
    let height = measure(block(width: width, above: 0pt, below: 0pt, twyne-opening-line(join(0, breaks.at(middle))))).height
    if height <= cap.height { low = middle + 1 } else { high = middle }
  }
  let end = if low == 0 { breaks.first() } else { breaks.at(low - 1) }
  let next = end
  while next < tokens.len() and tokens.at(next).space { next += 1 }
  let beside = join(0, end)
  let below = join(next, tokens.len())
  block(width: 100%, above: 0pt, below: 0pt, grid(
    columns: (cap.width, 1fr), column-gutter: gap,
    initial,
    twyne-opening-line([#beside#if next < tokens.len() { linebreak(justify: par.justify) }]),
  ))
  if next < tokens.len() {
    v(par.leading, weak: true)
    twyne-opening-line(below)
  }
})
#let twyne-opening(body) = context {
  show par: it => it
  if twyne-opening-depth.get() > 0 or twyne-initial-mode == "off" { body } else {
  let seen = twyne-opening-seen.get()
  twyne-opening-seen.update(true)
  let parts = if seen { (initial: none, prefix: [], rest: body) } else { twyne-initial-parts(body) }
  if parts.initial == none { body } else {
    let initial = if twyne-initial-mode == "illuminated" and upper(parts.initial) == twyne-initial-letter {
      twyne-initial-artwork(parts.initial, twyne-initial-size)
    } else { text(size: twyne-initial-size, weight: 700, top-edge: "bounds", bottom-edge: "bounds", fill: rgb("#c1272d"), parts.initial) }
    twyne-wrap-opening(box(parts.prefix + initial), parts.rest)
  }
  }
}

#let twyne-page-frame = box(width: 576pt, height: 756pt,
  grid(columns: (36pt, 504pt, 36pt), rows: (36pt, 684pt, 36pt), gutter: 0pt,
    image("/twyne-decoration/frame-illuminated-nw.png", width: 36pt, height: 36pt, fit: "stretch", alt: none), stack(dir: ltr, spacing: 0pt, image("/twyne-decoration/frame-illuminated-n.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-n.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-n.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-n.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-n.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-n.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-n.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-n.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-n.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-n.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-n.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-n.png", width: 42pt, height: 36pt, fit: "stretch", alt: none)), image("/twyne-decoration/frame-illuminated-ne.png", width: 36pt, height: 36pt, fit: "stretch", alt: none),
    stack(dir: ttb, spacing: 0pt, image("/twyne-decoration/frame-illuminated-w.png", width: 36pt, height: 97.71428571428571pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-w.png", width: 36pt, height: 97.71428571428571pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-w.png", width: 36pt, height: 97.71428571428571pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-w.png", width: 36pt, height: 97.71428571428571pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-w.png", width: 36pt, height: 97.71428571428571pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-w.png", width: 36pt, height: 97.71428571428571pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-w.png", width: 36pt, height: 97.71428571428571pt, fit: "stretch", alt: none)), [], stack(dir: ttb, spacing: 0pt, image("/twyne-decoration/frame-illuminated-e.png", width: 36pt, height: 97.71428571428571pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-e.png", width: 36pt, height: 97.71428571428571pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-e.png", width: 36pt, height: 97.71428571428571pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-e.png", width: 36pt, height: 97.71428571428571pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-e.png", width: 36pt, height: 97.71428571428571pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-e.png", width: 36pt, height: 97.71428571428571pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-e.png", width: 36pt, height: 97.71428571428571pt, fit: "stretch", alt: none)),
    image("/twyne-decoration/frame-illuminated-sw.png", width: 36pt, height: 36pt, fit: "stretch", alt: none), stack(dir: ltr, spacing: 0pt, image("/twyne-decoration/frame-illuminated-s.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-s.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-s.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-s.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-s.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-s.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-s.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-s.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-s.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-s.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-s.png", width: 42pt, height: 36pt, fit: "stretch", alt: none), image("/twyne-decoration/frame-illuminated-s.png", width: 42pt, height: 36pt, fit: "stretch", alt: none)), image("/twyne-decoration/frame-illuminated-se.png", width: 36pt, height: 36pt, fit: "stretch", alt: none)))

#set columns(gutter: 18pt)

#set page(width: 8.5in, height: 11in, columns: 1, margin: (left: 60pt, right: 60pt, top: 60pt, bottom: 60pt), fill: rgb("#fbf6e7"), background: align(center + horizon, twyne-page-frame), header-ascent: 20%, footer-descent: 20%, header: [], footer: [#set text(font: "Special Elite", size: 8pt, fill: rgb("#4a3f33"))
#set par(justify: false)
#h(1fr)#box(fill: rgb("#fbf6e7"), inset: (x: 3pt))[#context counter(page).display("1")]])

#block()[#heading(level: 1)[#text("Native proof parity")]]
#text(" ")#block()[#twyne-opening[#text("At the edge of the writing desk, ")#strong[#text("the manuscript keeps its own voice")]#text(". Every letter belongs to the author; every ornament belongs to the page. An ")#emph[#text("illuminated opening")]#text(" sits beside the first lines without swallowing their words, and a ")#link("https://twyne.app/")[#text("quiet link")]#text(" remains part of the sentence. The long opening makes the rich-text wrap observable: lines leave the artwork behind and continue across the full measure. The proof is a record of the same source, with bold, italic, and ordinary text sharing one paragraph.")]]
#text(" ")#block()[#twyne-opening[#text("Local writing continues without a browser, a font download, or a publishing service. The original Lora face carries these paragraphs; Libre Baskerville carries the heading. The running footer counts the physical sheets. Saved source can be reopened, compiled, and exported on the same machine.")]]
#text(" ")#block()[#heading(level: 2)[#text("Evidence on the page")]]
#text(" ")#quote(block: true)[#block()[#text("A proof should show what the compiler made, including the places where a manuscript asks for something unavailable.")]
]
#text(" ")#list([#text("The first paragraph wraps beside its original artwork.")],
[#text("Rich text survives the serializer and the native compiler.")],
[#text("Images and mathematics share the same paged document.")])
#text(" ")#table(columns: 2,
table.cell(x: 0, y: 0, colspan: 1, rowspan: 1, fill: rgb("#ebe1c9"))[#strong[#text("Surface")]],
table.cell(x: 1, y: 0, colspan: 1, rowspan: 1, fill: rgb("#ebe1c9"))[#strong[#text("Evidence")]],
table.cell(x: 0, y: 1, colspan: 1, rowspan: 1)[#text("Proof")],
table.cell(x: 1, y: 1, colspan: 1, rowspan: 1)[#text("Paged SVG")],
table.cell(x: 0, y: 2, colspan: 1, rowspan: 1)[#text("Export")],
table.cell(x: 1, y: 2, colspan: 1, rowspan: 1)[#text("Searchable PDF")],
)

#pagebreak()
= Mathematics and original artwork

The exact compiler renders a native equation with Libertinus Math:

$ integral_0^1 x^2 dif x = 1/3 quad "and" quad sum_(k=1)^n k = (n(n+1))/2 $

#align(center)[#image("/assets/griffin-mark.svg", width: 72pt, alt: "Original Twyne griffin")]

#text(font: "DM Sans")[DM Sans: labels remain legible.]

#text(font: "Special Elite")[Special Elite: department labels.]

#text(font: "Fraunces")[Fraunces: original variable display face.]

#raw("let source = canonical;", block: true)
