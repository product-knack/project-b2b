# iOS handoff — Log Workout: Add Exercise sheet overlaps on small iPhones

Paste this to the iOS app's coding assistant. Fixed and verified on Android; the iOS
sheet has the same structure and the bug reproduces there on small screens (SE/mini/8).

## Symptom
Log Workout → Add Exercise sheet → "Add Custom Exercise". On small iPhones with the
keyboard open, the floating "N Selected — Continue" bar rides up and OVERLAPS the custom
form's "Add Exercise" button, and the area cannot scroll — the two buttons sit on top of
each other and the flow is stuck.

## Root cause (layout math, not a glitch)
The sheet is a fixed-height bottom sheet (~82% of screen) containing:
1. a STATIC header stack (title, search, the custom-exercise card) — NOT inside the
   scrollable list, so it can never scroll;
2. the exercise list (the only scrollable part);
3. a Continue bar ABSOLUTELY POSITIONED at `bottom: keyboardHeight + 10`.

With the keyboard up on a small screen, the visible sheet area shrinks to less than the
static stack's height; the absolutely-positioned bar floats up into the custom card.
Overlap is guaranteed by construction — no amount of padding fixes it.

## The fix (structural — mirror the Android change)
While the custom-exercise form is open:
1. The sheet renders ONLY the custom form (title row stays; search, list, and tabs hide).
2. The form lives inside a ScrollView with keyboard-aware bottom padding
   (`paddingBottom = keyboardHeight + 24`, `keyboardShouldPersistTaps="handled"`), so even
   the smallest screen can scroll the form clear of the keyboard.
3. The floating Continue bar is HIDDEN entirely (`customFormOpen ? null : <bar/>`).
   It returns the moment the form closes (Add or X) — nothing else changes.

When the form is closed, the original layout stands: search + list + floating bar, with
the list's content padding keeping rows clear of the bar.

Result: the overlap is impossible on any screen size, the custom form is always fully
reachable and scrollable, and the normal picking flow is untouched.

## Verify (on the smallest supported iPhone / smallest simulator)
1. Add Exercise → Add Custom Exercise → keyboard opens: only the form is visible, no
   Continue bar, "Add Exercise" button reachable; the form scrolls if needed.
2. Type a name → Add: form closes, exercise added, list + "N Selected — Continue" return.
3. X on the form: same return, nothing added.
4. Normal flow (no custom form): list scrolls clear of the bar; bar floats above the
   keyboard while searching.
