# iOS handoff: My Crew row layout fix (30 Oct 2026)

The owner's iPhone screenshot of Tomorrow's Plan showed names as "…", the shared-note chip drawn over the checkbox and
avatar, and PROTOCOL cut at the right edge. Android had the same code and the same bug (introduced 27 Oct by the
"NOT HEARD · LISTEN NOW" chip). Fixed in odds-app on 30 Oct 2026; port these five changes.

## 1. Tomorrow's Plan row (`TomorrowPlanSheet` → `renderRow`, managerChat.tsx)
- **Line one**: checkbox, avatar, name block, then the modality and time pills when the row is ticked. Row `gap: 8`,
  `paddingBottom: hasChips ? 5 : 11`; the select Pressable and the name block get `minWidth: 0`.
- **Line two** (only when `hasChips`): `flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6,
  paddingLeft: 42, paddingRight: 11, paddingBottom: 10` holding, in order: `LatestVoiceChip compact`,
  `ListenStatusChip compact`, `CycleChip`, `EssentialsBadge compact`, `ProtocolChip`.
- `hasChips = !!latestVoice[id] || listenChipShown(listenById[id]) || !!cycles[id] || !!essentials[id] || !!protocols[id]`.
- Why: on one non-wrapping line the chips (which never shrink) needed about 390 of the ~300 available, so the name
  block was squeezed to zero, the chips started on top of the avatar, and a ticked row's modality and time buttons went
  off the screen (a row without a modality could not be sent and the button to fix it was unreachable).

## 2. Short chip labels (only where `compact` is passed)
- `src/lib/clientHealthSummary.ts`: `LISTEN_CHIP_DUE_SHORT = 'NOT HEARD'` and
  `listenChipShown(status, nowMs)` (true when any summary exists; same test the chip uses to return null).
- `ListenStatusChip({ status, onPress, compact })`: label `due ? (compact ? LISTEN_CHIP_DUE_SHORT : LISTEN_CHIP_DUE) : LISTEN_CHIP_OK`.
- `LatestVoiceChip({ latest, onPress, compact })`: label `pain ? 'PAIN' : compact ? 'NOTE' : SN.CREW_CHIP` + ` · 28 OCT`.
- Accessibility labels unchanged. 4 new checks in `tests/rules/health_summary_rules_test.js`.

## 3. Day card chip line (`MergedPlanCard`, the second line of each client)
- Container gets `flexWrap: 'wrap'`; the left block (modality text and the CONFLICT / PLAN EXPIRED tags) becomes
  `{ flexGrow: 1, flexShrink: 1, minWidth: 120, gap: 1.5 }` instead of `flex: 1`; the inner tag row with RETRY BOOKING
  gets `flexWrap: 'wrap'`. Chips that do not fit drop to the next line instead of erasing the left side.

## 4. Day card section header
- The full member name (28 Oct change) gets `flexShrink: 1`, so a long name plus the DOCTOR tag truncates with "…"
  instead of pushing the progress count off the card.

## 5. Send bar on Tomorrow's Plan
- The absolute bar becomes `left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 10,
  paddingBottom: insets.bottom + 12, backgroundColor: '#0E0A09'` with a 1 px top border, and the list's
  `paddingBottom` becomes `100 + insets.bottom`. Rows no longer show through the half-transparent disabled button.
