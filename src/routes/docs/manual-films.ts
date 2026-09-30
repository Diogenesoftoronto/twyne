import type { ManualFilm } from "./manual-video";

export const MANUAL_FILMS: Record<string, ManualFilm> = {
  "getting-started": {
    id: "newsreel",
    title: "Newsreel · A writing room in miniature",
    duration: "34 sec",
    description:
      "A short newsreel introduction to the brief and the five editorial voices.",
    transcript:
      "A black-and-white newsreel announces a writing room for the modern writer. Title cards introduce the sceptic, patron, scholar, copy chief and reader, then return to the brief that gives a draft its direction. This is an editorial introduction; the walkthrough below shows the current application controls.",
    width: 1280,
    height: 720,
    credit: "English · Editorial film · AI narration",
  },
  dossier: {
    id: "the-strike",
    title: "The Strike · Finding the right words",
    duration: "15 sec",
    description:
      "An animated headline is typed, questioned and revised: a short introduction to giving a piece a direction.",
    transcript:
      "A portrait-format film types and strikes through Twyne’s opening headlines, using the rhythm of correction to arrive at the editorial room. Music and typewriter sounds accompany the on-screen words. The dossier walkthrough below shows how to set the purpose of your own piece.",
    width: 720,
    height: 1280,
    credit: "English titles · Editorial film · Music and typewriter sounds",
  },
  house: {
    id: "house-context",
    title: "The House · Follow the context",
    duration: "18 sec",
    description:
      "Follow a sample folio through its collection, House defaults and register.",
    transcript:
      "The recording opens a sample folio in the House, inspects its inherited fields, visits the collection and House, then follows the register and assembled model context. It uses a sample manuscript and local application state. No account or model request is demonstrated.",
    width: 1152,
    height: 720,
    credit: "Silent walkthrough · Sample manuscript",
  },
  room: {
    id: "roll-call",
    title: "Roll Call · Meet the five editors",
    duration: "46 sec",
    description:
      "Hear each resident voice give its characteristic reading of a draft.",
    transcript:
      "The five editors arrive in turn. Mlle. Sceptique tests the assumption that a reader agrees. Sœur Encourageante protects the line with a pulse. Professeur Athenæum asks for evidence. M. Le Stylo cuts unnecessary words. Le Lecteur reports where he loses the thread. The cast returns together around one desk.",
    width: 1280,
    height: 720,
    credit: "English · Editorial film · AI voices",
  },
  marginalia: {
    id: "edited",
    title: "Edited · Five readings of one passage",
    duration: "46 sec",
    description:
      "Watch the room challenge an inflated opening, preserve a useful word and find a clearer promise.",
    transcript:
      "A sample promotional paragraph is typed onto the page. The copy chief cuts empty adjectives, the sceptic challenges an absolute claim, the scholar asks for the evidence behind a productivity figure, and the patron keeps the word ‘writing’. A revised sentence earns the reader’s attention. The film illustrates the editors’ distinct lenses; the walkthrough shows how a real margin conversation works.",
    width: 1280,
    height: 720,
    credit: "English · Staged editorial example · AI voices",
  },
  "manuscript-tools": {
    id: "source-workspace",
    title: "Source & proof · From draft to page",
    duration: "7 sec",
    description:
      "A sample manuscript moves through the source tools and its printed proof.",
    transcript:
      "The recording uses a sample draft to show the manuscript tools, source workspace and paginated proof. The source controls preserve the writer’s selection and the proof displays the editorial sheet. It demonstrates local tools, without publishing the manuscript or contacting a model.",
    width: 1152,
    height: 720,
    credit: "Silent walkthrough · Sample manuscript",
  },
  folios: {
    id: "sting",
    title: "The room’s signature",
    duration: "6 sec",
    description:
      "The griffin and wordmark close the editorial films. A small signature before your work leaves the desk.",
    transcript:
      "The Twyne griffin and wordmark appear in a six-second closing card with a brief musical signature. This is a brand film; the steps below show the export and publishing controls.",
    width: 1280,
    height: 720,
    credit: "Closing film · Musical signature",
  },
};
