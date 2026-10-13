# iOS handoff 4 of N: Managers Leaderboard, member status (18 Sep 2026)

Paste this whole doc to the iOS app's coding assistant. A team member can now be marked **inactive** (on the
web admin Users page). On the Managers Leaderboard, TEAM counts active members only, inactive members stay
in the breakdown greyed with an "Inactive" badge and their last session date, and their sessions / QHPs /
referrals still count in the team totals and the score. Shipped on the web (hub-track 66116275d) and on
Android (odds-app) on 18 Sep 2026.

---

## 0. Ground rules and how to start

1. **The backend is LIVE and SHARED** (Supabase project `agtjszjedaenclbzgjvi`). Do NOT create, alter or run
   any SQL. **The app never writes `profiles.status` or `manager_score.members_status`.**
2. **Reference implementation** in the Android React Native repo `odds-app`: `src/lib/trainerQueries.ts`
   (`useManagerLeaderboard`, `memberStatusOf`, `sortMembersByStatus`, types `ManagerEntry` and
   `ManagerTeamMember`), `src/screens/trainer.tsx` (`MgrDash`: the TEAM chip, the TEAM BREAKDOWN rows), and
   `src/screens/adminTools.tsx` (Manage Teams cards, section 5).
3. **First, find the iOS Managers Leaderboard** (search for `manager_score` and `get_manager_team_counts`).
   This doc is the delta on top of it. Section 2.3 has the full computation in case the iOS version differs
   from Android; the score formula and ranking must stay identical on every platform.
4. No em dashes in user copy.

---

## 1. What the user sees

1. **TEAM** on each leaderboard card counts **active members only** (the manager counts too when active).
   When a team has inactive members, a tiny muted suffix follows the TEAM number: "+1 inactive".
2. SESS, QHP, REFERRALS and the rank **do not change** when someone is marked inactive: an inactive member's
   numbers still add up.
3. The expanded **TEAM BREAKDOWN**:
   - under the header, when the team has inactive members, a muted caps line
     "4 ACTIVE · 1 INACTIVE (SESSIONS STILL COUNTED)";
   - order: active members first, then inactive; sessions descending within each group (rank numbers follow
     that order, so inactive members take the last numbers);
   - an inactive row: 70% opacity, a dashed border `rgba(255,255,255,0.12)`, the name in muted grey with a
     strike-through, a small grey badge "Inactive" next to the name, and a second line (9.5, muted3)
     "Last session 10 Sep 2026" or "No session logged";
   - a manager-flagged member keeps the purple line "Manager · not counted in totals"; if also inactive,
     show both lines (manager line first);
   - the three counts (SESS in orange, QHP in gold, REF in green; muted when 0) render exactly as for active
     members.
4. The home-screen mini leaderboard (top 3 by sessions) does not change.

---

## 2. Backend contract (live)

### 2.1 `profiles.status`
`text NOT NULL DEFAULT 'active'`, values `'active' | 'inactive'`. The source of truth. Only the web admin
Users page toggles it.

### 2.2 `manager_score.members_status` (trigger-maintained jsonb)
One key per profile id in that team's `team_json` (the manager is NOT in `team_json`, so the manager has no
entry):
```json
{ "3f2a...": { "status": "inactive", "last_session_date": "2026-09-10", "updated_at": "2026-09-18T07:12:00Z" },
  "9c80...": { "status": "active",   "last_session_date": null,         "updated_at": "2026-09-18T07:12:00Z" } }
```
`last_session_date` = the IST calendar date of the member's latest non-cancelled `training_sessions.scheduled_at`,
filled ONLY while inactive (null for active members and for an inactive member who never logged).
Triggers: `trg_manager_score_members_status` rebuilds the map on any insert / `team_json` update (so an app
Manage Teams save rebuilds it too); `trg_profiles_status_to_manager_score` patches the person in every team
when `profiles.status` changes. Live on 18 Sep 2026: 13 teams, every map with exactly one key per member.

### 2.3 The computation (identical on web and Android)
```ts
// 1. teams: manager_score select('*') order created_at desc. Keep rows with no team_end or team_end >= today;
//    if none, the rows sharing the latest team_start. Period = first row's team_start / team_end.
// 2. counts: rpc('get_manager_team_counts', { member_ids, period_start, period_end })
//    -> rows { member_id, session_count, referral_count, qhp_count } (month filter carves the range from the
//    competition start: month 1 / 2 / 3 = calendar months starting at team_start's month, capped to the period).
// 3. profiles: select('id, first_name, last_name, managers, expected_sessions, status').in('id', memberIds)
const statusMap = new Map(profiles.map((p) => [p.id, p.status === 'inactive' ? 'inactive' : 'active']));

function memberStatusOf(team, memberId, statusMap) {
  const entry = team?.members_status && typeof team.members_status === 'object' ? team.members_status[memberId] : undefined;
  const status = statusMap.get(memberId) ?? (entry?.status === 'inactive' ? 'inactive' : 'active');
  const last = entry?.last_session_date;
  return { status, lastSessionDate: status === 'inactive' && typeof last === 'string' && last ? last : null };
}

// per team:
const all = team.manager_id ? [team.manager_id, ...team.team_json] : team.team_json;
let sessions = 0, referrals = 0, qhps = 0, activeCount = 0, inactiveCount = 0;
for (const id of all) {
  const c = counts.get(id) ?? { sessions: 0, referrals: 0, qhps: 0 };
  const isMgr = isMgrMap.get(id) === true;                       // profiles.managers
  const { status, lastSessionDate } = memberStatusOf(team, id, statusMap);
  if (status === 'inactive') inactiveCount += 1; else activeCount += 1;   // headcount only
  members.push({ id, name, sessions: c.sessions, qhps: c.qhps, referrals: c.referrals, isManager: isMgr, status, lastSessionDate });
  if (isMgr) continue;                                           // manager-flagged excluded from totals (unchanged)
  sessions += c.sessions; referrals += c.referrals; qhps += c.qhps;   // inactive members STILL counted
}
members.sort((a, b) => {                                         // active first, then sessions desc
  const ai = a.status === 'inactive' ? 1 : 0, bi = b.status === 'inactive' ? 1 : 0;
  return ai !== bi ? ai - bi : b.sessions - a.sessions;
});
entry = { ..., teamSize: activeCount, inactiveCount, totalSessions: sessions + qhps, qhpCount: qhps, referralsCount: referrals, members };
// rank by weighted = (sessions + qhps) * 0.7 + referrals * 0.3, descending.
```
Rules to keep identical:
- A missing profile (deleted user) reads as active.
- `isManager` (profiles.managers) and `status` are independent.
- The date comes only from `members_status` and only when inactive, so an inactive manager always reads
  "No session logged".

### 2.4 Caching
If the iOS app persists the react-query cache, **bump the leaderboard query key version** (Android went
`['manager-leaderboard', 'v3', filter]` to `['manager-leaderboard', 'v4', filter]`) so rows restored from
disk always carry `status` / `inactiveCount`, and read `inactiveCount ?? 0` defensively. staleTime stays
2 minutes. A status change on the web shows after that window or a pull to refresh; no invalidation needed.

### 2.5 Date formatting
`lastSessionDate` is a calendar date string (`yyyy-MM-dd`), never a timestamp. Format without a timezone
shift: `new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })`
gives "10 Sep 2026".

---

## 3. Edge cases (mirror, never "improve" on one platform)
| Case | Result |
|---|---|
| The manager (`manager_id`) is inactive | Status from `profiles.status`; no map entry, so "No session logged". TEAM drops by one. |
| Inactive member who never logged | "No session logged". |
| Every member inactive | TEAM 0, totals unchanged, the team still ranks. |
| `members_status` is `{}` | Status still from `profiles.status`; only the date is missing. |
| Member reactivated | Back in the active group, no date line. |

## 4. Offline fallback rows
If the iOS leaderboard has hard-coded fallback rows for offline, give them `inactive: 0` so the UI never
shows a status it cannot know.

## 5. Optional parity: Manage Teams (admin tools), if iOS has it
Each team card: a grey badge "N inactive" next to the rank / sessions badges when N > 0 (N = `team_json` ids
whose `members_status` entry is inactive), and each inactive member chip greyed with the text
"{Name} · inactive, last session 10 Sep 2026" or "{Name} · inactive, no session logged" (active chips stay
blue with the plain name). Add `members_status` to the team type.

## 6. Probe (read-only, any trainer or admin login)
```sql
select id, team_name, team_json, members_status from manager_score order by created_at desc limit 5;
select id, first_name, last_name, status from profiles where status = 'inactive';
```
Each `members_status` should have one key per `team_json` id.

## 7. Acceptance test
1. Ask the user to mark one trainer inactive on the web admin Users page.
2. Open the Managers Dashboard (after 2 minutes or pull to refresh): that team's TEAM is one lower with
   "+1 inactive"; SESS / QHP / REFERRALS and the rank are unchanged.
3. Expand the breakdown: the caps line "N ACTIVE · 1 INACTIVE (SESSIONS STILL COUNTED)"; the trainer is last,
   greyed, struck through, "Inactive" badge, "Last session <date>"; their three counts still show.
4. Ask the user to mark them active again: the row returns to normal, no suffix, no line.
5. The numbers match the Android app and the web for the same period filter.

## 8. If the iOS app is not React Native
Same reads through the Supabase Swift SDK; `members_status` decodes as `[String: MemberStatusEntry]?`; the
dashed border is `.overlay(RoundedRectangle(cornerRadius: 13).stroke(style: StrokeStyle(lineWidth: 1, dash: [4, 3])))`
and the name uses `.strikethrough()`.
