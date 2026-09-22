# Native handoff: member status on the Managers Leaderboard

Paste this whole doc to the odds-app (Expo / React Native) coding assistant. It describes a
change that shipped on the web app on 2026-09-18 (hub-track commit 66116275d) and must show
the same information in the native app. The backend part is already live; nothing needs to be
run in SQL.

---

## 1. What the owner asked for (web, verbatim)

> now in managers leaderboard, 1. show only active status trainers, if anyone is inactive
> mark (dont show the count of team member but its session added (with label inactive and
> its last session date so fix this accordingly

Behaviour that shipped on the web, and that the app must mirror exactly:

1. **TEAM** on a leaderboard row counts **active members only**. Inactive members are not in
   that number. A small grey bubble on the TEAM tile shows how many were left out.
2. An inactive member's **sessions, QHPs and referrals still add to the team totals** and to
   the score. Marking someone inactive never lowers a team's SESS / QHP / REFS or its rank.
3. In the expanded **Member Breakdown**, active members come first (sorted by sessions), then
   inactive members (also sorted by sessions). An inactive member's row is greyed and carries
   an **"Inactive"** badge plus a second line **"Last session 10 Sep 2026"** (or
   **"No session logged"** when no date is recorded).
4. Nothing else on the leaderboard changed: period resolution, month filter, weighted score,
   run rate, winner banner are all as before.

This is only the leaderboard. Two related things also shipped on the web the same day and are
listed at the end as optional parity (section 8).

---

## 2. Backend contract (already live on `agtjszjedaenclbzgjvi`)

### 2.1 `profiles.status`
- Column `status text NOT NULL DEFAULT 'active'`, values `'active' | 'inactive'`.
- Source of truth for whether a person is active. Only the admin Users page (web) toggles it.
  **The app must never write it from the leaderboard.**
- Migration in hub-track: `supabase/migrations/20260918090000_profiles_status.sql`.

### 2.2 `manager_score.members_status`
- Column `members_status jsonb NOT NULL DEFAULT '{}'`, **trigger-maintained**, one key per
  profile id listed in that team's `team_json`:

```json
{
  "3f2a…-profile-id": {
    "status": "inactive",
    "last_session_date": "2026-09-10",
    "updated_at": "2026-09-18T07:12:00Z"
  },
  "9c80…-profile-id": {
    "status": "active",
    "last_session_date": null,
    "updated_at": "2026-09-18T07:12:00Z"
  }
}
```

- `status` mirrors `profiles.status` at the time of the last trigger run.
- `last_session_date` is filled **only while the member is inactive**: the IST calendar date
  (`yyyy-MM-dd`) of `max(training_sessions.scheduled_at)` for that trainer where
  `coalesce(cancelled, false) = false`. It is `null` for active members and `null` for an
  inactive member who never logged a session.
- The **manager** (`manager_score.manager_id`) is **not** in `team_json`, so the manager has
  **no entry** in `members_status`. Their status must come from `profiles.status`; they never
  get a last session date from this column.
- Maintained by two triggers (hub-track migration
  `supabase/migrations/20260918110000_manager_score_members_status.sql`):
  - `trg_manager_score_members_status`: BEFORE INSERT OR UPDATE OF `team_json` on
    `manager_score` rebuilds the whole map from `team_json`. So the app's Manage Teams
    update of `team_json` (adminTools.tsx `useUpdateTeam`) automatically rebuilds it.
  - `trg_profiles_status_to_manager_score`: AFTER UPDATE OF `status` on `profiles` patches
    that one person's entry in every team whose `team_json` contains them.
  - Helpers (SECURITY DEFINER): `member_last_session_date(uuid)`,
    `member_status_entry(uuid)`, `rebuild_members_status(jsonb)`.
- Existing 13 teams were backfilled on 2026-09-18; at that moment every member was active.

### 2.3 Reading it from the app
- `supabase.from('manager_score').select('*')` already returns `members_status` (the app's
  `useManagerLeaderboard` and `useManagerTeam` both select `*`). No RLS change: the
  `manager_score` SELECT policy is unchanged (admin, crm and trainer roles).
- `profiles.status` must be **added to the explicit column list** wherever the app selects
  profiles for the leaderboard (today: `id, first_name, last_name, managers, expected_sessions`).
- Read-only probe to see the live shape (anon key, signed in as a trainer test account):

```sql
select id, team_name, team_json, members_status from manager_score order by created_at desc limit 5;
select id, first_name, last_name, status from profiles where status = 'inactive';
```

---

## 3. Web reference implementation (what to port)

### 3.1 Hook: `src/hooks/useManagerLeaderboard.ts` (hub-track)

Types:

```ts
export type MemberStatus = "active" | "inactive";

export interface MemberSessionBreakdown {
  memberId: string;
  memberName: string;
  sessionCount: number;
  referralCount: number;
  qhpCount: number;
  isManager: boolean;
  status: MemberStatus;              // profiles.status
  lastSessionDate: string | null;    // yyyy-MM-dd IST, inactive members only
}

export interface ManagerLeaderboardEntry {
  // ...
  memberCount: number;    // ACTIVE members only (manager included if active)
  inactiveCount: number;  // how many were left out of memberCount
  // ...
}
```

Profiles query adds `status`:

```ts
.select("id, first_name, last_name, managers, expected_sessions, status")
// ...
statusMap.set(p.id, p.status === "inactive" ? "inactive" : "active");
```

Status and date resolution per member (status from profiles first, `members_status` as the
fallback; the date only from `members_status`, and only when inactive):

```ts
const memberStatusOf = (team: any, memberId: string) => {
  const entry =
    team?.members_status && typeof team.members_status === "object"
      ? (team.members_status as Record<string, any>)[memberId]
      : undefined;
  const status: MemberStatus =
    statusMap.get(memberId) ?? (entry?.status === "inactive" ? "inactive" : "active");
  const last = entry?.last_session_date;
  return {
    status,
    lastSessionDate: status === "inactive" && typeof last === "string" && last ? last : null,
  };
};
```

Per-team loop. Note the totals are untouched by status; only the headcount changes:

```ts
let activeCount = 0, inactiveCount = 0;
for (const memberId of allTeamMembers) {          // allTeamMembers = [manager_id, ...team_json]
  const counts = countsMap.get(memberId) || { sessions: 0, referrals: 0, qhps: 0 };
  const isMgr = managerFlagMap.get(memberId) === true;
  const { status, lastSessionDate } = memberStatusOf(team, memberId);
  if (!isMgr) {                                   // manager-flagged people stay excluded, as before
    totalSessions += counts.sessions;
    totalReferrals += counts.referrals;
    totalQhps += counts.qhps;
  }
  if (status === "inactive") inactiveCount += 1; else activeCount += 1;
  memberBreakdown.push({ memberId, memberName: "", sessionCount: counts.sessions,
    referralCount: counts.referrals, qhpCount: counts.qhps, isManager: isMgr, status, lastSessionDate });
}
// ...
memberCount: activeCount,
inactiveCount,
totalSessions: totalSessions + totalQhps,   // unchanged formula
```

Rules to keep identical:
- `memberCount` counts the manager too, when the manager is active (same as before, where the
  manager was part of `allTeamMembers.length`).
- `isManager` (profiles.managers = true) and `status` are independent. A manager-flagged
  member who is inactive is excluded from totals (because of the flag, as before) and from
  TEAM (because of the status).
- A profile row that is missing (deleted user) is treated as active, like the web.
- The score and rank formula is unchanged: `(sessions + QHPs) * 0.7 + referrals * 0.3`.

### 3.2 Component: `src/components/trainer/ManagersLeaderboard.tsx` (hub-track)

TEAM tile:
- Shows `entry.memberCount`.
- When `entry.inactiveCount > 0`, a small grey bubble (top right of the tile, 14 px, muted
  background) shows `entry.inactiveCount`, and the tile's tooltip reads
  `"{memberCount} active member(s); {inactiveCount} inactive not counted (their sessions still add up)"`.

Member Breakdown header:
- When `entry.inactiveCount > 0`, right-aligned muted text:
  `"{memberCount} active · {inactiveCount} inactive (sessions still counted)"`.

Member rows:
- Sort: active first, then inactive; within each group by `sessionCount` desc.
  ```ts
  .sort((a, b) => {
    const ai = a.status === "inactive" ? 1 : 0, bi = b.status === "inactive" ? 1 : 0;
    if (ai !== bi) return ai - bi;
    return b.sessionCount - a.sessionCount;
  })
  ```
- The rank number (1, 2, 3, …) is the index in this sorted list, so inactive members take the
  last numbers.
- Inactive row styling: dashed border, 75% opacity (100% on hover), name in muted colour with a
  strike-through, an outline **"Inactive"** badge (uppercase, 8 to 9 px) next to the name, and
  a second line under the name:
  `Last session {format(parseISO(lastSessionDate), "d MMM yyyy")}` or `No session logged`
  when `lastSessionDate` is null.
- The three count chips (sessions, QHP, referrals) render exactly as for active members.

### 3.3 Super admin Trends and Breakdown card
`src/components/super-admin/analytics/ManagersLeaderboardCard.tsx` was not changed. It only uses
the breakdown to map member id to team id, so inactive members' daily sessions still land on
their team in the trend chart. The app has no equivalent screen.

---

## 4. Native port: files, lines, and the exact edits

All line numbers are as of 2026-09-18 in `odds-app`.

### 4.1 `src/lib/trainerQueries.ts`

**Types**
- `ManagerTeamMember` (line 1017) gains
  `status: 'active' | 'inactive'` and `lastSessionDate: string | null`.
  This type is shared with `useManagerTeam` (Managers Overview), so give the Overview
  mapping (line 1071) the two fields as well (see section 8.1 for what to do with them there;
  at minimum set them so the type checks).
- `ManagerEntry` (line 89): `teamSize` becomes **active members only**; add
  `inactiveCount: number`. Update the comment on `teamSize`.

**`useManagerLeaderboard` (line 1422)**
- Bump the query key to `['manager-leaderboard', 'v4', monthFilter]`. The React Query cache is
  persisted; rows hydrated from the old key would have no `status` / `inactiveCount` fields.
  (The `?? []` at trainer.tsx line 11544 exists for exactly this reason.)
- Profiles select (line 1458): add `status`:
  ```ts
  .select('id, first_name, last_name, managers, expected_sessions, status')
  ```
  and build `statusMap` next to `nameMap` / `isMgrMap`:
  ```ts
  const statusMap = new Map<string, 'active' | 'inactive'>();
  // inside the forEach:
  statusMap.set(p.id, p.status === 'inactive' ? 'inactive' : 'active');
  ```
- Add the resolver (port of the web `memberStatusOf`, section 3.1) above `rows`.
- Loop (lines 1473 to 1479):
  ```ts
  let activeCount = 0, inactiveCount = 0;
  for (const id of all) {
    const c = cMap.get(id) || { sessions: 0, referrals: 0, qhps: 0 };
    const isMgr = isMgrMap.get(id) === true;
    const { status, lastSessionDate } = memberStatusOf(t, id);
    if (status === 'inactive') inactiveCount += 1; else activeCount += 1;
    memberRows.push({ id, name: nameMap.get(id) || 'Member', sessions: c.sessions, qhps: c.qhps,
      referrals: c.referrals, isManager: isMgr, status, lastSessionDate });
    if (isMgr) continue;                 // unchanged: manager-flagged excluded from aggregates
    sessions += c.sessions; referrals += c.referrals; qhps += c.qhps;   // inactive still counted
  }
  ```
- Sort (line 1480): active first, then inactive, each by sessions desc (code in section 3.2).
- Entry (line 1486): `teamSize: activeCount, inactiveCount,`.

### 4.2 `src/screens/trainer.tsx`, `MgrDash` (line 11516)

- `liveMgr` map (line 11532): add `inactive: e.inactiveCount ?? 0` next to `team: e.teamSize`.
- `mgrDefs` fallback rows (line 11550): add `inactive: 0` so the shape matches.
- TEAM meta chip (lines 11741 to 11752): keep `['TEAM', String(m.team), C.purple]`. When
  `m.inactive > 0`, append a tiny muted suffix after the value, for example a `Mono`
  `+{m.inactive} inactive` at 8.5 px in `C.muted3`. That is the native version of the web's
  grey bubble.
- TEAM BREAKDOWN header (line 11757): when `m.inactive > 0`, change the right-hand `Mono`
  from `SESS · QHP · REF` to `{m.team} ACTIVE · {m.inactive} INACTIVE` on a first line and keep
  `SESS · QHP · REF` on a second, or put the active/inactive note as a small line under the
  header. Either is fine, the information is what matters.
- Member rows (lines 11761 to 11785). The rows are already in hook order, so sorting is done.
  For `tm.status === 'inactive'`:
  - card `opacity: 0.7`, `borderStyle: 'dashed'`, border colour `'rgba(255,255,255,0.12)'`;
  - name colour `C.muted2` with `textDecorationLine: 'line-through'`;
  - a small outline badge `Inactive` beside the name (same `Badge` component used for
    `Manager` at line 10885, colour `C.muted2`);
  - second line under the name (9.5 px, `C.muted3`):
    `Last session {fmt(tm.lastSessionDate)}` or `No session logged` when null.
    If the row is also `isManager`, show both lines (`Manager · not counted in totals` first).
  - the three counts render unchanged (inactive members' numbers are real and still count).
- Dashboard mini card (line 1721 to 1724, top 3 by sessions): no change, it shows `totalSessions`
  only, which is unaffected.

### 4.3 Date formatting
`lastSessionDate` is an IST calendar date string (`yyyy-MM-dd`), not a timestamp. Format it
without any timezone shift, the same way the period label is built in `MgrOverview`
(line 10992): `istDayLabel(d + 'T00:00:00Z')`, or a plain
`new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })`
which gives `10 Sep 2026`, the web's `d MMM yyyy`.

---

## 5. Edge cases (mirror the web, do not "improve" one side only)

| Case | Result on the web (mirror it) |
|---|---|
| Manager (`manager_id`) marked inactive | Status from `profiles.status`; no `members_status` entry, so `lastSessionDate` is null and the row reads "No session logged". TEAM drops by one. |
| Inactive member who never logged a session | Entry has `last_session_date: null`; row reads "No session logged". |
| Every member inactive | TEAM 0, SESS / QHP / REFS unchanged, row still ranks. |
| Profile row missing (deleted user) | Treated as active. |
| `members_status` is `{}` (should not happen after the backfill) | Status still comes from `profiles.status`; only the date is lost. |
| Member reactivated | Trigger sets `status: active`, `last_session_date: null`; the row returns to the active group with no date line. |
| Trigger lag | Status is read from `profiles` (source of truth), so the badge is right even if `members_status` is a moment behind; only the date could lag. |

---

## 6. Verification (read-only, per HANDOFF.md rules)

1. `node node_modules/typescript/bin/tsc --noEmit` must be 0 errors.
2. Bundle: `curl -s -o /dev/null -w "%{http_code}" "http://localhost:8081/index.bundle?platform=ios&dev=true&minify=false"` must be 200.
3. Node probe signed in as the trainer test account (creds near `src/screens/trainer.tsx` line 60):
   select `manager_score` `id, team_name, members_status` and confirm the map has one key per
   `team_json` id; select `profiles` `id, status` for those ids.
4. Scenario test with the owner: on the web admin Users page mark one trainer inactive, then
   open the app's Managers Dashboard (after the 2 min staleTime or a pull to refresh). Expect:
   TEAM down by one with the inactive suffix, SESS unchanged, that trainer at the bottom of the
   breakdown with the Inactive badge and the last session date. Mark them active again and
   confirm the row returns to normal.
5. Never write `profiles.status` or `manager_score.members_status` from the app.

---

## 7. Docs to update in the same turn

- No android feature file covers the Managers Leaderboard yet
  (`docs/features/android/trainer/` has plan-expiry-push, qhp-refresh-pending, qhp-voice-memo).
  Create `docs/features/android/trainer/managers-leaderboard.md` from `docs/features/_template.md`,
  add the index line in `docs/features/README.md`, and put this change in its change log with
  the date. Web counterpart for cross-reference: `docs/features/web/trainer/trainer-dashboard.md`,
  section "Managers Overview and the Managers Leaderboard", change log 2026-09-18.
- Memory rule "Managers Leaderboard parity" (formula parity between platforms) now also covers
  the member status rules above: fix together or never.

---

## 8. Optional parity (shipped on the web the same day, not part of the owner's leaderboard ask)

### 8.1 Managers Overview members list
Web `ManagersOverview` was **not** changed for status, so the app's `useManagerTeam` /
`MgrOverview` KPI "Members" and `MgrMemberRow` can stay as they are. Only add the two new fields
to the mapping at trainerQueries.ts line 1071 (`status` from `profiles.status`, which means
adding `status` to that select at line 1067; `lastSessionDate` from `team.members_status`) so
the shared `ManagerTeamMember` type compiles. If the owner later asks for it there, reuse the
same badge and date line.

### 8.2 Manage Teams (admin tools)
Web `src/pages/admin/ManageTeams.tsx` now reads `team.members_status` and shows, on each team
card: a muted **"N inactive"** badge next to the member count, and inactive member chips greyed
with the suffix `· inactive, last session 10 Sep 2026` (or `· inactive, no session logged`).
The app's equivalent is `src/screens/adminTools.tsx`: the member chips at line 483
(`(t.team_json ?? []).map((m) => <Badge key={m} text={nameOfId(m)} color={C.blue} />)`) and
the `ManagerTeam` type at line 255 (add `members_status: Record<string, { status?: string; last_session_date?: string | null }> | null`).
Same rendering rule: read `t.members_status[m]`, grey the chip and append the suffix when
`status === 'inactive'`.

### 8.3 Users page toggle
The web admin Users page has an Active / Inactive toggle per user (`profiles.status`, direct
update). The app has no Users page; nothing to port.
