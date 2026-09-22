# iOS handoff — Fix QHP "Baseline / Refresh N" label on the assessor screen

Paste this whole doc to the iOS app's coding assistant.

---

## 1. Symptom
On the QHP assessor screen (the "QHP — Complete assigned client QHPs" page: Upcoming / My QHPs
/ No Report / Missing), a client's QHP card shows the wrong cycle label. A client whose QHPs
were conducted by **different assessors** shows **"QHP Baseline"** on cards that should read
**"QHP Refresh 1/2/3…"**. In the worst case every card for that client reads "Baseline".

Concrete live example (client `bdc1d821-60d9-4d41-9371-9acdad85bd94`): 4 QHPs, one each by 4
assessors — 2025-10-15 (Baseline), 2026-03-10 (should be Refresh 1), 2026-05-10 (Refresh 2),
2026-08-07 (Refresh 3). Each assessor's screen showed their card as "Baseline".

## 2. Root cause
The assessor list query fetches only **this assessor's** rows
(`coach_assessment` filtered by `coach_id = <me>`), then computes the Baseline/Refresh index
**from that scoped subset**. Baseline/Refresh is meant to be the assessment's position in the
client's **full** QHP history (Nth QHP ever for that client), but a client's earlier QHPs are
usually done by other assessors, so they're missing from the subset. Result: the assessor's row
is index 0 of a 1-row subset → labeled "Baseline" instead of "Refresh N".

### Android reference (the bug)
`src/lib/qhpQueries.ts` — the assessor query does `.eq('coach_id', trainerId)`, then:
```ts
const byClient = new Map<string, any[]>();
rows.forEach((r) => { /* group the SCOPED rows by client */ });
const labelOf = (r) => {
  const hist = [...(byClient.get(r.client_id) ?? [])].sort(byDateAsc);
  const idx = hist.findIndex((h) => h.id === r.id);
  return idx <= 0 ? 'QHP Baseline' : `QHP Refresh ${idx}`;  // idx is within the SUBSET → wrong
};
```

## 3. The fix
Index the label against the client's **full** `coach_assessment` history across **all**
assessors — not the assessor-scoped rows. Fetch the whole per-client history (by `client_id`,
no `coach_id` filter) and index against that.

### RLS note (confirmed — this read is allowed)
An assessor CAN read the full `coach_assessment` history for a client (rows conducted by other
assessors). The app already relies on this in the "compare against an earlier QHP" / PDF
generation flow, which loads `coach_assessment` for the client with `.eq('client_id', …)` and
NO `coach_id` filter. So the fix needs no RLS/backend change. (A plain non-assessor trainer
reads 0 rows, but assessors — `can_conduct_assessments = true` — read all.)

### Android reference (the fix — shipped)
```ts
// Collect the client ids present in the assessor's rows:
const leadIds = [...new Set(rows.filter((r) => r.client_id).map((r) => r.client_id))];

// Fetch the FULL per-client history across all assessors, chunked:
const fullHistByClient = new Map<string, any[]>();
for (let i = 0; i < leadIds.length; i += 200) {
  const { data: histRows } = await supabase
    .from('coach_assessment')
    .select('id, client_id, assessment_date, assessment_time')
    .in('client_id', leadIds.slice(i, i + 200));   // NO coach_id filter
  (histRows ?? []).forEach((h) => {
    if (!h.client_id) return;
    if (!fullHistByClient.has(h.client_id)) fullHistByClient.set(h.client_id, []);
    fullHistByClient.get(h.client_id)!.push(h);
  });
}

const labelOf = (r) => {
  if (!r.client_id) return 'New Prospect';
  const hist = [...(fullHistByClient.get(r.client_id) ?? [])].sort((a, b) =>
    (a.assessment_date ?? '').localeCompare(b.assessment_date ?? '') ||
    (a.assessment_time ?? '').localeCompare(b.assessment_time ?? ''));
  const idx = hist.findIndex((h) => h.id === r.id);
  return idx <= 0 ? 'QHP Baseline' : `QHP Refresh ${idx}`;
};
```
Notes:
- Sort **ascending** by `assessment_date` (then `assessment_time`), so index 0 = the oldest =
  Baseline, index k = Refresh k.
- Count ALL coach_assessment rows for the client (scheduled + completed), not just completed —
  an upcoming card must still show the correct next cycle number.
- Keep the assessor-scoped `coach_id` filter for WHICH rows the assessor sees in the list; only
  the label INDEX must come from the full history.

## 4. Consistency check in the codebase
There is already a correct pattern to mirror: the client assessment-history hook used by the
comparison/PDF flow reads `coach_assessment` by `client_id` (unscoped) ascending and labels via
a 1-based `qhpFullLabel(idx + 1)` (index 1 = Baseline, 2 = Refresh 1, …). The list fix above is
the 0-based equivalent (`idx 0 = Baseline`). Make sure both label formats agree app-wide. The
client-detail "reports" tabs that index client-scoped `qhp_details` ascending are already
correct — do NOT change those.

## 5. Swift / native analog (if the iOS app is not React Native)
- Fetch the assessor's rows as today (scoped by coach id) for the list.
- Additionally fetch `coach_assessment` for the distinct `client_id`s with **no** coach filter:
  `try await supabase.from("coach_assessment").select("id,client_id,assessment_date,assessment_time").in("client_id", clientIds)`.
- Group by `client_id`, sort ascending by `(assessment_date, assessment_time)`, and set each
  card's label from `firstIndex(where: { $0.id == row.id })` → `idx == 0 ? "QHP Baseline" :
  "QHP Refresh \(idx)"`.

## 6. Verify
1. As an assessor who conducted a LATER QHP for a client whose earlier QHPs were by other
   assessors, the card shows the correct "QHP Refresh N", not "Baseline".
2. Test client `bdc1d821-60d9-4d41-9371-9acdad85bd94`: its 2026-08-07 QHP (assessor "manjusha
   shah") must read **QHP Refresh 3**; the 2026-03-10 one Refresh 1; 2026-05-10 Refresh 2; only
   the 2025-10-15 one is Baseline.
3. A brand-new client's first QHP still reads "QHP Baseline"; a walk-in with no client_id still
   reads "New Prospect".
4. Build/type-check clean.

## 7. One-line summary
The Baseline/Refresh number was computed from the assessor's own rows, not the client's full
QHP history, so any QHP done by a non-original assessor showed as "Baseline". Fix = index the
label against the client's full `coach_assessment` history (fetched by `client_id`, no
`coach_id` filter — an allowed read for assessors), sorted oldest-first.
