# iOS handoff: Essentials manager assignments on the My Crew day card (28 Oct 2026)

Bug found on Android 28 Oct 2026 and fixed the same day; port the same two lines.

**What was wrong.** When the Essentials manager assigns an unsold session after the close, the server posts a
`plan_add` crew message **as the assigned trainer** with `payload.source = 'essentials_assigned'` (the same shape the
auction win uses with `source = 'essentials_auction'`). The day card's `addsByDate` accepted a trainer-sent
`plan_add` only for `essentials_auction`; everything else had to come from the manager or the physio HOD. So every
assignment since 22 Oct was dropped from the card while the roster row, the push and the assignment record were fine.

**Fix (`managerChat.tsx`, `addsByDate`):**
```ts
const auction  = p.source === 'essentials_auction'  && !!p.trainer_id && m.senderId === p.trainer_id;
const assigned = p.source === 'essentials_assigned' && !!p.trainer_id && m.senderId === p.trainer_id;
if (!auction && !assigned && m.senderId !== mgrId && (!hodId || m.senderId !== hodId)) return;
// ... entry: ...(auction ? { auction: true } : {}), ...(assigned ? { assigned: true } : {})
```
- `TomorrowPlanEntry` gains `assigned?: boolean` (`managerChatQueries.ts`).
- Card label: `e.auction ? ' · AUCTION' : e.assigned ? ' · ASSIGNED' : ' · ADDED'`; the no-modality line reads
  "ASSIGNED BY THE ESSENTIALS MANAGER" in gold (auction and assigned share the gold colour).
- Stream bubble: `source === 'essentials_assigned'` → "ASSIGNED AFTER THE ESSENTIALS AUCTION" in gold.

**Second bug, same day: the HOD's view of another team showed no manager adds at all.** In `ManagerChat`, the three
memos `addsByDate`, `reqStatus` and the time-edit map read `teamQ.data?.managerId`, which is the viewer's OWN team.
The physio HOD is in no team (she sees other teams through `hodTeams`), so `managerId` was undefined and every memo
returned empty: on her phone no session added by a manager ever appeared on any team's day card. Replace all six
uses with `team?.managerId` (the team actually on screen; `team` is already defined above the memos).

No server change. Verify: assign an unsold session from the Essentials Manager page; the member's section on the
day card shows the client with "ASSIGNED", and the stream shows the gold bubble.
