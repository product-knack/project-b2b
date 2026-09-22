# iOS handoff — (1) Daily Meals in the Trends tab, (2) client-name chip on every exercise in couple sessions

Paste this whole doc to the iOS app's coding assistant. Both features are shipped and
verified on Android; mirror them.

---

# Feature 1 — "Daily Meals" section in Trends (trainer → client detail → Trends tab)

## What it is
The Trends tab's per-day detail gains a **DAILY MEALS** section showing what the client
logged in the **B2C app** that day. Data comes from the SAME row the tab already reads
for nutrition rating and steps: `nutrition_tracker` for that `rating_date`, column
**`meals_analysis`** (jsonb array). No new query is needed if the weekly fetch already
selects `meals_analysis` — just render it; otherwise add the column to the existing
select.

## Verified live data shape (one array entry per meal)
```json
{
  "id": "1786961656369",
  "meal_name": "1 besan chilla with crushed loki and beetroot",
  "calories": 180,
  "protein": 8.5,
  "carbs": 30,
  "fats": 2.5,
  "fiber": 5,
  "timestamp": "2026-08-17T10:14:16.369Z",
  "confidence": 90
}
```
Guard everything: entries can miss any field; treat non-numeric macros as 0; fall back to
"Meal" when `meal_name` is empty; `meals_analysis` itself can be null or a non-array
(coerce with an Array.isArray check).

## Behavior (Android shipped design)
For the day selected in the 7-day matrix:
- Header: `DAILY MEALS · <count>` with the day's total kcal on the right.
- One card per meal, **sorted by `timestamp` ascending**: meal name (up to 2 lines),
  IST log time (e.g. `3:44 PM`), and macro chips: `180 kcal`, `P 8.5g`, `C 30g`,
  `F 2.5g`, plus a fiber chip only when fiber > 0.
- Footer line: `Day total: 182 kcal · P 8.8g · C 30g · F 2.5g` (sums across the day).
- Empty state: "No meals logged this day."
- The section keys off the same `rating_date` used for the nutrition rating, so meals
  always match the selected day.

## Notes
- Times display in IST (Asia/Kolkata). On Hermes, never derive them via
  `new Date(toLocaleString(...))` — use `Intl.DateTimeFormat` with `timeZone`.
- Round macros to 1 decimal; calories to whole numbers.

---

# Feature 2 — couple sessions: whose exercise is this, on EVERY card

## The problem
In a couple/parallel workout log (two clients, one shared session), the only ownership
indicator is the "Logging for <name>" banner at the top — it scrolls away, and midway
through a long exercise list the trainer can no longer tell whose values they are
entering. Wrong-client entries follow.

## The fix (Android shipped design)
When a pair is active, EVERY exercise card carries a small owner chip pinned at its
top-left: user icon + **"<FirstName>'s exercise"** (accent color, single line,
max-width capped). Rules:
- Rendered ONLY while a couple/parallel session is active — solo logs stay untouched.
- The chip reads the CURRENT form's client, so tapping the client-switch instantly
  re-stamps every card to the other client (each client keeps their own form; the chip
  always matches the values shown).
- First name only (keeps the chip compact; partners rarely share a first name).

### Android reference (inside each exercise card, first child before the header row)
```tsx
{pairNames ? (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
                 paddingVertical: 3.5, paddingHorizontal: 10, borderRadius: 999,
                 backgroundColor: hexA(C.orange, 0.11), borderWidth: 1, borderColor: hexA(C.orange, 0.35) }}>
    <Icon name="user" size={10} color={C.orange} />
    <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: C.orange, maxWidth: 160 }}>
      {clientName.split(' ')[0]}'s exercise
    </Text>
  </View>
) : null}
```
(`pairNames` = the couple-session state; `clientName` = the client whose form is on
screen. Use the iOS equivalents.)

## Verify
1. Trends: pick a client with B2C meal logs → select a logged day → meals listed in time
   order with correct macros and a matching day total; empty day shows the empty state.
2. Couple log: start a parallel session → every exercise card shows "<A>'s exercise";
   switch to the partner → every card instantly shows "<B>'s exercise"; save flow
   unchanged. Solo log: no chips anywhere.
