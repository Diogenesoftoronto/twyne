import type { ManualGuides } from "./manual-guide-types";

export const MANUSCRIPT_CRAFT_GUIDES = {
  "outline-and-find": {
    title: "Give Salt Roads a skeleton",
    summary:
      "Four thousand words with no headings is a diary. Add sections, move one, and fix a word Morgan used eleven times.",
    steps: [
      {
        title: "Insert a heading from the keyboard",
        instruction:
          "Put the cursor in an empty paragraph and type /. The insert menu opens; keep typing to filter it, so /heading shows the three levels. Choose Heading 2 for a section inside the piece and type its title. H₁, H₂ and H₃ on the Home toolbar do the same thing. Real headings matter: the outline, the proof and the exports all follow them.",
        image: "/assets/manual/craft/outline-slash.webp",
        alt: "Salt Roads manuscript with /heading typed and the real insert menu showing Heading 1, Heading 2, and Heading 3.",
        width: 1000,
        height: 650,
      },
      {
        title: "Move a whole section",
        instruction:
          "Open View, then Outline, and select a heading to jump there. To reorder, close the outline and drag the six-dot handle beside a heading onto another heading; drop above or below to choose where it lands. The section travels with everything under it, as one undoable move. Here The ford has moved ahead of The departure, which is where it always belonged.",
        image: "/assets/manual/craft/outline-navigate.webp",
        alt: "Actual document outline listing Loading the caravan, The ford, The departure, and The inland market after a section move.",
        width: 1000,
        height: 650,
      },
      {
        title: "Find the tic and decide the replacement",
        instruction:
          "Open Review, then Find. Enter the word and write a replacement beneath it. The counter shows which match you're on and how many there are; arrows, Enter and Shift+Enter walk through them. Whole word stops 'harbour' matching 'harbours'; Match case and Regular expression are there when you need them. Replace changes this match, Replace all changes every one. Morgan is swapping two 'harbour's for 'port' and leaving the rest.",
        image: "/assets/manual/craft/outline-find.webp",
        alt: "Real find and replace panel with harbour, port, a one-of-two match counter, Whole word checked, and a highlighted match in the manuscript.",
        width: 840,
        height: 650,
      },
    ],
  },
  "tables-and-images": {
    title: "Put a table and a picture where they belong",
    summary:
      "A journey table for the stages of the route, and a frontispiece with alt text a screen reader can use.",
    steps: [
      {
        title: "Draw the table size",
        instruction:
          "Put the cursor where the table goes, then open Insert, then Table. Move across the grid to preview rows and columns and select the last square to insert that shape. With the keyboard, focus the grid, resize with the arrows and press Enter. The pick shown makes a 3 × 3 table with a header row. Select a cell to type; Tab moves to the next.",
        image: "/assets/manual/craft/table-insert.webp",
        alt: "Actual table insertion grid with a three-row, three-column rectangle highlighted above the Salt Roads manuscript.",
        width: 1000,
        height: 650,
      },
      {
        title: "Shape it after it exists",
        instruction:
          "Select inside the table and Table tools appears. Rows and Columns add above, below, left or right, delete, and toggle headers; Cells merges and splits when the selection allows. Hover any icon for its name. Set Width, alignment and Style, then type a Caption and leave the field to keep it. The lower controls handle shading, alignment and borders for the selected cells. Banded rows and a Journey stages caption are enough for this one.",
        image: "/assets/manual/craft/table-tools.webp",
        alt: "Completed journey table with the actual row, column, cell, width, alignment, banded rows style, caption, and cell formatting controls.",
        width: 1000,
        height: 650,
      },
      {
        title: "Describe the picture, then size it",
        instruction:
          "Insert, then Image, takes a file or a URL. Select the inserted image and its inspector opens. Alt text is for the reader who can't see it: say what the picture shows, not that it's a picture. Caption is the visible line underneath. Choose Left, Centre or Right, then a width of 25, 50, 75 or 100 percent, or drag the slider for something in between. Everything applies to the selected image only.",
        image: "/assets/manual/craft/image-inspector.webp",
        alt: "Selected botanical frontispiece with its actual Image inspector showing alt text, caption, Centre alignment, width presets, and custom width slider.",
        width: 840,
        height: 650,
      },
    ],
  },
  "page-layout": {
    title: "Set the page before anyone prints it",
    summary:
      "The magazine wants A4 and a running head. Morgan wants a drop cap. Both are in Layout.",
    note: "This walkthrough uses the Layout controls to set running heads. Editable header and footer bands are not shown in the current writing canvas.",
    steps: [
      {
        title: "Choose paper and a writing width",
        instruction:
          "Open View, then Layout. Piece type comes first: Essay here, and the choice sets the styles the proof uses. Then pick Letter, A4 or Legal, and Portrait or Landscape. Match paper sizes the text block to the sheet; Custom column gives narrow, normal and wide measures instead. One, two or three columns, with a gap control once you have more than one. The example is A4, Portrait, Match paper, one column. The margin sliders lower down set the space around the text.",
        image: "/assets/manual/craft/layout-paper.webp",
        alt: "The Page layout panel with the Essay piece type selected, then A4 paper, Portrait, Match paper and one column.",
        width: 1000,
        height: 700,
      },
      {
        title: "Dress the opening",
        instruction:
          "Under Opening initial, choose Off, Plain or Illustrated. Illustrated offers the Original and Alternate botanical collections; both Plain and Illustrated come in small, medium and large. Page border offers None, Plain, Botanical, Engraved or Illuminated. The example takes a small Illustrated initial from the Original collection and a Botanical border. Close the panel and look at the whole page before you decide; ornament is easy to overdo.",
        image: "/assets/manual/craft/layout-ornaments.webp",
        alt: "Real opening-initial controls with Illustrated, Original, and Small selected, and the Botanical page-border option selected.",
        width: 1000,
        height: 700,
      },
      {
        title: "Set margins and running heads",
        instruction:
          "Scroll down in Layout for Left, Right, Top and Bottom margins; Margin guides draws the text boundary on the page. Under Running heads, switch on Show running header and Page numbers as you need them, then type the Header line and Footer line. These become the folio's running text. Here they read Salt Roads · Field notes and Working manuscript. Save as PDF… at the foot of the panel is the quickest way to see them in place, since the writing canvas doesn't show editable header bands.",
        image: "/assets/manual/craft/layout-running-heads.webp",
        alt: "Actual Layout margin controls and Running heads section with header and page numbers enabled and custom header and footer text fields.",
        width: 1000,
        height: 700,
      },
    ],
  },
  "notes-and-equations": {
    title: "Notes, equations and a diagram of the route",
    summary:
      "A footnote for the survey, a formula for pace, and a three-stop map. None of it leaves the page.",
    steps: [
      {
        title: "Add a footnote and come back to it",
        instruction:
          "Put the cursor after the passage and choose Insert, then Footnote or Endnote. Write the note in the dialog and confirm. To revisit it, activate the reference on the page, or focus it and press Enter. Note text edits the note; Kind converts a footnote to an endnote or back. Previous and Next step through the notes, Reference jumps to the passage, Delete removes it. Footnotes and endnotes collect separately beneath the manuscript.",
        image: "/assets/manual/craft/notes-edit.webp",
        alt: "Actual Footnote 1 editor beside its manuscript reference, with editable note text, a Footnote kind selector, and Previous, Reference, Next, and Delete controls.",
        width: 1000,
        height: 650,
      },
      {
        title: "Set an equation inline or on its own line",
        instruction:
          "In a new paragraph, type /equation. Inline equation sits inside a sentence; Equation block gets a line to itself. Select the inserted equation to open its LaTeX editor, type the expression and watch the preview. Render equation keeps it; Cancel drops the draft. Select a rendered equation again to edit it. The inline one here is v = \\frac{d}{t}; the block editor is previewing d = v t.",
        image: "/assets/manual/craft/equation-editor.webp",
        alt: "Actual Block LaTeX source editor with d = v t, its rendered preview, Render equation and Cancel buttons, and a rendered inline fraction below.",
        width: 1000,
        height: 650,
      },
      {
        title: "Draw the route as a diagram",
        instruction:
          "Open Insert, then Diagram, and type Mermaid. A route can be as short as graph LR, then A[Departure] --> B[Ford] and B --> C[Market] on their own lines. The preview renders beside the source, so check the labels and arrows before Insert diagram. Cancel leaves the manuscript alone; Cmd/Ctrl+Enter inserts without reaching for the mouse.",
        image: "/assets/manual/craft/diagram-editor.webp",
        alt: "Actual Mermaid diagram dialog with editable graph source, a rendered Departure → Ford → Market preview, Cancel, and Insert diagram.",
        width: 920,
        height: 640,
      },
    ],
  },
} satisfies ManualGuides;
