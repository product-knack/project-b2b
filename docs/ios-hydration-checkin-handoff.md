# iOS handoff: Hydration in the workout health check-in (Android since 5 Oct 2026)

An iOS user reported that hydration does not show when logging a workout. Android has asked for it since 5 Oct 2026
(build 5.0 (32)), but no iOS handoff ever covered it; `ios-8-to-16oct-handoff.md` only mentions it in passing. This
file is the full port. No server change: the column is live (`nutrition_tracker.hydration_inputs`, hub-track migration
`20261005120000_nutrition_tracker_hydration.sql`), and 30 check-ins have a value since 20 Oct 2026.

## 1. What the user sees (Android)
- In Add Workout, the **Log Health Data** popup (the sleep / nutrition / steps check-in) has a fourth card,
  **Hydration**, after Steps and before the Medicines card.
- Card: a drop icon on a sky tile (`#38BDF8`), title "Hydration", right label "YESTERDAY · 29 OCT", a number field
  with "LITRES" on the right (placeholder "e.g. 2.5", decimal keyboard), and preset chips 1 L, 1.5 L, 2 L, 2.5 L, 3 L, 4 L.
- It is **required** like the other three: Save Health Data stays off until it has a value.
- Already logged for the day: the popup prefills it, so only missing fields need input.
- After saving, the summary chips under the form read "7h sleep · 8/10 diet · 6,230 steps · 2.5 L water".

## 2. Data
- Same row as the nutrition rating and the trainer's steps: `nutrition_tracker`, one row per client per `rating_date`
  (the workout day, local date). Column `hydration_inputs numeric(4,2)`, litres.
- Read and written by the trainer through the existing policies on `nutrition_tracker` (nothing new).
- It feeds the weekly summary's "Water averaged 2.5 litres a day" line (`build-client-briefing` reads it), so a client
  logged only from iOS has no water line today.

## 3. Code to port

### 3.1 The health check read (`useClientHealthCheck`, src/lib/clientQueries.ts)
Bump the key so cached results without hydration are not reused: Android is on `['client-health-check', 'v5', clientId]`
(v4 added hydration, v5 the medicine check-in). Read the column with a fallback while it might be missing:
```ts
let hydrationColumnMissing = false;
async function nutritionTodayQuery(clientId: string, today: string) {
  if (!hydrationColumnMissing) {
    const r = await supabase.from('nutrition_tracker').select('nutrition_rating, steps_by_trainer, hydration_inputs')
      .eq('client_id', clientId).eq('rating_date', today).limit(1);
    if (!r.error || (r.error as any).code !== '42703') return r;
    hydrationColumnMissing = true;
  }
  return supabase.from('nutrition_tracker').select('nutrition_rating, steps_by_trainer').eq('client_id', clientId).eq('rating_date', today).limit(1);
}
```
In the query function, use `nutritionTodayQuery(clientId, today)` for the nutrition row, then:
```ts
const hydrationRaw = (nutR.data?.[0] as any)?.hydration_inputs;
const hydrationLitres = hydrationRaw != null && Number.isFinite(Number(hydrationRaw)) ? Number(hydrationRaw) : null;
return {
  ...existing fields (sleepMissing, nutritionMissing, stepsMissing, sleepHours, nutritionRating, stepsCount, scheduledHours, ...),
  hydrationMissing: !hydrationColumnMissing && hydrationLitres == null,
  hydrationSupported: !hydrationColumnMissing,
  hydrationLitres,
};
```

### 3.2 The save (`HealthDataInput` + `submitHealthData`, src/lib/clientQueries.ts)
```ts
export type HealthDataInput = {
  ...
  /** Litres of water drunk that day (nutrition_tracker.hydration_inputs, 5 Oct 2026). */
  hydrationLitres?: number | null;
};

// inside submitHealthData, the nutrition_tracker part:
if (nutritionRating != null || stepsCount != null || hydrationLitres != null) {
  const payload: Record<string, any> = { updated_at: new Date().toISOString() };
  if (nutritionRating != null) payload.nutrition_rating = nutritionRating;
  if (stepsCount != null) payload.steps_by_trainer = stepsCount;
  if (hydrationLitres != null && !hydrationColumnMissing) payload.hydration_inputs = hydrationLitres;
  const write = async (): Promise<{ error: any }> => {
    const { data: existing } = await supabase.from('nutrition_tracker').select('id').eq('client_id', clientId).eq('rating_date', logDate).limit(1);
    if (existing && existing.length > 0) return supabase.from('nutrition_tracker').update(payload).eq('client_id', clientId).eq('rating_date', logDate);
    return supabase.from('nutrition_tracker').insert({ client_id: clientId, rating_date: logDate, ...payload });
  };
  let { error } = await write();
  if (error && (error as any).code === '42703' && 'hydration_inputs' in payload) {   // column not live: retry without it
    hydrationColumnMissing = true;
    delete payload.hydration_inputs;
    ({ error } = await write());
  }
  if (error) throw new Error(error.message);
}
```
The offline outbox stores the whole `HealthDataInput` and replays it through `submitHealthData`, so hydration goes
through offline logs with no extra work, as long as the field is in the payload.

### 3.3 The workout form (`Workout`, src/screens/trainer.tsx)
```ts
const HYDRATION = '#38BDF8';
const [hHydration, setHHydration] = React.useState('');           // litres as typed
const hydrationAsked = health?.hydrationSupported !== false;        // ask once the column is live
const healthValid = medicineOnly || (hSleep.trim() !== '' && hRating != null && hSteps.trim() !== '' && (!hydrationAsked || hHydration.trim() !== ''));
const serverGateOk = !!health && !(health.sleepMissing || health.nutritionMissing || health.stepsMissing || health.hydrationMissing);
```
- Prefill wherever the popup opens (auto-open and the Log Health Data button):
  `setHHydration(health?.hydrationLitres != null ? String(health.hydrationLitres) : '');`
- Save payload: `hydrationLitres: hHydration.trim() ? Number(hHydration) : null,` next to `stepsCount`.
- The gate: a client whose hydration is missing for the day must open the popup like a missing sleep / nutrition /
  steps value (`serverGateOk` above). Keep this exactly, or iOS will let a log through that Android stops.

### 3.4 The card (after the Steps card, before Medicines)
```tsx
{hydrationAsked ? (
  <View style={{ padding: 15, borderRadius: 18, backgroundColor: hexA(HYDRATION, 0.05), borderWidth: 1, borderColor: hexA(HYDRATION, 0.2), gap: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(HYDRATION, 0.13), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="activity" path="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z" size={15} color={HYDRATION} strokeWidth={2} />
      </View>
      <Body style={{ flex: 1, fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>Hydration</Body>
      <Mono style={{ fontSize: 10, color: C.muted3 }}>{`YESTERDAY · ${dayMonth(dayBefore(localToday())).toUpperCase()}`}</Mono>
    </View>
    <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 13, borderWidth: 1, borderColor: hHydration ? hexA(HYDRATION, 0.4) : 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', paddingHorizontal: 14 }}>
      <TextInput value={hHydration}
        onChangeText={(t) => setHHydration(t.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 4))}
        keyboardType="decimal-pad" placeholder="e.g. 2.5" placeholderTextColor={C.muted3}
        style={{ flex: 1, paddingVertical: 12, fontFamily: F.bodySemi, fontSize: 16, color: '#fff' }} />
      <Mono style={{ fontSize: 12, color: C.muted2 }}>LITRES</Mono>
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
      {[['1 L', '1'], ['1.5 L', '1.5'], ['2 L', '2'], ['2.5 L', '2.5'], ['3 L', '3'], ['4 L', '4']].map(([label, v]) => {
        const active = hHydration === v;
        return (
          <Pressable key={v} onPress={() => setHHydration(v)} hitSlop={10}
            style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(HYDRATION, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(HYDRATION, 0.5) : 'rgba(255,255,255,0.1)' }}>
            <Text style={{ fontFamily: active ? F.bodyBold : F.body, fontSize: 12.5, color: active ? HYDRATION : C.muted }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  </View>
) : null}
```
- The input keeps digits and one dot, at most 4 characters ("2.75").
- On iOS, scroll the popup so the field is above the keyboard when it gains focus (Android calls `scrollToEnd` 120 ms
  after focus).
- The "YESTERDAY · date" label matches the other cards: the values describe yesterday but are stored on the workout
  day (`logDate: localToday()`, the 24 Sep 2026 rule both apps already follow).

### 3.5 The summary chips under the form
Add after the steps chip (its own key, since it shares the icon with steps):
```ts
...(hydrationAsked ? [{ id: 'water', icon: 'activity' as const, col: HYDRATION, text: `${health?.hydrationLitres ?? offlineHealth?.hydrationLitres ?? '—'} L water` }] : []),
```

## 4. Check on the iPhone
1. Today's Roster → a client with no check-in today → Log Workout. The popup shows Sleep, Nutrition, Steps and then
   Hydration. Save Health Data stays off until all four are filled.
2. Tap 2.5 L: the chip lights up and the field reads 2.5. Type 2.75: accepted. Type a second dot or letters: ignored.
3. Save. In SQL: `select rating_date, nutrition_rating, steps_by_trainer, hydration_inputs from nutrition_tracker
   where client_id = '<client>' order by rating_date desc limit 1;` shows 2.75 on today's row.
4. Open Log Health Data again for the same client: all four are prefilled.
5. The summary chips under the form end with "2.75 L water".
6. Airplane mode: fill the check-in and log. Back online, the queued item writes `hydration_inputs` too.
7. A client whose hydration was already entered today (for example from Android) does not get the popup forced open
   for hydration.
