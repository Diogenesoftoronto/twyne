/**
 * Server-only OpenGraph card renderer.
 *
 * Draws a 1200×630 editorial card for a published piece — Twyne masthead,
 * the article title, its brief summary, and the author byline — on the same
 * aged-newsprint palette as the site, then rasterizes it to PNG so social
 * scrapers (which don't run JS or accept SVG) get a real image per article.
 *
 * Rendering is done with a hand-built SVG + @resvg/resvg-js rather than
 * satori: the card is a fixed layout with a handful of text blocks, so the
 * only non-trivial bit is greedy word-wrapping, which we do below.
 *
 * This module imports `node:fs` and the native resvg binding, so it must only
 * ever be pulled in from a server context (a route `onGet`), never a component.
 */

import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

// Editorial palette — kept in sync with the CSS custom properties in
// src/global.css (--color-paper, --color-ink, …).
const PAPER = "#f4ecd8";
const PAPER_RULE = "#ddd0b1";
const INK = "#1f1b16";
const INK_LIGHT = "#4a3f33";
const INK_MUTED = "#8a7e6c";
const VERMILION = "#c1272d";
const MUSTARD = "#d4a017";

const WIDTH = 1200;
const HEIGHT = 630;
const MARGIN = 90;
const CONTENT_WIDTH = WIDTH - MARGIN * 2;

// Absolute paths to the two static Fraunces cuts committed under assets/og.
// process.cwd() is the repo root under both `vite --mode ssr` (dev) and
// `node server.js` (Railway), where those committed files live on disk.
const FONT_FILES = [
  join(process.cwd(), "assets", "og", "fraunces-display.ttf"),
  join(process.cwd(), "assets", "og", "fraunces-text.ttf"),
];

function escapeXml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Greedy word-wrap. Width is estimated from an average glyph-width factor for
 * the font size — good enough for a card, and we cap the line count so an
 * over-long title truncates with an ellipsis rather than overflowing.
 */
function wrapLines(
  text: string,
  fontSize: number,
  maxWidth: number,
  maxLines: number,
  widthFactor: number,
): string[] {
  const maxChars = Math.floor(maxWidth / (fontSize * widthFactor));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);

  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (last.length > maxChars) {
      lines[maxLines - 1] = `${last.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
    }
  }
  return lines;
}

export interface OgCardInput {
  title: string;
  summary: string;
  author: string | null;
  kind?: "post" | "blog";
}

function buildSvg({ title, summary, author, kind }: OgCardInput): string {
  const mastheadY = MARGIN + 6;
  const kicker = kind === "blog" ? "Field Notes" : "An Editorial Room";

  // Byline is anchored to the bottom; everything else is laid out above it so
  // nothing can collide with it no matter how long the title runs.
  const bylineRuleY = HEIGHT - 96;
  const bylineTextY = HEIGHT - 48;

  // Title: bigger type for short titles, stepping down as it grows.
  const titleSize = title.length > 70 ? 62 : title.length > 40 ? 74 : 88;
  const titleLineHeight = titleSize * 1.07;
  const titleLines = wrapLines(title, titleSize, CONTENT_WIDTH, 3, 0.52);

  // The title block is pinned near this baseline when it's tall; short content
  // is centered in the region between the masthead rule and the byline rule
  // (computed via `shift` below) so it never floats in a sea of empty paper.
  const titleTopBase = 236;
  const titleBottom =
    titleTopBase + (titleLines.length - 1) * titleLineHeight + titleSize * 0.3;

  // Fit as many summary lines as the gap between the title and the byline
  // rule allows (0–2), so a 3-line title simply gets a shorter summary.
  const summarySize = 30;
  const summaryLineHeight = 42;
  const summaryTopBase = titleBottom + 44;
  const summaryRoom = bylineRuleY - 26 - summaryTopBase;
  const maxSummaryLines = Math.max(
    0,
    Math.min(2, Math.floor(summaryRoom / summaryLineHeight) + 1),
  );
  const summaryLines =
    summary && maxSummaryLines > 0
      ? wrapLines(summary, summarySize, CONTENT_WIDTH, maxSummaryLines, 0.5)
      : [];

  const contentBottom =
    summaryLines.length > 0
      ? summaryTopBase + (summaryLines.length - 1) * summaryLineHeight + 8
      : titleBottom;
  const regionBottom = bylineRuleY - 34;
  const shift = Math.max(0, (regionBottom - contentBottom) / 2);

  const titleTop = titleTopBase + shift;
  const summaryTop = summaryTopBase + shift;

  const titleTspans = titleLines
    .map(
      (line, i) =>
        `<tspan x="${MARGIN}" y="${titleTop + i * titleLineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  const summaryTspans = summaryLines
    .map(
      (line, i) =>
        `<tspan x="${MARGIN}" y="${summaryTop + i * summaryLineHeight}">${escapeXml(line)}</tspan>`,
    )
    .join("");

  const byline = author ? `— ${author}` : "twyne.love";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>
  <rect x="0" y="0" width="${WIDTH}" height="10" fill="${VERMILION}"/>

  <!-- Masthead -->
  <text x="${MARGIN}" y="${mastheadY + 40}" font-family="Fraunces" font-weight="660"
        font-size="34" letter-spacing="14" fill="${INK}">TWYNE</text>
  <text x="${WIDTH - MARGIN}" y="${mastheadY + 40}" text-anchor="end" font-family="Fraunces"
        font-weight="450" font-size="22" letter-spacing="6" fill="${INK_MUTED}">${escapeXml(
          kicker.toUpperCase(),
        )}</text>
  <rect x="${MARGIN}" y="${mastheadY + 66}" width="${CONTENT_WIDTH}" height="3" fill="${PAPER_RULE}"/>
  <rect x="${MARGIN}" y="${mastheadY + 66}" width="120" height="3" fill="${MUSTARD}"/>

  <!-- Title -->
  <text font-family="Fraunces" font-weight="660" font-size="${titleSize}"
        fill="${INK}" letter-spacing="-0.5">${titleTspans}</text>

  <!-- Summary -->
  <text font-family="Fraunces" font-weight="450" font-size="30" font-style="italic"
        fill="${INK_LIGHT}">${summaryTspans}</text>

  <!-- Byline -->
  <rect x="${MARGIN}" y="${bylineRuleY}" width="${CONTENT_WIDTH}" height="2" fill="${PAPER_RULE}"/>
  <text x="${MARGIN}" y="${bylineTextY}" font-family="Fraunces" font-weight="450"
        font-size="30" fill="${INK_MUTED}">${escapeXml(byline)}</text>
</svg>`;
}

export function renderArticleOgPng(input: OgCardInput): Buffer {
  const svg = buildSvg(input);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
    background: PAPER,
    font: {
      fontFiles: FONT_FILES,
      defaultFontFamily: "Fraunces",
      loadSystemFonts: false,
    },
  });
  return Buffer.from(resvg.render().asPng());
}
