# iOS handoff: My Crew row layout fix (30 Oct 2026)

Android commit 16b8b0f (line endings repaired in c8a3fc1). Owner confirmed the fix on the iPhone through Expo Go on
30 Oct 2026. Four files, about 40 lines; no server change, no new package.

## 1. The bug, and why it happened

Your iPhone screenshot of Tomorrow's Plan showed:
- client names reduced to "…";
- the shared-note chip drawn over the checkbox and the avatar;
- the PROTOCOL chip cut off at the right edge.

Cause: each row was ONE horizontal line holding the select area (checkbox, avatar, name) followed by up to five chips
and, when ticked, the modality and time buttons. Nothing wrapped. In React Native the chips do not shrink
(`flexShrink` defaults to 0), and the select area has `flex: 1`, so it was the only thing that could shrink. On a
~300 pt wide row, three chips need about 390 pt, so:
- the name block got 0 width (hence "…");
- the select area became narrower than its own checkbox and avatar, and the first chip started on top of them
  (children overflow their parent visibly);
- everything after it was pushed off the right edge.

It also hid controls: a ticked row's modality and time buttons came after the chips, off the screen. A row with no
modality could not be sent ("Modality required") and the button to fix it was unreachable.

It started on 27 Oct, when the "NOT HEARD · LISTEN NOW" chip (the widest one) was added to these rows.

## 2. The fix

| # | Where | Change |
|---|---|---|
| 1 | Tomorrow's Plan row | two lines: select + name + modality + time on line one, the chips on a wrapping line two |
| 2 | Two chips | optional `compact` prop with short labels, used only on these rows |
| 3 | Day card chip line | wraps instead of squeezing the modality text and the PLAN EXPIRED / RETRY BOOKING tag |
| 4 | Day card section header | the full name may shrink, so the count stays on screen |
| 5 | Send bar | solid strip behind it so rows do not show through |

### 2.1 `src/lib/clientHealthSummary.ts` (pure, add after `LISTEN_CHIP_OK` and before `gateFromStatus`)
```ts
/** The short form for crowded rows (Tomorrow's Plan, 30 Oct 2026); the chip's accessibility label keeps the full sense. */
export const LISTEN_CHIP_DUE_SHORT = 'NOT HEARD';

/** True when the listen chip has something to say (a summary exists for at least one kind). */
export const listenChipShown = (s: ListenStatusRow | null | undefined, nowMs: number = Date.now()): boolean => {
  const g = gateFromStatus(s, nowMs);
  return !(g.weekly === 'none' && g.context === 'none');
};
```
`listenChipShown` is the same test `ListenStatusChip` uses to return null; the row needs it to know whether line two
has anything in it. (It is a `const` arrow that calls `gateFromStatus`; that is fine above it, because it only runs
after the module has loaded.)

### 2.2 `src/components/clientHealthSummaryCard.tsx`: `ListenStatusChip`
```ts
// import: add LISTEN_CHIP_DUE_SHORT next to LISTEN_CHIP_DUE
export function ListenStatusChip({ status, onPress, compact = false }: { status: ListenStatusRow | null | undefined; onPress: () => void; compact?: boolean }) {
  ...
      <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: col }}>{due ? (compact ? LISTEN_CHIP_DUE_SHORT : LISTEN_CHIP_DUE) : LISTEN_CHIP_OK}</Mono>
```

### 2.3 `src/components/SessionVoice.tsx`: `LatestVoiceChip`
```ts
export function LatestVoiceChip({ latest, onPress, compact = false }: { latest: ClientLatestVoice; onPress: () => void; compact?: boolean }) {
  ...
      <Mono style={{ fontSize: 8, letterSpacing: 0.5, color: col }}>{pain ? 'PAIN' : compact ? 'NOTE' : SN.CREW_CHIP} · {shortDay(latest.day)}</Mono>
```
Both chips keep their long labels everywhere `compact` is not passed. Accessibility labels are unchanged.

### 2.4 `src/screens/managerChat.tsx`, `TomorrowPlanSheet` → `renderRow`

Import: `import { listenChipShown } from '../lib/clientHealthSummary';`

Next to `rowMods`:
```ts
const hasChips = !!latestVoice[r.clientId] || listenChipShown(listenById[r.clientId]) || !!cycles[r.clientId] || !!essentials[r.clientId] || !!protocols[r.clientId];
```

Line one, before:
```tsx
<View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11 }}>
  <Pressable onPress={() => toggle(...)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
    ...checkbox, AvatarDot...
    <View style={{ flex: 1 }}>  ...name, ROSTER / LOCKED line...  </View>
  </Pressable>
  {LatestVoiceChip} <ListenStatusChip/> {CycleChip} {EssentialsBadge} {ProtocolChip}
  {on ? modality pill : null}
  {on ? time pill : null}
</View>
```
After:
```tsx
<View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 11, paddingBottom: hasChips ? 5 : 11 }}>
  <Pressable onPress={() => toggle(...)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
    ...checkbox, AvatarDot (unchanged)...
    <View style={{ flex: 1, minWidth: 0 }}>  ...name, ROSTER / LOCKED line (unchanged)...  </View>
  </Pressable>
  {on ? modality pill : null}   {/* unchanged */}
  {on ? time pill : null}       {/* unchanged */}
</View>
{/* the chips on their own line, wrapping, under the avatar */}
{hasChips ? (
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingLeft: 42, paddingRight: 11, paddingBottom: 10 }}>
    {latestVoice[r.clientId] ? <LatestVoiceChip compact latest={latestVoice[r.clientId]} onPress={() => setVoiceFor({ name: r.name, latest: latestVoice[r.clientId] })} /> : null}
    <ListenStatusChip compact status={listenById[r.clientId]} onPress={() => setListenFor({ id: r.clientId, name: r.name })} />
    {cycles[r.clientId] ? <CycleChip cycle={cycles[r.clientId]} onPress={() => setCycleFor({ name: r.name, cycle: cycles[r.clientId] })} /> : null}
    {essentials[r.clientId] ? <EssentialsBadge status={essentials[r.clientId]} compact /> : null}
    {protocols[r.clientId] ? <ProtocolChip onPress={() => setProtoFor({ name: r.name, proto: protocols[r.clientId] })} /> : null}
  </View>
) : null}
{/* then the existing time strip and modality strip, unchanged */}
```
- `paddingLeft: 42` = row padding 11 + checkbox 21 + gap 10, so the chips start under the avatar.
- `paddingBottom: hasChips ? 5 : 11` keeps a row without chips a single, normal-height line.
- The row's outer `Animated.View` (shake, border, selected colour) is unchanged; line two is inside it.

### 2.5 `managerChat.tsx`, Send bar of the same sheet
```tsx
// list
contentContainerStyle={{ gap: 7, paddingBottom: 100 + insets.bottom }}   // was 100
// bar: was { position: 'absolute', left: 18, right: 18, bottom: insets.bottom + 12 }
<View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 10, paddingBottom: insets.bottom + 12, backgroundColor: '#0E0A09', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
```
`#0E0A09` is the sheet's own background. The disabled button keeps its 0.5 opacity, but now over a solid strip.
Absolute children in React Native are placed against the parent's outer edge (not inside its padding), which is why
`left: 0` with `paddingHorizontal: 18` lines the button up exactly where `left: 18` had it.

### 2.6 `managerChat.tsx`, `MergedPlanCard` (the day card)

The second line of each client entry, before:
```tsx
<View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 28 }}>
  <View style={{ flex: 1, gap: 1.5 }}>  ...modality text, CONFLICT / PLAN EXPIRED tag row...  </View>
  ...ACKNOWLEDGED text, CycleChip, EssentialsBadge, ProtocolChip, RESCHEDULE chip...
```
After:
```tsx
<View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginLeft: 28 }}>
  <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 120, gap: 1.5 }}>  ...unchanged...  </View>
```
and the tag row inside it (`e.roster === 'conflict' || e.roster === 'plan_expired'`):
```tsx
<View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>   // added flexWrap
```
- The left block now has its natural width (at least 120) instead of `flex: 1`. Chips that do not fit next to it move
  to the next line, and the left block grows to fill the space that is left.
- An uncrowded row looks the same as before: the left block fills the line and the chips sit on the right.

### 2.7 `managerChat.tsx`, `MergedPlanCard` section header
```tsx
<Text style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: '#fff', flexShrink: 1 }} numberOfLines={1}>{s.name}</Text>
```
Only `flexShrink: 1` is new. The header shows the FULL name since 28 Oct (`s.name` instead of the first word; see
`ios-crew-assigned-card-handoff.md`, last section). Without `flexShrink` a long name plus the DOCTOR / THERAPIST tag
pushes the progress count off the card, because `numberOfLines` only truncates a Text that is allowed to shrink. If
iOS still shows the first name there, port that change too; `flexShrink` is harmless either way.

## 3. Tests
- Add to `tests/rules/health_summary_rules_test.js` (before the final `console.log`):
```js
eq('listen chip shown: both built', R.listenChipShown(st, NOW), true);
eq('listen chip hidden: nothing built', R.listenChipShown({ ...st, has_weekly: false, has_context: false }, NOW), false);
eq('listen chip shown: only the context built', R.listenChipShown({ ...st, has_weekly: false }, NOW), true);
eq('short label', R.LISTEN_CHIP_DUE_SHORT, 'NOT HEARD');
```
- `npx tsc --noEmit` exit 0; every `node tests/rules/*_test.js` passes.

## 4. Manual check on the iPhone
1. My Crew → calendar button → Tomorrow's Plan. Every row: name readable (long ones end with "…"), chips on line two
   under the avatar, nothing over the checkbox or avatar, PROTOCOL fully visible, rows without chips one line.
2. Tick a row with 3+ chips: modality and time buttons at the end of line one; both open their strips and save.
3. Tap NOTE (notes player), NOT HEARD (Listen now sheet), PROTOCOL and the cycle chip (their popups).
4. Scroll: no rows show through the Send bar; the last row scrolls fully above it. Do not press Send unless you mean
   it (it books real roster sessions).
5. Day card: an entry with Essentials + cycle + protocol wraps its chips and keeps "STRENGTH" visible; a
   "PLAN EXPIRED · NOT BOOKED" entry keeps RETRY BOOKING visible.
6. Section header: a long name or a DOCTOR member ends with "…" and keeps the "0/1" count.
7. Settings → Display & Brightness → Display Zoom → Larger Text, then repeat 1 and 2 (narrowest layout).

## 5. Related iOS handoffs touching the same file (port together)
- `ios-crew-assigned-card-handoff.md`: assigned Essentials sessions on the day card, the HOD view of other teams, and
  the full / duplicate member names (28 Oct 2026).
- `ios-plan-cover-handoff.md`: the expired-plan gate on Tomorrow's Plan and Add Session (27 Oct 2026); its
  `PlanCoverBox` sits under the row and is not affected by this change.
