import type { ManualGuides } from "./manual-guide-types";

const asset = (filename: string) => `/assets/manual/work/${filename}.jpg`;

/** Real application controls, captured with non-personal sample data. */
export const YOUR_WORK_GUIDES = {
  "account-and-live": {
    title: "Your account, your reading, your voice desk",
    summary:
      "Keep your public identity separate from listening and Live controls.",
    note: "Account and credit states use a sample profile. Narration and Live are shown before starting a session.",
    steps: [
      {
        title: "Open your account menu",
        instruction:
          "Click your name and picture in the masthead. Preferences opens your settings; My Desk opens your activity; Privacy ledger explains where your writing goes. The menu shows your display name, without an email address.",
        image: asset("account-menu"),
        alt: "Account menu with Morgan Vale's owl picture, Preferences, My Desk, The Manual, and Privacy ledger.",
        width: 308,
        height: 348,
      },
      {
        title: "Choose your public name and picture",
        instruction:
          "In Preferences, claim a writer handle to unlock the optional profile. Upload a picture up to 5 MB or choose a portrait, enter a display name and bio, then click Save profile. View your public profile opens the page readers see.",
        image: asset("public-profile"),
        alt: "Optional public profile with an owl picture, portrait choices, display name, bio, Save profile, and public profile link.",
        width: 806,
        height: 510,
      },
      {
        title: "Enter the narration player",
        instruction:
          "In Write, open Review and click ♪ read. It reads your selection, or the whole draft when nothing is selected. Once a reading starts, the global narration player owns pause, seek, voice changes, and stop.",
        image: asset("narration-entry"),
        alt: "The compositor's Review tab with the read narration entry beside version history and proofing tools.",
        width: 1098,
        height: 96,
      },
      {
        title: "Check Live before starting",
        instruction:
          "Click Talk to open the voice desk and choose Your editor. Review the credit explanation and microphone consent before Start conversation becomes available. The sample desk is idle with zero credit. Minimize keeps the desk nearby; × closes it. During a conversation, proposed edits wait for Apply edit or Discard.",
        image: asset("voice-idle"),
        alt: "Idle Live voice desk with editor selector, zero credit, consent checkbox, minimize and close controls, and disabled Start conversation.",
        width: 430,
        height: 544,
      },
    ],
  },
  "manuscript-tools": {
    title: "From a source draft to a typeset proof",
    summary:
      "Edit native Typst, keep an unfinished source draft, then apply and inspect it.",
    steps: [
      {
        title: "Keep a source draft on this device",
        instruction:
          "Click Source to edit native Typst. The ribbon offers formatting, comments, line wrapping, navigation, and Save .typ. Changes stay in a source draft on this device until you click Apply source. Discard returns to the applied manuscript.",
        image: asset("source-draft"),
        alt: "Native Typst source, the source toolbar, the local source-draft notice, Discard, and Apply source.",
        width: 1098,
        height: 747,
      },
      {
        title: "Resume and find the passage",
        instruction:
          "An unfinished source draft returns after a reload on the same device. Click Find to open Find and Replace, or Go to line to jump within the source. Check matches before replacing. If compilation reports an error, fix the source before applying it.",
        image: asset("source-find"),
        alt: "Recovered Typst source draft with Find and Replace fields open while Apply source remains available.",
        width: 1098,
        height: 747,
      },
      {
        title: "Apply, then read the proof",
        instruction:
          "When the source compiles, click Apply source to save it as the manuscript. Open Proof to inspect the typeset pages; use −, +, and Fit to adjust the view. Return to Source to revise, or use PDF to export. A local save does not confirm account sync.",
        image: asset("typeset-proof"),
        alt: "A real locally typeset proof with headings, a quote, a list, zoom controls, PDF, and Source applied — saved on this device status.",
        width: 1098,
        height: 747,
      },
    ],
  },
  folios: {
    title: "Find, export, share, and recover a folio",
    summary:
      "Move from your Library to a file, a public reading view, or an earlier checkpoint.",
    note: "Publication and checkpoint recovery are shown at their review controls; neither action was submitted.",
    steps: [
      {
        title: "Choose a piece in the Library",
        instruction:
          "Open Library and click a folio card to return to that manuscript. Sort changes the card order. The House link opens the shared context and standards above individual pieces.",
        image: asset("library"),
        alt: "Library with three sample folio cards, Sort: Recent, The House, and Back to desk controls.",
        width: 1100,
        height: 470,
      },
      {
        title: "Take a copy from File",
        instruction:
          "Open File and choose PDF, Typst source, Markdown, HTML, Word, or plain text. Include persona comments adds the room's notes to Markdown, HTML, Word, and plain-text copies. Twyne backup (.json) keeps a restorable copy; Import brings a document or backup back into the room.",
        image: asset("file-export"),
        alt: "The File menu with export formats, Include persona comments, Twyne backup, Import, and Share.",
        width: 244,
        height: 514,
      },
      {
        title: "Review the publishing destination",
        instruction:
          "Choose File → Share to review the title and destinations. Publish now creates a public reading view; anyone with its link can read it. Download page for my domain saves a standalone page. PDS and Micropub are separate publishing destinations with their own connection controls.",
        image: asset("publication-review"),
        alt: "Share dialog showing Publish now, a standalone page download, PDS connection, and Micropub publishing setup.",
        width: 480,
        height: 810,
      },
      {
        title: "Compare before restoring",
        instruction:
          "In Write → Review, open Version history. Save checkpoint preserves the current manuscript. Choose an earlier checkpoint and compare its changed passages. Restore checkpoint opens a confirmation: Save current and restore preserves the current draft first; Keep current manuscript cancels.",
        image: asset("revision-restore"),
        alt: "Version history comparison with changed passages and the Save current and restore or Keep current manuscript confirmation.",
        width: 463,
        height: 737,
      },
    ],
  },
  byok: {
    title: "Choose your provider and models",
    summary:
      "Configure a connection once, choose its default model, then override individual features.",
    note: "Provider and model names are illustrative. API key fields are empty; no provider request or paid model run is shown.",
    steps: [
      {
        title: "Enable Bring Your Own Key",
        instruction:
          "Open Preferences and turn on Bring Your Own Key to reveal provider configuration. Turning on advanced mode exposes the settings; you still need a suitable configured provider to use your own models.",
        image: asset("byok-switch"),
        alt: "Bring Your Own Key section with the advanced-mode switch turned off.",
        width: 848,
        height: 87,
      },
      {
        title: "Enter a provider connection",
        instruction:
          "Click Add provider, choose a catalog provider or Use a custom OpenAI-compatible provider, then enter its name, API key, and required endpoint. Choose the Generation API your server supports. Cancel leaves the form without adding it. Keys stay in this browser; remote requests pass through Twyne to the chosen provider.",
        image: asset("provider-form"),
        alt: "New provider form with sample name, empty API key, endpoint and Generation API controls, Add provider, and Cancel.",
        width: 848,
        height: 662,
      },
      {
        title: "Choose the default model",
        instruction:
          "Under Default Models, select the model used for a provider. Refresh models updates its available choices. Connection details remain in AI Providers. The browser voice model is a separate narration option and requires its on-device voice pack.",
        image: asset("default-model"),
        alt: "Default Models with a sample provider's model selector, Refresh models, and the separate browser offline voice model.",
        width: 848,
        height: 404,
      },
      {
        title: "Override only the feature you need",
        instruction:
          "Expand a row in Per-Feature Models to choose its Provider and Model. Temperature and Max tokens can stay on auto. Other features continue using the default provider. Reset to defaults removes that row's override.",
        image: asset("feature-models"),
        alt: "Per-Feature Models with Read My Draft expanded to show provider, model, temperature, max tokens, and Reset to defaults.",
        width: 848,
        height: 680,
      },
    ],
  },
  privacy: {
    title: "Control disclosure and keep a recoverable copy",
    summary:
      "Review public sharing, private account details, device storage, and backup recovery.",
    note: "The linked-account Settings image uses a sample Not Organic profile with its Private email disclosure closed.",
    steps: [
      {
        title: "Choose which writing facts are public",
        instruction:
          "In Preferences → optional profile, review Public writing statistics. Turn on only the facts you want readers to see; leave Writing streak on Private to hide it. Desk piece count shares a count, without private folio names. AI usage and costs are excluded from the public profile.",
        image: asset("public-statistics"),
        alt: "Public writing statistics controls with all four sharing switches off and Writing streak set to Private.",
        width: 806,
        height: 329,
      },
      {
        title: "Keep private account details closed",
        instruction:
          "In your Not Organic account's Settings, Your account shows public identity and the account recovery state. Private email is a separate disclosure: open it only when you need the address, then close it. The Recovery badge describes the account, rather than a manuscript backup.",
        image: asset("account-settings-private"),
        alt: "Not Organic account Settings with a sample public identity, an Active recovery badge, and the collapsed Private email disclosure; no email is visible.",
        width: 602,
        height: 476,
      },
      {
        title: "Separate local saving from account sync",
        instruction:
          "Open Privacy ledger from your account menu to review storage and data movement. Manuscripts and checkpoints are kept on this device; account sync has its own status. A Saved label or recovered source draft confirms local storage, not delivery to another device. Review privacy settings returns to Preferences.",
        image: asset("privacy-ledger"),
        alt: "Privacy ledger listing on-device manuscripts, account sync Off, AI providers, research, publishing and collaboration, and redacted analytics.",
        width: 1100,
        height: 900,
      },
      {
        title: "Restore from a backup you kept",
        instruction:
          "Use File → Twyne backup (.json) to keep a copy outside this browser. To recover, open File → Import and choose your .twyne.json backup. Import makes its content active, so export anything you want to preserve first. Close leaves your manuscript alone. Clearing browser storage can remove local work.",
        image: asset("backup-import"),
        alt: "Import dialog listing supported documents and Twyne backups, with a file chooser and Close button.",
        width: 448,
        height: 262,
      },
    ],
  },
} satisfies ManualGuides;
