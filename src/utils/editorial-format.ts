/**
 * Editorial dateline — formatted like a print magazine masthead.
 * e.g. "Vol. I · No. 117 · Sunday, the 26th of April, 2026"
 *
 * Shared by the live editor masthead and the landing preview so the two
 * never disagree about what the date line looks like.
 */
export function editorialDateline(now = new Date()): string {
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const day = now.getDate();
  const ordinal = (n: number) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  const start = new Date(now.getFullYear(), 0, 0);
  const diff = (now.getTime() - start.getTime()) / 86400000;
  const dayOfYear = Math.floor(diff);
  return `Vol. I · No. ${dayOfYear} · ${days[now.getDay()]}, the ${ordinal(day)} of ${months[now.getMonth()]}, ${now.getFullYear()}`;
}

/** Folio label numerals: Folio I, Folio II, … past X, plain numbers. */
export function folioNumeral(index: number): string {
  return (
    ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][index] ??
    String(index + 1)
  );
}
