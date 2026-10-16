/* One sound at a time across the whole app (16 Oct 2026, user: "if play one and we
   click another play the previous automatically stops"). Every player that a person
   starts (the client summaries, session voice notes, voice memos, messenger voice
   messages, the Odds Nucleus article audio) claims the focus right before it plays;
   whoever held it is told to go quiet (pause or stop, its own choice). A player gives
   the focus back when it stops on its own or unmounts. Navigation turn cues do not
   take part: they are short and must never cut a summary off. Pure module state,
   no React, no native calls: tested in node. */
export type AudioHolder = { silence: () => void };

let current: AudioHolder | null = null;

/** Take the focus for `holder`; the previous holder (if another one) is silenced first. */
export function claimAudioFocus(holder: AudioHolder): void {
  if (current && current !== holder) {
    const prev = current;
    current = null; // set before silencing, so a holder that releases inside silence() cannot loop
    try { prev.silence(); } catch { /* a released player: nothing left to silence */ }
  }
  current = holder;
}

/** Give the focus back (only when `holder` still has it). */
export function releaseAudioFocus(holder: AudioHolder): void {
  if (current === holder) current = null;
}

export const holdsAudioFocus = (holder: AudioHolder): boolean => current === holder;
