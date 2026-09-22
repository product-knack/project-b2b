# Drag-to-Reorder Exercises — iOS Implementation Prompt

Build press-and-drag exercise reordering in the iOS app, matching the Android/RN app exactly. This replaces the old up/down chevron arrow buttons on BOTH pages. It is a pure UI feature — **zero backend changes**: exercise order is still persisted exactly as before when the form submits (the array order IS the saved order).

## Where it applies

1. **Trainer → Workout Log** (the log-a-workout composer): ONE flat list of exercise cards. Any exercise can be dragged to any position in the list.
2. **Trainer → Create Plan** (strength-training plan builder): exercises live inside body-part/workout sections. Dragging reorders **within the exercise's own section only** — a row can never be dragged into a different section.

Both pages are long scrollable forms (header fields on top, exercise list in the middle, wrap-up/RPE or plan meta below, sticky footer bar with Cancel/Submit at the bottom).

## The grip handle

- Every exercise row/card gets a **drag grip** as the FIRST element of its header row — positioned at the far left, BEFORE the index number badge (1, 2, 3…). Order left→right: `[grip] [index badge] [exercise name] … [close X]`.
- Grip visual: a small rounded rectangle (~34×30pt, corner radius 9) with a subtle orange tint — background orange at 7% opacity, 1px border orange at 22% opacity. Icon inside: two horizontal lines (like a ≡ with only 2 bars), muted color.
- While its row is being dragged, the grip highlights: background orange 20%, border orange 55%, icon full orange.
- The old up/down arrow buttons are REMOVED.

## Drag behavior (exact spec)

- **Activation: immediate.** Touch down on the grip starts the drag — no long-press delay. The grip claims the gesture; the page must NOT scroll from that touch.
- On drag start: medium impact haptic; the page's scroll view is frozen (user scrolling disabled) for the duration of the drag.
- The dragged card **lifts**: scale 1.02, strong drop shadow, rendered above its siblings (zIndex/elevation), and follows the finger vertically (translateY). Horizontal movement is ignored.
- **Live neighbor swapping**: as the dragged card's displacement crosses **55% of the next/previous row's height (+ the list's row gap)**, the two rows swap in the data array immediately — the neighbor jumps to its new slot, the dragged card keeps following the finger seamlessly. A selection haptic ticks on every swap. This repeats row by row as the finger keeps moving, so dragging across 5 rows produces 5 incremental swaps. The 55% threshold gives natural hysteresis (a card just swapped won't immediately swap back).
- Rows have **variable heights** (a collapsed workout-log row is short; a Create Plan card with 4 sets expanded is tall) — the swap threshold must use the actual measured height of the neighbor being crossed, not a fixed row height.
- **Edge auto-scroll**: while dragging, if the finger is within ~150pt of the top of the screen (below the app header) or ~190pt of the bottom (above the sticky footer bar), the page auto-scrolls in that direction on a timer (~30fps), speed proportional to how deep into the zone the finger is, capped (~16pt/tick). Any scroll performed must be folded back into the dragged card's offset so the card stays glued to the finger, and swap checks keep running during auto-scroll — this is what lets one drag carry an exercise across a list taller than the screen.
- **Release**: the row is already sitting in its final slot (because swapping was live); animate the small residual translation to zero (~130ms ease), drop the lift effect, re-enable page scrolling, light impact haptic.
- If the gesture is cancelled by the system, treat it exactly like release.
- A list with a single exercise: drag is a no-op (grip still shown).

## Algorithm (what the RN app does — port the logic)

State kept per drag (all outside view identity so re-renders/swaps mid-drag can't reset it):

```
heights[listId][index]  // measured height of each row, updated on layout
curIndex                // dragged row's CURRENT index (changes on each swap)
dy                      // raw finger displacement since touch down
adj                     // accumulated correction: swaps + auto-scroll
effective = dy + adj    // the translation actually applied to the card
```

Swap loop, run on every finger move AND every auto-scroll tick (loop, because a fast fling can cross several rows in one event):

```
step = heights[neighbor] + rowGap
if effective > 0 and curIndex < count-1 and effective > step*0.55:
    swap(curIndex, curIndex+1) in the data array
    swap heights[curIndex] and heights[curIndex+1]   // keep map consistent
    adj -= step; curIndex += 1; haptic tick; recompute effective; repeat
symmetrically for effective < 0 with the previous row (adj += step)
```

Auto-scroll tick (~every 32ms while dragging): compute zone delta from finger's absolute Y, scroll the page by delta (no animation), then fold the **observed** scroll-offset change into `adj` (observed, not intended — so clamping at content edges can't desync the card from the finger), then run the swap loop.

`rowGap`: Workout Log list uses 14, Create Plan sections use 12 (whatever your iOS layout uses — it's the vertical spacing between rows, it must be included in `step`).

## Gotchas we hit (don't repeat them)

- **Don't use a long-press-then-drag** on the whole card — card headers are tappable (collapse/expand) and full of inputs. A dedicated grip with immediate activation is cleaner and conflict-free.
- **Swap-as-you-cross, not drop-targets**: computing a drop index from absolute positions breaks with variable-height rows; incremental neighbor swaps with per-neighbor measured heights are robust.
- **Gesture state must survive re-renders**: every swap mutates the list state and re-renders; if any drag bookkeeping lives in view-local state that resets on re-render, the drag breaks mid-gesture. (In SwiftUI: beware `@GestureState`/view identity changes when the array reorders — keep drag state in an observable object keyed to the drag session, and give rows stable identity.)
- **Freeze the parent scroll** the moment the drag starts, or the scroll view fights the gesture (especially the initial vertical movement).
- **Auto-scroll on a timer**, not only on move events — a finger held still at the screen edge must keep scrolling.
- **Fold actual scroll changes into the drag offset** — if you add the intended delta instead of the observed one, the card drifts from the finger when the scroll clamps at the top/bottom of content.
- Create Plan: closing any expanded "advanced set" row on reorder avoids index-keyed expansion state pointing at the wrong row after a swap (the RN app closes it in its move function).

## What does NOT change

- No new backend calls, tables, or RPCs. Order is saved with the form exactly as before.
- Remove/X, collapse/expand, set editing all keep working unchanged.
- The index badges (1, 2, 3…) renumber automatically from array order after every swap.
