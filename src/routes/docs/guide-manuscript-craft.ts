import type { ManualGuides } from "./manual-guide-types";

export const MANUSCRIPT_CRAFT_GUIDES = {
  "outline-and-find": {
    title: "Shape the manuscript and find your place",
    summary:
      "Insert headings, navigate the outline, move whole sections, and revise repeated words.",
    steps: [
      {
        title: "Insert a heading from the page",
        instruction:
          "Put the cursor in a new paragraph and type / to open Insert a block. Keep typing to filter the commands: /heading shows the three heading levels. Choose Heading 2 for a section within the manuscript, then write its title. The Home toolbar also offers H₁, H₂, and H₃. Use actual headings so the outline can follow the structure of your piece.",
        image: "/assets/manual/craft/outline-slash.webp",
        alt: "Salt Roads manuscript with /heading typed and the real insert menu showing Heading 1, Heading 2, and Heading 3.",
        width: 820,
        height: 570,
      },
      {
        title: "Navigate and move whole sections",
        instruction:
          "Open View → Outline and choose a heading to jump to that section. To change the order, close the outline, then drag the six-dot handle beside a manuscript heading onto another heading. Drop above or below the target to choose the position. The section moves with its following content; reopen the outline to check the new order. Here, The ford has moved before The departure.",
        image: "/assets/manual/craft/outline-navigate.webp",
        alt: "Actual document outline listing Loading the caravan, The ford, The departure, and The inland market after a section move.",
        width: 820,
        height: 570,
      },
      {
        title: "Find a word and choose the replacement",
        instruction:
          "Open Review → Find, enter the word to locate, and write the replacement below it. The counter shows your current match and the total; use the arrows, Enter, or Shift+Enter to inspect matches. Whole word avoids partial-word matches, while Match case and Regular expression refine the search. Replace changes the current match; Replace all changes every match. In this example, harbour has two matches and port is the proposed replacement.",
        image: "/assets/manual/craft/outline-find.webp",
        alt: "Real find and replace panel with harbour, port, a one-of-two match counter, Whole word checked, and a highlighted match in the manuscript.",
        width: 820,
        height: 570,
      },
    ],
  },
  "tables-and-images": {
    title: "Give tables and images a place on the page",
    summary:
      "Build a table, adjust its structure and presentation, and describe a selected image.",
    steps: [
      {
        title: "Choose the table size",
        instruction:
          "Place the cursor where the table belongs, then open Insert → Table. Move over the grid to preview the number of rows and columns; click the final square to insert that rectangle. You can also focus the grid, resize the selection with the arrow keys, and press Enter. The illustrated selection creates a 3 × 3 table with a header row. Click a cell to write; Tab advances through the cells.",
        image: "/assets/manual/craft/table-insert.webp",
        alt: "Actual table insertion grid with a three-row, three-column rectangle highlighted above the Salt Roads manuscript.",
        width: 820,
        height: 570,
      },
      {
        title: "Edit the structure and presentation",
        instruction:
          "Click inside the table to reveal Table tools. The Rows and Columns groups add above/below or left/right, delete, and toggle headers; Cells offers merge and split when the selection allows them. Hover an icon to read its action. Set Width, alignment, and Style, then enter a Caption and leave the field to commit it. The lower cell controls set shading, alignment, and borders. Here, banded rows and a Journey stages caption organize the sample table.",
        image: "/assets/manual/craft/table-tools.webp",
        alt: "Completed journey table with the actual row, column, cell, width, alignment, banded rows style, caption, and cell formatting controls.",
        width: 820,
        height: 570,
      },
      {
        title: "Describe and size a selected image",
        instruction:
          "Use Insert → Image to choose a file or enter an image URL, then select the inserted image to open its inspector. Write Alt text that describes what a reader cannot see, and add a Caption for the visible explanation. Choose Left, Centre, or Right alignment, then a 25%, 50%, 75%, or 100% width preset; the slider allows a custom width. These controls update the selected image. The example uses a local botanical illustration and a separate caption.",
        image: "/assets/manual/craft/image-inspector.webp",
        alt: "Selected botanical frontispiece with its actual Image inspector showing alt text, caption, Centre alignment, width presets, and custom width slider.",
        width: 820,
        height: 570,
      },
    ],
  },
  "page-layout": {
    title: "Set the shape of the page",
    summary:
      "Choose paper and margins, edit the running heads, and finish the opening initial and border.",
    note: "This walkthrough uses the Layout controls to set running heads. Editable header and footer bands are not shown in the current writing canvas.",
    steps: [
      {
        title: "Choose paper and a writing width",
        instruction:
          "Open View → Layout. Choose Letter, A4, or Legal paper and Portrait or Landscape orientation. Match paper uses the paper setting; Custom column offers narrow, normal, and wide writing widths. Choose one, two, or three columns, then adjust the column gap when using several. The illustrated setup selects A4, Portrait, Match paper, and one column. Use the margin sliders further down the panel to set space around the text.",
        image: "/assets/manual/craft/layout-paper.webp",
        alt: "Actual Page layout panel with A4, Portrait, Match paper, and one column selected, plus opening initial, border, and margin controls.",
        width: 820,
        height: 640,
      },
      {
        title: "Finish the opening and page border",
        instruction:
          "Under Opening initial, choose Off, Plain, or Illustrated. Illustrated reveals Original and Alternate botanical collections; either Plain or Illustrated lets you choose a small, medium, or large initial. Under Page border, choose None, Plain, Botanical, Engraved, or Illuminated. The example selects an Illustrated initial from the Original collection at Small size and a Botanical border. Choose these details to support the manuscript’s tone, then check the full page with the panel closed.",
        image: "/assets/manual/craft/layout-ornaments.webp",
        alt: "Real opening-initial controls with Illustrated, Original, and Small selected, and the Botanical page-border option selected.",
        width: 820,
        height: 640,
      },
      {
        title: "Set margins and running heads",
        instruction:
          "Scroll down within Layout to set Left, Right, Top, and Bottom margins. Margin guides marks the printable text boundary. Under Running heads, enable Show running header and Page numbers as needed, then write the Header line and Footer line. These fields update the folio’s running text; here they read Salt Roads · Field notes and Working manuscript. The controls are available even when editable page bands are not visible on the writing canvas.",
        image: "/assets/manual/craft/layout-running-heads.webp",
        alt: "Actual Layout margin controls and Running heads section with header and page numbers enabled and custom header and footer text fields.",
        width: 820,
        height: 640,
      },
    ],
  },
  "notes-and-equations": {
    title: "Add notes, equations, and diagrams",
    summary:
      "Keep supporting detail in notes, render LaTeX equations, and draw a Mermaid diagram.",
    steps: [
      {
        title: "Write and revisit a footnote or endnote",
        instruction:
          "Place the cursor after the passage and choose Insert → Footnote or Endnote. Write the note in the insertion dialog and confirm it. Activate its reference on the page, or focus the reference and press Enter, to reopen the note editor. Changes to Note text update the note; Kind converts between Footnote and Endnote. Previous and Next visit adjacent notes, Reference returns to the passage, and Delete removes the note. Footnotes and endnotes have separate collections below the manuscript.",
        image: "/assets/manual/craft/notes-edit.webp",
        alt: "Actual Footnote 1 editor beside its manuscript reference, with editable note text, a Footnote kind selector, and Previous, Reference, Next, and Delete controls.",
        width: 820,
        height: 570,
      },
      {
        title: "Render an inline or display equation",
        instruction:
          "In a new paragraph, type /equation and choose Inline equation for a formula within a paragraph, or Equation block for a display formula. Select the inserted equation to open its LaTeX editor. Enter the expression and inspect the live preview, then choose Render equation to commit it or Cancel to discard the draft. Select a rendered equation again to edit it. Here, the inline formula is v = \\frac{d}{t}, while the display editor previews d = v t.",
        image: "/assets/manual/craft/equation-editor.webp",
        alt: "Actual Block LaTeX source editor with d = v t, its rendered preview, Render equation and Cancel buttons, and a rendered inline fraction below.",
        width: 820,
        height: 570,
      },
      {
        title: "Draw a diagram from Mermaid source",
        instruction:
          "Open Insert → Diagram to enter Mermaid source. A short route can begin with graph LR, followed by A[Departure] --> B[Ford] and B --> C[Market] on separate lines. The dialog renders a live Diagram preview beside the source, so check the labels and connections before choosing Insert diagram. Cancel leaves the manuscript alone; Cmd/Ctrl+Enter also inserts. The example shows a left-to-right route through three places in the fictional manuscript.",
        image: "/assets/manual/craft/diagram-editor.webp",
        alt: "Actual Mermaid diagram dialog with editable graph source, a rendered Departure → Ford → Market preview, Cancel, and Insert diagram.",
        width: 920,
        height: 640,
      },
    ],
  },
} satisfies ManualGuides;
