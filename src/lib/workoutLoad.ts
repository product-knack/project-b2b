/* Load box on the workout log (2 Nov 2026, owner: "users say the workout log form is not smooth").
   The load box used the full letter keyboard in capitals so trainers could type bodyweight loads like "BW+5";
   every set then needed a "?123" tap, and switching between the reps number pad and the letter keyboard made the
   page jump. The box now takes numbers (decimal pad) and a BW button next to it marks a bodyweight load: the
   stored text is unchanged ("BW", "BW+5", "20"), so the server, the web and older logs read it as before.
   Pure: no imports, node-tested in tests/rules/workout_load_test.js; the iOS app copies this file byte for byte. */

export type SplitLoad = { bw: boolean; extra: string };

/** "BW+5" -> { bw: true, extra: "5" }; "BW" -> { bw: true, extra: "" }; "20" -> { bw: false, extra: "20" }.
    Case and spaces do not matter ("bw + 2.5"). Any other text stays as it is in extra. */
export const splitBodyweightLoad = (load: string | null | undefined): SplitLoad => {
  const s = String(load ?? '').trim();
  const m = /^bw(?![a-z])\s*(?:\+\s*)?(.*)$/i.exec(s);
  if (!m) return { bw: false, extra: s };
  return { bw: true, extra: m[1].trim() };
};

/** The text saved for the set: "BW", "BW+<extra>" or just the number. */
export const joinBodyweightLoad = (bw: boolean, extra: string | null | undefined): string => {
  const e = String(extra ?? '').trim();
  return bw ? (e ? `BW+${e}` : 'BW') : e;
};

/** Digits and one decimal point, for number boxes (load, hours slept, litres). */
export const decimalOnly = (t: string): string => String(t ?? '').replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');
