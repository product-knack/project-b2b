/* The load a trainer types on a plan set, as the numeric column takes it (19 Oct 2026, audit
   finding 3). "20", "20kg", "40 kg", "12,5" and "12.5" give the number; "BW", "bodyweight" or any
   text without a number give null (no external load). Before, text went to
   workout_plan_exercises.load_target as it was typed and the whole plan failed on the numeric
   cast ("invalid input syntax for type numeric"); an edit dropped the same text to null silently.
   Both paths use this one rule now. */
export function parseLoadTarget(raw: string | null | undefined): number | null {
  const s = String(raw ?? '').trim().replace(',', '.');
  if (!s) return null;
  const m = /\d+(?:\.\d+)?/.exec(s);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}
