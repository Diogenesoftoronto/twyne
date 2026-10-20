import type { ManualGuides } from "./manual-guide-types";

const asset = (filename: string) => `/assets/manual/work/${filename}.jpg`;

/** Real application controls, captured with non-personal sample data. */
export const YOUR_WORK_GUIDES = {
  "account-and-live": {
    title: "Be Morgan Vale in the room, and nobody else's business",
    summary:
      "A name and a picture for the editors to address. Listening and Live sit nearby, and neither starts until you say so.",
    note: "Account and credit states use a sample profile. Narration and Live are shown before starting a session.",
    steps: [
      {
        title: "Find your account menu",
        instruction:
          "Select your name and picture in the masthead. Preferences holds your settings, My Desk your activity, and Privacy ledger an honest account of where your writing goes. The menu shows a display name only; your email never appears here.",
        image: asset("account-menu"),
        alt: "Account menu with Morgan Vale's owl picture, Preferences, My Desk, The Manual, and Privacy ledger.",
        width: 308,
        height: 348,
      },
      {
        title: "Choose the face readers will see",
        instruction:
          "In Preferences, claim a writer handle and the optional public profile unlocks. Upload a picture up to 5 MB or choose one of the portraits, write a display name and a bio, then Save profile. View your public profile shows the page exactly as a reader gets it.",
        image: asset("public-profile"),
        alt: "Optional public profile with an owl picture, portrait choices, display name, bio, Save profile, and public profile link.",
        width: 806,
        height: 510,
      },
      {
        title: "Hear the draft read back",
        instruction:
          "Morgan catches clumsy rhythm by ear. In Write, open Review and select ♪ read. It reads the selection, or the whole draft when nothing is selected. The same ribbon holds Version history, The piece, Task desk, Find and Grammar. Once a reading starts, the narration player takes over pause, seek, voice and stop.",
        image: asset("narration-entry"),
        alt: "The compact Review ribbon with ♪ read, Version history, The piece, Task desk, Find and Grammar.",
        width: 1100,
        height: 97,
      },
      {
        title: "Check the voice desk before you talk",
        instruction:
          "Select Talk to open the voice desk and choose an editor from the portraits; Le Lecteur is a good first listener because he reads as your audience. The desk shows your wallet balance and a See plans link. Start talking stays disabled until there is credit to spend, which is why it is grey here. Minimize keeps the desk nearby; × closes it. During a conversation, any edit the editor proposes waits for Apply edit or Discard.",
        image: asset("voice-idle"),
        alt: "The idle Live voice desk with Le Lecteur’s portrait, five editor choices, a See plans link, a zero wallet balance and a disabled Start talking button.",
        width: 360,
        height: 506,
      },
    ],
  },
  "manuscript-tools": {
    title: "Go under the page when the page isn't enough",
    summary:
      "Morgan wants a pull quote set exactly so. Source shows the Typst underneath the manuscript; Proof shows the printed result.",
    steps: [
      {
        title: "Edit the source, safely",
        instruction:
          "Select Source to see the native Typst behind the manuscript. The ribbon offers formatting, comments, line wrapping, navigation and Save .typ. Everything you change here stays in a source draft on this device until you select Apply source. Discard throws the draft away and returns to the applied manuscript.",
        image: asset("source-draft"),
        alt: "Native Typst source, the source toolbar, the local source-draft notice, Discard, and Apply source.",
        width: 1098,
        height: 764,
      },
      {
        title: "Pick up where you stopped",
        instruction:
          "An unfinished source draft survives a reload on the same device. Find opens Find and Replace; Go to line jumps straight to a line number. If compilation reports an error, the draft stays editable until you fix it; nothing broken gets applied.",
        image: asset("source-find"),
        alt: "Recovered Typst source draft with Find and Replace fields open while Apply source remains available.",
        width: 1098,
        height: 788,
      },
      {
        title: "Apply it and read the proof",
        instruction:
          "When the source compiles, Apply source makes it the manuscript. Proof typesets the pages when you open it; −, + and Fit change the view, and Preview PDF exports it. Go back to Source to adjust. The status line says the save is on this device; it does not promise the change has reached your account.",
        image: asset("typeset-proof"),
        alt: "A locally typeset proof with headings, a quote and a list, zoom controls, Fit, Preview PDF, and the Source applied — saved on this device status.",
        width: 1098,
        height: 788,
      },
    ],
  },
  folios: {
    title: "Find, export, share and recover a piece",
    summary:
      "Three folios, one of them nearly done. From the Library to a file, a public page, or last Tuesday's version.",
    note: "Publication and checkpoint recovery are shown at their review controls; neither action was submitted.",
    steps: [
      {
        title: "Pick a piece from the Library",
        instruction:
          "Open Library and select a folio card to return to that manuscript. Sort reorders the cards. The House link above them opens the shared context and standards that sit over every piece.",
        image: asset("library"),
        alt: "Library with three sample folio cards, Sort: Recent, The House, and Back to desk controls.",
        width: 1100,
        height: 470,
      },
      {
        title: "Take a copy in the format someone asked for",
        instruction:
          "Open File and choose PDF, Typst source, Markdown, HTML, Word or plain text. Include persona comments carries the editors' notes into the Markdown, HTML, Word and plain-text copies. Twyne backup (.json) is the one to keep somewhere safe: it restores the whole piece. Import brings a document or a backup back in.",
        image: asset("file-export"),
        alt: "The File menu with export formats, Include persona comments, Twyne backup, Import, and Share.",
        width: 244,
        height: 514,
      },
      {
        title: "Look before you publish",
        instruction:
          "File, then Share, shows the title and every destination before anything leaves. Publish now creates a public reading view; anyone with the link can read it. Download page for my domain saves a standalone page you host yourself. PDS and Micropub are separate destinations with their own connection controls.",
        image: asset("publication-review"),
        alt: "The sharing dialog with a sample title, Publish now, a standalone page download, Connect PDS and Publish with Micropub; nothing has been published.",
        width: 480,
        height: 810,
      },
      {
        title: "Compare before you restore",
        instruction:
          "In Write, open Review, then Version history. Save checkpoint keeps the current manuscript before a risky pass. Choose an earlier checkpoint to see what changed. Restore checkpoint asks first: Save current and restore protects today's draft before swapping; Keep current manuscript backs out.",
        image: asset("revision-restore"),
        alt: "Version history with Compare with, changed passages, and the Save current and restore or Keep current manuscript confirmation.",
        width: 463,
        height: 804,
      },
    ],
  },
  byok: {
    title: "Use the models you already pay for",
    summary:
      "Morgan has an API key and opinions about which model should read what. Connect once, set a default, then override only where it matters.",
    note: "Provider and model names are illustrative. API key fields are empty; no provider request or paid model run is shown.",
    steps: [
      {
        title: "Turn on Bring Your Own Key",
        instruction:
          "In Preferences, switch on Bring Your Own Key to reveal provider configuration. The switch alone changes nothing about how the room reads; you still need a configured provider before your own models are used.",
        image: asset("byok-switch"),
        alt: "Bring Your Own Key section with the advanced-mode switch turned off.",
        width: 848,
        height: 87,
      },
      {
        title: "Add the provider",
        instruction:
          "Select Add provider, pick one from the catalog or Use a custom OpenAI-compatible provider, and enter a name, the API key and any required endpoint. Choose the Generation API your server speaks. Cancel discards the form. The key stays in this browser; remote requests pass through Twyne to the provider you named.",
        image: asset("provider-form"),
        alt: "New provider form with sample name, empty API key, endpoint and Generation API controls, Add provider, and Cancel.",
        width: 848,
        height: 662,
      },
      {
        title: "Set a sensible default",
        instruction:
          "Under Default Models, choose the model a provider should use unless told otherwise. Refresh models fetches its current list. Connection details live separately in AI Providers. The browser voice model is a narration option, not a writing model, and needs its on-device voice pack.",
        image: asset("default-model"),
        alt: "Default Models with a sample provider's model selector, Refresh models, and the separate browser offline voice model.",
        width: 848,
        height: 404,
      },
      {
        title: "Override one feature, leave the rest",
        instruction:
          "Expand a row in Per-Feature Models to give that job its own Provider and Model. Morgan points Read My Draft at a slower, more careful model and leaves everything else on the default. Temperature and Max tokens can stay on auto. Reset to defaults removes the override for that row only.",
        image: asset("feature-models"),
        alt: "Per-Feature Models with Read My Draft expanded to show provider, model, temperature, max tokens, and Reset to defaults.",
        width: 848,
        height: 680,
      },
    ],
  },
  privacy: {
    title: "Decide what's public, and keep a copy you control",
    summary:
      "Readers can know Morgan writes. They don't need to know the streak, the email, or the unpublished folios.",
    note: "The linked-account Settings image uses a sample Not Organic profile with its Private email disclosure closed.",
    steps: [
      {
        title: "Choose which writing facts are public",
        instruction:
          "In Preferences, under the optional profile, find Public writing statistics. Each switch shares one fact. Writing streak set to Private hides it. Desk piece count shares a number without naming any folio. AI usage and costs never appear on a public profile.",
        image: asset("public-statistics"),
        alt: "Public writing statistics controls with all four sharing switches off and Writing streak set to Private.",
        width: 806,
        height: 329,
      },
      {
        title: "Keep the private details folded",
        instruction:
          "Your Not Organic account's Settings shows the public identity and the recovery state. Private email is a disclosure you open only when you need the address and close again after. The Recovery badge describes the account, not a manuscript backup.",
        image: asset("account-settings-private"),
        alt: "Not Organic account Settings with a sample public identity, an Active recovery badge, and the collapsed Private email disclosure; no email is visible.",
        width: 602,
        height: 476,
      },
      {
        title: "Know the difference between saved and synced",
        instruction:
          "Open Privacy ledger from the account menu. It lists what stays on this device, what leaves and where to. Manuscripts and checkpoints live in this browser; account sync has its own line. A Saved label means the device has it, not that another device does. Review privacy settings returns to Preferences.",
        image: asset("privacy-ledger"),
        alt: "Privacy ledger listing on-device manuscripts, account sync Off, AI providers, research, publishing and collaboration, and redacted analytics.",
        width: 1100,
        height: 900,
      },
      {
        title: "Restore from a backup you kept",
        instruction:
          "File, then Twyne backup (.json), writes a copy outside the browser. To recover, choose File, then Import, and pick the .twyne.json file. Import makes that content active, so export anything you want to keep first. Close leaves the current manuscript alone. Clearing browser storage can erase local work; the backup is the insurance.",
        image: asset("backup-import"),
        alt: "Import dialog listing supported documents and Twyne backups, with a file chooser and Close button.",
        width: 448,
        height: 262,
      },
    ],
  },
} satisfies ManualGuides;
