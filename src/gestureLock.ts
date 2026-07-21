/* Shared flag: horizontal scrollers set this while touched so the page-level
   swipe-back gesture never competes with tab/chip scrolling. */
export const backSwipeLock = { locked: false };

/* Screens with internal sub-views (e.g. an open chat inside Messenger) register
   a handler here; the page-level swipe-back calls it instead of popping the
   route, so the gesture closes the sub-view first. */
export const backOverride: { handler: (() => void) | null } = { handler: null };
