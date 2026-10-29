/* My Crew member names (28 Oct 2026, owner: "all trainers' names are not showing in full; check"). The chips, the
   message bubbles, the flags cards and the @mention picker show the FIRST name; the day card's section header
   shows the full name. When two members of one team share a first name, the short form adds the surname's first
   letter ("Faizan O." and "Faizaan A."), so nobody is confused. Pure; no native imports; the iOS repo copies it. */

export type NamedMember = { id: string; name: string };

/** The first word of a name, "Member" when empty. */
export const firstWord = (name: string | null | undefined): string => {
  const w = String(name ?? '').trim().split(/\s+/)[0];
  return w || 'Member';
};

const surnameInitial = (name: string): string => {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return '';
  const last = parts[parts.length - 1];
  return last ? `${last[0].toUpperCase()}.` : '';
};

/** id -> short label for one team: first name, plus the surname initial when another member shares the first name. */
export const shortNames = (members: NamedMember[]): Record<string, string> => {
  const counts: Record<string, number> = {};
  for (const m of members) {
    const k = firstWord(m.name).toLowerCase();
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const out: Record<string, string> = {};
  for (const m of members) {
    const first = firstWord(m.name);
    const dup = (counts[first.toLowerCase()] ?? 0) > 1;
    const initial = dup ? surnameInitial(m.name) : '';
    out[m.id] = initial ? `${first} ${initial}` : first;
  }
  return out;
};

/** The short label for a member id; a sender outside the team falls back to their first name. */
export const shortNameFor = (map: Record<string, string> | null | undefined, id: string | null | undefined, name: string | null | undefined): string =>
  (id && map?.[id]) || firstWord(name);
