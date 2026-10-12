// twyne-document:1
#let twyne-image(source, width: 100%, alt: "") = image(source, width: width, alt: alt)
#let twyne-math(source, block: false) = raw(source, block: block)
#let twyne-mermaid(source) = raw(source, block: true)
#let twyne-number(value, fallback: 0) = {
  if type(value) == str and value.match(regex("^-?[0-9]+([.][0-9]+)?$")) != none { float(value) } else { fallback }
}
#let twyne-length(value, fallback: 0pt) = {
  let m = value.match(regex("^([0-9]+([.][0-9]+)?)(pt|px|em|rem|%)$"))
  if m == none { fallback } else {
    let n = float(m.captures.at(0))
    let unit = m.captures.at(2)
    if unit == "pt" { n * 1pt } else if unit == "px" { n * 0.75pt } else if unit == "%" { n * 1% } else if unit == "rem" { n * 12pt } else { n * 1em }
  }
}
#let twyne-color(value, fallback: none) = {
  if value.match(regex("^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$")) != none { rgb(value) }
  else if value.starts-with("rgb(") or value.starts-with("rgba(") {
    let values = value.split("(").last().trim(")").split(",").map(x => twyne-number(x.trim()))
    if values.len() >= 3 { rgb(int(values.at(0)), int(values.at(1)), int(values.at(2))) } else { fallback }
  } else { fallback }
}
#let twyne-endnotes = state("twyne-endnotes", ())
#show: body => {
  body
  context {
    let notes = twyne-endnotes.final()
    if notes.len() > 0 { heading(level: 2, [Notes]); enum(..notes) }
  }
}
#let twyne-node(tag, attributes, body) = {
  let a = json.decode(attributes)
  let kind = a.at("data-type", default: "")
  let styles = (:)
  for rule in a.at("style", default: "").split(";") {
    let parts = rule.split(":")
    if parts.len() == 2 { styles.insert(parts.at(0).trim(), parts.at(1).trim()) }
  }
  let alignment = a.at("data-image-align", default: a.at("data-table-alignment", default: styles.at("text-align", default: "")))
  let result = if kind == "page-break" { pagebreak() }
  else if kind == "footnote" { footnote(a.at("data-endnote-text", default: "")) }
  else if kind == "endnote" {
    twyne-endnotes.update(notes => notes + (a.at("data-endnote-text", default: ""),))
    context super(str(twyne-endnotes.get().len()))
  }
  else if tag == "strong" or tag == "b" { strong(body) }
  else if tag == "em" or tag == "i" { emph(body) }
  else if tag == "u" { underline(body) }
  else if tag == "s" or tag == "del" or tag == "strike" { strike(body) }
  else if tag == "sup" { super(body) }
  else if tag == "sub" { sub(body) }
  else if tag == "mark" { highlight(body) }
  else if tag == "a" { link(a.at("href", default: ""), body) }
  else if tag == "br" { linebreak() }
  else if tag == "hr" { line(length: 100%) }
  else if tag == "img" { body }
  else if tag == "h1" { heading(level: 1, body) }
  else if tag == "h2" { heading(level: 2, body) }
  else if tag == "h3" { heading(level: 3, body) }
  else if tag == "h4" { heading(level: 4, body) }
  else if tag == "h5" { heading(level: 5, body) }
  else if tag == "h6" { heading(level: 6, body) }
  else if tag == "blockquote" { quote(block: true, body) }
  else if tag == "pre" { block(fill: luma(96%), inset: 8pt, text(font: "DejaVu Sans Mono", body)) }
  else if tag == "code" { text(font: "DejaVu Sans Mono", body) }
  else if tag == "li" { list.item(if kind == "taskItem" { text(if a.at("data-checked", default: "false") == "true" { "[x] " } else { "[ ] " }) + body } else { body }) }
  else if tag == "ul" { list(marker: if kind == "taskList" { [] } else { [•] }, ..if body.has("children") { body.children } else { (body,) }) }
  else if tag == "ol" { enum(start: int(calc.clamp(calc.round(twyne-number(a.at("start", default: "1"), fallback: 1)), 1, 1000000)), ..if body.has("children") { body.children.map(item => item.body) } else { (body.body,) }) }
  else if tag == "td" or tag == "th" {
    let horizontal = a.at("data-cell-horizontal-alignment", default: styles.at("text-align", default: "left"))
    let vertical = a.at("data-cell-vertical-alignment", default: "top")
    let cell-align = (if horizontal == "center" { center } else if horizontal == "right" { right } else { left }) + (if vertical == "middle" { horizon } else if vertical == "bottom" { bottom } else { top })
    let border-style = a.at("data-cell-border-style", default: "solid")
    let border = if border-style == "none" { none } else {
      (paint: twyne-color(a.at("data-cell-border-color", default: ""), fallback: luma(75%)), thickness: twyne-number(a.at("data-cell-border-width", default: "0.67")) * 0.75pt, dash: if border-style == "dashed" { "dashed" } else if border-style == "dotted" { "dotted" } else { "solid" })
    }
    grid.cell(colspan: int(a.at("colspan", default: "1")), rowspan: int(a.at("rowspan", default: "1")), align: cell-align, fill: twyne-color(a.at("data-cell-background", default: styles.at("background-color", default: ""))), stroke: border, if tag == "th" { strong(body) } else { body })
  }
  else if tag == "table" {
    let cells = if body.has("children") { body.children } else { (body,) }
    let widths = a.at("data-twyne-column-widths", default: "")
    let columns = if widths == "" { int(a.at("data-twyne-columns", default: "1")) } else { widths.split(",").map(x => if twyne-number(x) > 0 { twyne-number(x) * 0.75pt } else { auto }) }
    let table-body = grid(columns: columns, inset: 4pt, stroke: 0.5pt + luma(75%), ..cells)
    let caption = a.at("data-table-caption", default: a.at("data-twyne-caption", default: ""))
    block(width: twyne-length(a.at("data-table-width", default: "100%"), fallback: 100%), table-body + if caption != "" { block(text(size: 0.85em, caption)) } else { [] })
  }
  else if tag == "caption" { [] }
  else if tag == "figcaption" { block(text(size: 0.85em, body)) }
  else if tag == "figure" {
    let ratio = twyne-number(a.at("data-image-aspect-ratio", default: "0"))
    block(width: twyne-number(a.at("data-image-width", default: "100"), fallback: 100) * 1%, if ratio > 0 { layout(size => { set image(height: size.width / ratio, fit: "cover"); body }) } else { body })
  }
  else if tag == "p" {
    let leading = twyne-number(styles.at("line-height", default: "1.5"), fallback: 1.5)
    block(above: twyne-number(a.at("data-space-before", default: "0")) * 1pt, below: twyne-number(a.at("data-space-after", default: "8")) * 1pt, sticky: a.at("data-keep-with-next", default: "false") == "true", { set par(leading: calc.max(0, leading - 1) * 1em); body })
  }
  else { body }
  if tag == "td" or tag == "th" { return result }
  let color = twyne-color(styles.at("color", default: ""))
  if color != none { result = text(fill: color, result) }
  let background = twyne-color(styles.at("background-color", default: ""))
  if background != none { result = highlight(fill: background, result) }
  let font = styles.at("font-family", default: "").split(",").first().trim().replace("\"", "").replace("'", "")
  if font != "" { result = text(font: if font == "monospace" or font == "ui-monospace" { "DejaVu Sans Mono" } else if font == "serif" { "Libertinus Serif" } else if font == "sans-serif" { "DM Sans" } else { font }, result) }
  let font-size = twyne-length(styles.at("font-size", default: ""), fallback: none)
  if font-size != none { result = text(size: font-size, result) }
  if styles.at("font-weight", default: "") == "bold" { result = strong(result) }
  if styles.at("font-style", default: "") == "italic" { result = emph(result) }
  if alignment == "center" { result = align(center, result) }
  if alignment == "right" { result = align(right, result) }
  if alignment == "justify" { result = block({ set par(justify: true); result }) }
  if a.at("data-indent", default: "0") != "0" { result = pad(left: int(a.at("data-indent")) * 18pt, result) }
  result
}
// twyne-document:body
#twyne-node("h1", "{}")[#text("The notebook")]

#twyne-node("p", "{}")[#text("The notebook was small enough to carry in a coat pocket. By November, its corners had softened and the cover had begun to remember the shape of a hand.")]

#twyne-node("p", "{}")[#text("Most pages held ordinary things: the name of a book, a sentence overheard on the train, the hours of a shop she kept arriving at after it had closed.")]

#twyne-node("h2", "{}")[#text("A note for the next draft")]

#twyne-node("p", "{}")[#text("Keep the opening concrete. Let the change in the room carry the ending.")]