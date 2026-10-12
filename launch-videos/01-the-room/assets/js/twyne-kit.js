// Twyne film kit: seek-safe helpers shared by every launch film.
// Everything here only adds tweens/sets to a paused GSAP timeline, so any
// frame is reproducible from its time alone.
(function () {
  const TK = {};

  /** Split an element's text into per-character spans (spaces kept). */
  TK.chars = function (el) {
    const text = el.textContent;
    el.textContent = "";
    return Array.from(text).map((ch) => {
      const s = document.createElement("span");
      s.className = "tk-ch";
      s.textContent = ch;
      el.appendChild(s);
      return s;
    });
  };

  /**
   * Type an element's text in from `start`, `cps` characters per second.
   * Characters are display:none until typed so a following caret rides the
   * last glyph. Returns the time the last character lands.
   */
  TK.type = function (tl, el, start, { cps = 22, jitter = 0.35, seed = 7 } = {}) {
    const chars = TK.chars(el);
    tl.set(chars, { display: "none" }, 0);
    let t = start;
    let x = seed;
    const rand = () => ((x = (x * 16807) % 2147483647) / 2147483647);
    chars.forEach((c) => {
      tl.set(c, { display: "inline" }, t);
      // A typist's rhythm: uneven, with a beat after punctuation.
      const base = 1 / cps;
      t += base * (1 - jitter + 2 * jitter * rand()) + (/[.,:;!?]/.test(c.textContent) ? base * 3 : 0);
    });
    return t;
  };

  /** Draw a strike rule across `el` (which needs a .tk-strike child). */
  TK.strike = function (tl, el, at, { dur = 0.28, color = "#74685a" } = {}) {
    const rule = el.querySelector(".tk-strike");
    tl.fromTo(rule, { scaleX: 0 }, { scaleX: 1, duration: dur, ease: "power2.out" }, at);
    if (color) tl.to(el, { color, duration: dur }, at);
  };

  /** Blink a caret between two times with a finite repeat. */
  TK.blink = function (tl, caret, from, to, period = 0.9) {
    const n = Math.max(0, Math.floor((to - from) / period) - 1);
    tl.fromTo(caret, { opacity: 1 }, {
      opacity: 0, duration: period / 2, ease: "steps(1)", repeat: n * 2 + 1, yoyo: true,
    }, from);
    tl.set(caret, { opacity: 0 }, to);
  };

  /**
   * Captions from aligned words. `lines`: [{ at, words: [{text,start,end}], tone }]
   * Phrases break on sentence punctuation or `maxWords`. Each phrase fades in
   * just before its first word and out after its last.
   */
  TK.captions = function (tl, host, lines, { maxWords = 8, lead = 0.08, tail = 0.25 } = {}) {
    // Build every phrase first so each can be clamped against the next one.
    const phrases = [];
    lines.forEach((line) => {
      let phrase = [];
      const flush = () => {
        if (!phrase.length) return;
        phrases.push({
          text: phrase.map((w) => w.text).join(" "),
          tone: line.tone || "dark",
          a: line.at + phrase[0].start - lead,
          b: line.at + phrase[phrase.length - 1].end + tail,
        });
        phrase = [];
      };
      line.words.forEach((w, i) => {
        phrase.push(w);
        const endSentence = /[.!?]$/.test(w.text);
        const next = line.words[i + 1];
        const gap = next ? next.start - w.end : 0;
        if (endSentence || phrase.length >= maxWords || (/[,:;]$/.test(w.text) && phrase.length >= 3) || gap > 0.45) flush();
      });
      flush();
    });
    phrases.sort((p, q) => p.a - q.a);
    phrases.forEach((p, i) => {
      const next = phrases[i + 1];
      // Out before the next phrase comes in: never two captions at once.
      const out = next ? Math.min(p.b, next.a - 0.17) : p.b;
      const el = document.createElement("div");
      el.className = `tk-cap tk-cap--${p.tone}`;
      el.textContent = p.text;
      host.appendChild(el);
      tl.fromTo(el, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.16, ease: "power2.out" }, p.a);
      tl.to(el, { opacity: 0, duration: 0.14, ease: "power1.in" }, out);
    });
  };

  /** Slow push / Ken Burns on an inner wrapper, never on a timed clip. */
  TK.push = function (tl, el, start, dur, { from = 1.0, to = 1.08, x = 0, y = 0 } = {}) {
    tl.fromTo(el, { scale: from, xPercent: 0, yPercent: 0 }, { scale: to, xPercent: x, yPercent: y, duration: dur, ease: "none" }, start);
  };

  window.TK = TK;
})();
