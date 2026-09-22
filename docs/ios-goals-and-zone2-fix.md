# iOS handoff — Weekly Goals rebuild + Zone 2 Cardio prompt in the workout log

Paste this whole doc to the iOS app's coding assistant. Both changes are shipped and
live-verified on Android (native 4.0 (23)). If the iOS Goals tab was ported from the same
early spec, it very likely has the SAME mock-data bug — check it first.

---

# Part 1 — Weekly Goals tab (trainer → client detail → Goals)

## Symptoms
1. Creating a "New Week" uses an old back-dated week (e.g. "29 Jun – 5 Jul") instead of the
   current week.
2. Zone 2 Cardio is treated as minutes/week (e.g. 150) when it must be TIMES per week
   (a small count like 2 or 3 — web placeholder "Times/week").
3. (Found on Android — verify on iOS) goals may not persist at all.

## Root cause on Android — check for the same on iOS
The entire "New Week" flow was LEFTOVER MOCK UI:
- The week list was a hardcoded demo array of date strings (that is where "29 Jun – 5 Jul"
  came from).
- The save handler wrote only to LOCAL component state — it never touched the database.
  Goals a trainer "saved" vanished on leaving the screen; only web-created rows ever showed.
- Zone 2 was labeled MIN/WK with a 150 default, but `z2c_target` is a sessions-per-week
  COUNT (the weekly-summary/compliance readers already treat it that way).

Audit the iOS Goals screen for the same three things: hardcoded week strings, a save that
does not hit `daily_goals`, and a minutes-based Zone 2 field.

## The data contract (`public.daily_goals`) — one row per client per week
- `client_id`, `week_start_date` ('YYYY-MM-DD', MONDAY, IST-anchored), `week_end_date`
  (start + 6 days)
- `sleep_target_hours` (numeric), `steps_target` (int), `nutrition_target` (int 0–10),
  `z2c_target` (int, sessions/week), `recommendation` (free text)
- `zone_2_did` (jsonb) — completions, Part 2 below. NEVER overwrite it from the goals form.
- Do NOT rely on a unique constraint on (client_id, week_start_date): select the existing
  row for each target week first — update it if present, insert otherwise (verified safe
  under trainer RLS: insert, update, delete all pass).

## Required behavior (matches web + shipped Android)
1. **Weeks are computed, never hardcoded**: current IST Monday-start week + the next 3.
   Monday math (Hermes-safe — iOS RN also runs Hermes, so NEVER use
   `new Date(date.toLocaleString(...))`, it returns Invalid Date there):
   ```ts
   const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
   const [y, m, d] = ymd.split('-').map(Number);
   const anchor = new Date(Date.UTC(y, m - 1, d, 12));          // noon UTC, DST-proof
   const dow = (anchor.getUTCDay() + 6) % 7;                     // Mon=0
   const monday = new Date(Date.UTC(y, m - 1, d - dow, 12));     // + i*7 for weeks 2..4
   ```
2. **Week picker**: the form can target ANY of the 4 weeks (Wk 1..Wk 4 chips with their
   start dates) — not just the current week.
3. **"Also apply to"**: per-week checkboxes for the weeks AFTER the selected one only
   (pick Wk 2 → offer Wk 3/Wk 4; pick Wk 4 → hide the row). Switching the primary week
   drops now-invalid selections.
4. **Fields**: Sleep hrs (e.g. 7.5) · Steps/day (e.g. 10000) · Nutrition 0–10 (clamped) ·
   Zone 2 Cardio TIMES/WK (integer, e.g. 3) · Recovery Recommendation (multiline free
   text — NOT a yes/no toggle; placeholder "Cognitive entertainment, Physiotherapy, Yoga, etc.").
5. **Validation**: at least ONE of the four numeric targets is required — block an
   all-empty save with "Set at least one target". Recommendation alone does not count.
6. **Persistence**: one row per selected week; `week_end_date` = start + 6d; update-in-place
   when the week exists (re-saving never duplicates).
7. **Cards**: show each saved week with its range, targets (Zone 2 as `3×/wk`, NOT minutes),
   the recommendation text, and a DELETE (trash) button (`delete from daily_goals where id`).

---

# Part 2 — Zone 2 Cardio prompt in the workout log

## What it does (web SleepNutritionPromptDialog contract)
When a trainer logs a workout for a client whose CURRENT week's goal has `z2c_target > 0`,
the log flow asks about Zone 2 cardio:
- Counter `logged/target this week` + a chip per logged session (day + optional minutes).
- "Yes, log a session" → pick a date + optional duration (minutes) → Log.
- Saving APPENDS to `daily_goals.zone_2_did` and is INDEPENDENT of the sleep/nutrition/
  steps submit (its own write, its own success state).

## The jsonb shape — must match exactly (web + Android + AI functions all read it)
```json
{ "sessions": [ { "date": "YYYY-MM-DD", "duration_minutes": 30 }, { "date": "YYYY-MM-DD" } ] }
```
- ONE entry per date. `duration_minutes` optional (omit the key when not given).
- MERGE, never replace: read the row fresh, spread the existing `zone_2_did`, append to
  its `sessions` array, update by the goal row `id`.

## Validation rules (enforced app-side; all verified live)
1. Date must be inside `week_start_date`..`week_end_date` → else reject
   ("Pick a date inside this goal week").
2. No duplicate date → reject ("A Zone 2 session is already logged for that date").
   In the day picker, render already-logged days disabled.
3. Fresh read before append (never append to stale state).

### Android reference (mutation core — mirror it)
```ts
const { data } = await supabase.from('daily_goals')
  .select('id, week_start_date, week_end_date, zone_2_did').eq('id', goalId).single();
const ws = String(data.week_start_date).slice(0, 10);
const we = String(data.week_end_date ?? '').slice(0, 10);
if (date < ws || (we && date > we)) throw new Error('Pick a date inside this goal week');
const prev = (typeof data.zone_2_did === 'object' && data.zone_2_did) ? data.zone_2_did : {};
const sessions = Array.isArray(prev.sessions) ? [...prev.sessions] : [];
if (sessions.some((s) => String(s?.date).slice(0, 10) === date)) throw new Error('A Zone 2 session is already logged for that date');
sessions.push(durationMin != null ? { date, duration_minutes: durationMin } : { date });
await supabase.from('daily_goals').update({ zone_2_did: { ...prev, sessions } }).eq('id', goalId);
```
Fetch side: query `daily_goals` by `client_id` + `week_start_date = <current IST Monday>`
(`maybeSingle`); treat "no row" or `z2c_target` null/0 as "no prompt".

## IMPROVEMENT to include (closes a web gap — Android already ships it)
The web only shows the Zone 2 block while sleep/nutrition data is missing; if those are
already logged, the trainer is never asked even when the week is under target. On iOS
(like Android): render the Zone 2 card **whenever the current week's target exists**,
independent of the health gate — during the check-in AND on the normal log form. After the
target is met, keep it visible in a "met" state ("Target met. Extra sessions can still be
logged") and still allow extra sessions.

## UI summary (Android shipped design — adapt to iOS patterns)
Card in the workout form: header (activity icon, "Zone 2 Cardio", badge `1/3 this week` —
amber under target, green when met) → chips of logged sessions (`Wed 5 · 30m`) → CTA
"Yes, log a session" → expands to: 7 day-chips for the goal week (logged days disabled),
optional minutes input, Cancel / Log. Success haptic; errors as alerts.

---

# Verify (both parts)
1. Goals: create Week 1 with sleep 7.5 / steps 10000 / Zone 2 = 3 → row lands in
   `daily_goals` with THIS week's Monday, visible on web too. Re-save the same week →
   updated, not duplicated. All-empty save → blocked. Wk 2 via the picker → Aug-17-style
   next-week row. Delete removes it.
2. Zone 2: with target 3 and 0 logged, open Log Workout → card shows `0/3` and prompts.
   Log Tue 30m → chip appears, web shows the same completion. Same date again → blocked.
   Date outside the week → blocked. With sleep/nutrition already logged, the card STILL
   shows while under target.
3. jsonb after two logs must look exactly like:
   `{"sessions":[{"date":"2026-08-11","duration_minutes":30},{"date":"2026-08-13"}]}`
