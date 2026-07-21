import React from 'react';
import { View, Text, Pressable, ScrollView, Modal, TextInput, Keyboard, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { useStore } from '../store';
import { Serif, Body, Mono, Card, GradientButton, Avatar, IconChip } from '../components/primitives';
import { Page, BackLink } from './common';
import { useAuth } from '../auth';
import {
  usePlanExerciseDb, useBoxingPlanExercises, useCreateWorkoutPlan, emptyPlanSet, DbExercise, uuidv4,
  PlanBodyPartInput, PlanExerciseInput, PlanSetInput, PlanYogaInput, PlanBoxingCustom, WorkoutPlanCreateInput,
} from '../lib/clientQueries';
import { enqueueOutbox, getIsOnline, useIsOnline } from '../lib/offline';

/* ============ CREATE WORKOUT PLAN ============
   Mirrors the web app's Create Workout Plan form end-to-end (client, plan meta,
   modality-specific builders) with the mobile design language of this app.
   New plans are inserted as 'pending_review' and go to the CRM for approval. */

const MODALITIES = ['Strength Training', 'Boxing', 'Yoga', 'Pilates', 'Aerobics', 'Aqua Aerobics'] as const;
type PlanModality = (typeof MODALITIES)[number];
const MODALITY_META: Record<PlanModality, { icon: any; desc: string }> = {
  'Strength Training': { icon: 'dumbbell', desc: 'Sets, reps & load' },
  Boxing: { icon: 'target', desc: 'Drills & activities' },
  Yoga: { icon: 'sparkle', desc: 'Asana & breathwork' },
  Pilates: { icon: 'heart', desc: 'Core & control' },
  Aerobics: { icon: 'activity', desc: 'Cardio circuits' },
  'Aqua Aerobics': { icon: 'layers', desc: 'Pool workouts' },
};
// Plans have a fixed 6-week (42-day) validity from Expert approval.
const PLAN_WEEKS = 6;

const label = (t: string, extra?: object) => (
  <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.mono2, marginBottom: 8, ...(extra ?? {}) }}>{t}</Mono>
);
const inputStyle = {
  paddingVertical: 12, paddingHorizontal: 13, borderRadius: 13, borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)',
  color: '#fff', fontFamily: F.body, fontSize: 14.5,
} as const;
const smallInput = {
  height: 40, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)', textAlign: 'center' as const,
  fontFamily: F.mono, fontSize: 13.5, color: '#fff', paddingVertical: 0, paddingHorizontal: 6,
};
const initials = (name: string) => name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'C';

function Chip({ text, active, onPress, color = C.orange }: { text: string; active: boolean; onPress: () => void; color?: string }) {
  return (
    <Pressable onPress={onPress} style={{ paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? hexA(color, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(color, 0.45) : 'rgba(255,255,255,0.08)' }}>
      <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? color : C.muted }}>{text}</Text>
    </Pressable>
  );
}

function DashedBtn({ text, onPress, small }: { text: string; onPress: () => void; small?: boolean }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: small ? 11 : 14, borderRadius: 13, borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexA(C.orange, 0.32), backgroundColor: hexA(C.orange, 0.05) }}>
      <Icon name="plus" size={small ? 14 : 15} color={C.orange} strokeWidth={2.6} />
      <Text style={{ fontFamily: F.bodyBold, fontSize: small ? 12.5 : 13.5, color: C.orange }}>{text}</Text>
    </Pressable>
  );
}

export function CreatePlan() {
  const { selectedClientId, selectedClientName, back, canGoBack, go } = useStore();
  // RLS on workout_plan_exercises requires trainer_id = auth.uid(), so the plan
  // must be created as the signed-in user — never the dev fallback trainer id.
  const { session } = useAuth();
  const trainerId = session?.user?.id ?? '';
  const insets = useSafeAreaInsets();
  const createM = useCreateWorkoutPlan();
  const clientName = selectedClientName ?? 'Client';

  /* ---- plan meta ---- */
  const [planName, setPlanName] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [modality, setModality] = React.useState<PlanModality | null>(null);

  /* ---- strength-style builder ---- */
  const [bodyParts, setBodyParts] = React.useState<PlanBodyPartInput[]>([{ body_part: '', exercises: [] }]);
  const [openSet, setOpenSet] = React.useState<string | null>(null); // "bpi-exi-si" of the expanded advanced row
  const isStrengthStyle = !!modality && modality !== 'Yoga' && modality !== 'Boxing';
  const poolQ = usePlanExerciseDb(isStrengthStyle ? modality : null);

  /* ---- exercise picker (multi-select, mirrors the web ExerciseSelection page) ---- */
  const [pickerFor, setPickerFor] = React.useState<number | null>(null);
  const [exSearch, setExSearch] = React.useState('');
  const [selPick, setSelPick] = React.useState<Record<string, 'reps' | 'duration'>>({});
  const [customOpen, setCustomOpen] = React.useState(false);
  const [customName, setCustomName] = React.useState('');
  const [customMuscle, setCustomMuscle] = React.useState('');
  const [customMeasure, setCustomMeasure] = React.useState<'reps' | 'duration'>('reps');
  // Custom exercises live for the whole form session (like the web's sessionStorage pool).
  const [customPool, setCustomPool] = React.useState<DbExercise[]>([]);

  /* ---- yoga ---- */
  const [yoga, setYoga] = React.useState<PlanYogaInput[]>([{ name: '', type: 'Constant' }]);

  /* ---- boxing ---- */
  const boxingDbQ = useBoxingPlanExercises();
  const [boxSel, setBoxSel] = React.useState<Record<string, string>>({}); // exercise -> category
  const [boxCustom, setBoxCustom] = React.useState<PlanBoxingCustom[]>([]);
  const [padwork, setPadwork] = React.useState(false);
  const [openBoxCat, setOpenBoxCat] = React.useState<string | null>(null);

  const [done, setDone] = React.useState(false);
  const [savedOffline, setSavedOffline] = React.useState(false);
  const [exitConfirm, setExitConfirm] = React.useState(false);
  const isOnline = useIsOnline();

  // Keyboard height — same manual pattern as the app's other input-bearing sheets.
  const [kbH, setKbH] = React.useState(0);
  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e: any) => setKbH(e.endCoordinates?.height ?? 0));
    const h = Keyboard.addListener(hideEvt, () => setKbH(0));
    return () => { s.remove(); h.remove(); };
  }, []);

  /* ---- derived ---- */
  const boxSelCount = Object.keys(boxSel).length;
  const strengthHasContent = bodyParts.some((bp) => bp.exercises.some((ex) => ex.name.trim()));
  const strengthUnnamedSection = bodyParts.some((bp) => bp.exercises.some((ex) => ex.name.trim()) && !bp.body_part.trim());
  const hasContent =
    modality === 'Yoga' ? yoga.some((a) => a.name.trim())
    : modality === 'Boxing' ? padwork || boxSelCount > 0 || boxCustom.some((c) => c.category.trim() && c.name.trim())
    : modality ? strengthHasContent
    : false;
  const hasChanges = !!(planName.trim() || desc.trim() || hasContent || modality);
  const contentCount =
    modality === 'Yoga' ? yoga.filter((a) => a.name.trim()).length
    : modality === 'Boxing' ? boxSelCount + (padwork ? 1 : 0) + boxCustom.filter((c) => c.category.trim() && c.name.trim()).length
    : bodyParts.reduce((n, bp) => n + bp.exercises.filter((e) => e.name.trim()).length, 0);

  const missingHint = createM.isPending || done ? null
    : !planName.trim() ? 'Give the plan a name'
    : !modality ? 'Pick a modality'
    : !hasContent ? (modality === 'Yoga' ? 'Add at least one activity' : modality === 'Boxing' ? 'Select or add at least one activity' : 'Add at least one exercise')
    : modality !== 'Yoga' && modality !== 'Boxing' && strengthUnnamedSection ? 'Name each workout section (e.g. Chest, Push)'
    : null;
  const canSubmit = !!selectedClientId && !!trainerId && !missingHint && !createM.isPending && !done;

  const goBack = () => (canGoBack ? back() : go('client'));
  const guardedBack = () => (hasChanges && !done ? setExitConfirm(true) : goBack());

  const submit = async () => {
    if (!canSubmit) return;
    // planId is generated on-device so an offline retry can never duplicate the plan.
    const input: WorkoutPlanCreateInput = {
      trainerId,
      clientId: selectedClientId as string,
      planName,
      planDescription: desc,
      durationWeeks: PLAN_WEEKS,
      modality: modality as string,
      bodyParts,
      yoga,
      boxing: {
        selected: Object.entries(boxSel).map(([exercise, category]) => ({ category, exercise })),
        custom: boxCustom,
        padwork,
      },
      planId: uuidv4(),
    };
    const finishOffline = async () => {
      await enqueueOutbox('create-plan', `${planName.trim()} · ${clientName}`, input);
      setSavedOffline(true);
      setDone(true);
      setTimeout(goBack, 900);
    };
    if (!getIsOnline()) {
      await finishOffline();
      return;
    }
    try {
      await createM.mutateAsync(input);
      setDone(true);
      setTimeout(goBack, 900);
    } catch (e: any) {
      if (/network request failed|network error|failed to fetch|fetch failed|timeout/i.test(String(e?.message))) {
        await finishOffline();
      }
      /* other errors surfaced below */
    }
  };

  /* ---- strength helpers (immutable updates) ---- */
  const patchBp = (i: number, patch: Partial<PlanBodyPartInput>) => setBodyParts((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const patchEx = (bpi: number, exi: number, patch: Partial<PlanExerciseInput>) =>
    setBodyParts((xs) => xs.map((x, k) => (k === bpi ? { ...x, exercises: x.exercises.map((e, j) => (j === exi ? { ...e, ...patch } : e)) } : x)));
  const patchSet = (bpi: number, exi: number, si: number, patch: Partial<PlanSetInput>) =>
    setBodyParts((xs) => xs.map((x, k) => (k === bpi ? { ...x, exercises: x.exercises.map((e, j) => (j === exi ? { ...e, sets: e.sets.map((s, m) => (m === si ? { ...s, ...patch } : s)) } : e)) } : x)));
  const openPicker = (bpi: number) => {
    setExSearch('');
    setSelPick({});
    setCustomOpen(false);
    setCustomName('');
    setCustomMuscle('');
    setCustomMeasure('reps');
    setPickerFor(bpi);
  };
  const togglePick = (name: string, measurement: 'reps' | 'duration') =>
    setSelPick((m) => {
      const next = { ...m };
      if (next[name]) delete next[name];
      else next[name] = measurement;
      return next;
    });
  const addCustomToPool = () => {
    const n = customName.trim();
    if (!n || !customMuscle.trim()) return;
    if (!customPool.some((c) => c.name.toLowerCase() === n.toLowerCase())) {
      setCustomPool((xs) => [{ name: n, muscle_group: customMuscle.trim(), equipment: 'Custom', measurement_type: customMeasure }, ...xs]);
    }
    setSelPick((m) => ({ ...m, [n]: customMeasure }));
    setCustomName('');
    setCustomMuscle('');
    setCustomMeasure('reps');
    setCustomOpen(false);
  };
  const confirmPick = () => {
    if (pickerFor === null) return;
    const existing = new Set(bodyParts[pickerFor]?.exercises.map((e) => e.name.toLowerCase()) ?? []);
    const additions: PlanExerciseInput[] = Object.entries(selPick)
      .filter(([n]) => !existing.has(n.toLowerCase()))
      .map(([n, measurement]) => ({ name: n, measurement, sets: [emptyPlanSet()] }));
    if (additions.length) {
      setBodyParts((xs) => xs.map((x, k) => (k === pickerFor ? { ...x, exercises: [...x.exercises, ...additions] } : x)));
    }
    setPickerFor(null);
  };
  const removeExercise = (bpi: number, exi: number) => setBodyParts((xs) => xs.map((x, k) => (k === bpi ? { ...x, exercises: x.exercises.filter((_, j) => j !== exi) } : x)));
  const addSet = (bpi: number, exi: number) =>
    setBodyParts((xs) => xs.map((x, k) => (k === bpi ? { ...x, exercises: x.exercises.map((e, j) => (j === exi ? { ...e, sets: [...e.sets, { ...(e.sets[e.sets.length - 1] ?? emptyPlanSet()) }] } : e)) } : x)));
  const removeSet = (bpi: number, exi: number, si: number) =>
    setBodyParts((xs) => xs.map((x, k) => (k === bpi ? { ...x, exercises: x.exercises.map((e, j) => (j === exi ? { ...e, sets: e.sets.filter((_, m) => m !== si) } : e)) } : x)));

  if (!selectedClientId) {
    return (
      <Page gap={16} pt={6}>
        <View style={{ alignItems: 'center', gap: 12, paddingVertical: 50 }}>
          <Icon name="user" size={30} color="#4C4640" strokeWidth={1.6} />
          <Serif style={{ fontSize: 19 }}>No client selected</Serif>
          <Body style={{ fontSize: 13, color: C.muted3, textAlign: 'center', paddingHorizontal: 30 }}>Open a client and use Create Plan from their Plan tab.</Body>
        </View>
      </Page>
    );
  }

  const advKey = (bpi: number, exi: number, si: number) => `${bpi}-${exi}-${si}`;

  return (
    <View style={{ flex: 1 }}>
      <Page gap={14} pt={6} pb={130 + (Platform.OS === 'android' ? kbH : 0)} kbAware>
        <BackLink label="Back" onPress={guardedBack} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
          <IconChip icon="file" color={C.orange} />
          <View style={{ flex: 1 }}>
            <Serif style={{ fontSize: 24 }}>Create Plan</Serif>
            <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 1 }}>Goes to the CRM for review before it reaches the client</Body>
          </View>
        </View>

        {/* Plan details */}
        <Card colors={['rgba(50,30,19,0.45)', 'rgba(18,14,14,0.5)']} radius={20} style={{ padding: 18, gap: 15 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
            <Avatar initial={initials(clientName)} size={40} colors={['#7C8FE8', '#9A7BEA']} fontSize={14} />
            <View style={{ flex: 1 }}>
              <Body style={{ fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{clientName}</Body>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.blue }} />
                <Body style={{ fontSize: 11.5, color: C.muted }}>New training plan</Body>
              </View>
            </View>
          </View>
          <View>
            {label('PLAN NAME *')}
            <TextInput value={planName} onChangeText={setPlanName} placeholder="e.g. Push Day, Leg Day, Full Body" placeholderTextColor={C.muted3} style={inputStyle} />
          </View>
          <View>
            {label('MODALITY *')}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {MODALITIES.map((m) => {
                const meta = MODALITY_META[m];
                const active = modality === m;
                return (
                  <Pressable key={m} onPress={() => setModality(m)} style={{ width: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 10, paddingHorizontal: 11, borderRadius: 13, backgroundColor: active ? hexA(C.orange, 0.12) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.45) : 'rgba(255,255,255,0.08)' }}>
                    <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={meta.icon} size={15} color={active ? C.orange : C.muted} strokeWidth={2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: active ? C.orange : C.ink }}>{m}</Text>
                      <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 10, color: C.muted3, marginTop: 1 }}>{meta.desc}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View>
            {label('VALIDITY')}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 13, backgroundColor: hexA(C.gold, 0.06), borderWidth: 1, borderColor: hexA(C.gold, 0.22) }}>
              <Icon name="clock" size={15} color={C.gold} strokeWidth={2} />
              <Body style={{ flex: 1, fontSize: 12, color: hexA(C.gold, 0.95), lineHeight: 17 }}>
                This plan is valid for <Text style={{ fontFamily: F.bodyBold, color: C.gold }}>42 days</Text> from the day the Expert approves it.
              </Body>
            </View>
          </View>
          <View>
            {label('DESCRIPTION')}
            <TextInput
              value={desc}
              onChangeText={setDesc}
              placeholder="Goals and approach of this plan (optional)"
              placeholderTextColor={C.muted3}
              multiline
              style={[inputStyle, { minHeight: 64, textAlignVertical: 'top' }]}
            />
          </View>
        </Card>

        {/* Modality-specific builder */}
        {modality ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 2 }}>
            <Mono style={{ fontSize: 10, letterSpacing: 1.4, color: C.mono2 }}>PLAN CONTENT</Mono>
            <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />
            <Mono style={{ fontSize: 10, color: C.muted3 }}>{modality.toUpperCase()}</Mono>
          </View>
        ) : null}
        {!modality ? (
          <View style={{ alignItems: 'center', gap: 10, paddingVertical: 28, borderRadius: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.015)' }}>
            <View style={{ width: 44, height: 44, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="dumbbell" size={21} color="#5C554E" strokeWidth={1.7} />
            </View>
            <Body style={{ fontSize: 13, color: C.muted3 }}>Pick a modality above to start building the plan.</Body>
          </View>
        ) : modality === 'Yoga' ? (
          /* ============ YOGA ============ */
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} radius={20} style={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: hexA(C.purple, 0.14), borderWidth: 1, borderColor: hexA(C.purple, 0.3), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="sparkle" size={15} color={C.purple} strokeWidth={2} />
              </View>
              <Serif style={{ flex: 1, fontSize: 17 }}>Yoga Activities</Serif>
              <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.purple, 0.13), borderWidth: 1, borderColor: hexA(C.purple, 0.3) }}>
                <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: C.purple }}>{yoga.filter((a) => a.name.trim()).length}</Text>
              </View>
            </View>
            {yoga.map((a, i) => (
              <View key={i} style={{ gap: 8, padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TextInput
                    value={a.name}
                    onChangeText={(t) => setYoga((xs) => xs.map((x, k) => (k === i ? { ...x, name: t } : x)))}
                    placeholder="e.g. Asana, Pranayam, Suryanamaskar"
                    placeholderTextColor={C.muted3}
                    style={[inputStyle, { flex: 1 }]}
                  />
                  <Pressable onPress={() => setYoga((xs) => (xs.length > 1 ? xs.filter((_, k) => k !== i) : xs))} disabled={yoga.length === 1} hitSlop={8} style={{ opacity: yoga.length === 1 ? 0.3 : 1 }}>
                    <Icon name="close" size={16} color={C.muted2} strokeWidth={2.2} />
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', gap: 7 }}>
                  {(['Constant', 'Custom'] as const).map((t) => (
                    <Chip key={t} text={t} active={a.type === t} onPress={() => setYoga((xs) => xs.map((x, k) => (k === i ? { ...x, type: t } : x)))} color={C.blue} />
                  ))}
                </View>
              </View>
            ))}
            <DashedBtn small text="Add Activity" onPress={() => setYoga((xs) => [...xs, { name: '', type: 'Constant' }])} />
          </Card>
        ) : modality === 'Boxing' ? (
          /* ============ BOXING ============ */
          <Card colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} radius={20} style={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: hexA(C.red, 0.13), borderWidth: 1, borderColor: hexA(C.red, 0.28), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="target" size={15} color={C.red} strokeWidth={2} />
              </View>
              <Serif style={{ flex: 1, fontSize: 17 }}>Boxing Activities</Serif>
              <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: hexA(C.red, 0.12), borderWidth: 1, borderColor: hexA(C.red, 0.28) }}>
                <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: C.red }}>{boxSelCount + (padwork ? 1 : 0) + boxCustom.filter((c) => c.category.trim() && c.name.trim()).length}</Text>
              </View>
            </View>

            {/* Pad work toggle */}
            <Pressable onPress={() => setPadwork((p) => !p)} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 13, backgroundColor: padwork ? hexA(C.orange, 0.09) : 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: padwork ? hexA(C.orange, 0.4) : 'rgba(255,255,255,0.07)' }}>
              <View style={{ width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: padwork ? C.orange : 'rgba(255,255,255,0.2)', backgroundColor: padwork ? C.orange : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {padwork ? <Icon path="M20 6 9 17l-5-5" size={12} color="#0c0808" strokeWidth={3} /> : null}
              </View>
              <Body style={{ flex: 1, fontSize: 14, fontFamily: F.bodySemi, color: padwork ? C.orange : '#fff' }}>Pad work</Body>
              <Mono style={{ fontSize: 9, color: C.muted3 }}>SESSION STAPLE</Mono>
            </Pressable>

            {/* Predefined, grouped by category */}
            {boxingDbQ.isLoading ? (
              <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 10 }}>Loading activities…</Body>
            ) : (
              (boxingDbQ.data ?? []).map((g) => {
                const openCat = openBoxCat === g.category;
                const selInCat = g.exercises.filter((e) => boxSel[e]).length;
                return (
                  <View key={g.category} style={{ borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: selInCat ? hexA(C.orange, 0.25) : 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                    <Pressable onPress={() => setOpenBoxCat(openCat ? null : g.category)} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12 }}>
                      <Body style={{ flex: 1, fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{g.category}</Body>
                      {selInCat ? (
                        <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.35) }}>
                          <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.orange }}>{selInCat}</Text>
                        </View>
                      ) : null}
                      <Icon name={openCat ? 'chevUp' : 'chevDown'} size={15} color={C.muted} strokeWidth={2.2} />
                    </Pressable>
                    {openCat ? (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingHorizontal: 12, paddingBottom: 12 }}>
                        {g.exercises.map((e) => {
                          const sel = !!boxSel[e];
                          return (
                            <Chip
                              key={e}
                              text={e}
                              active={sel}
                              onPress={() => setBoxSel((m) => {
                                const next = { ...m };
                                if (next[e]) delete next[e];
                                else next[e] = g.category;
                                return next;
                              })}
                            />
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                );
              })
            )}

            {/* Custom activities */}
            {boxCustom.map((c, i) => (
              <View key={i} style={{ gap: 8, padding: 12, borderRadius: 13, backgroundColor: hexA(C.orange, 0.05), borderWidth: 1, borderColor: hexA(C.orange, 0.25) }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Mono style={{ flex: 1, fontSize: 9.5, letterSpacing: 1, color: C.orange }}>CUSTOM ACTIVITY</Mono>
                  <Pressable onPress={() => setBoxCustom((xs) => xs.filter((_, k) => k !== i))} hitSlop={8}>
                    <Icon name="close" size={15} color={C.muted} strokeWidth={2.3} />
                  </Pressable>
                </View>
                <TextInput value={c.category} onChangeText={(t) => setBoxCustom((xs) => xs.map((x, k) => (k === i ? { ...x, category: t } : x)))} placeholder="Category (e.g. Conditioning)" placeholderTextColor={C.muted3} style={inputStyle} />
                <TextInput value={c.name} onChangeText={(t) => setBoxCustom((xs) => xs.map((x, k) => (k === i ? { ...x, name: t } : x)))} placeholder="Activity name" placeholderTextColor={C.muted3} style={inputStyle} />
              </View>
            ))}
            <DashedBtn small text="Add Custom Activity" onPress={() => setBoxCustom((xs) => [...xs, { category: '', name: '' }])} />
          </Card>
        ) : (
          /* ============ STRENGTH TRAINING ============ */
          <>
            {bodyParts.map((bp, bpi) => (
              <Card key={bpi} colors={['rgba(46,28,18,0.4)', 'rgba(18,14,14,0.5)']} radius={20} style={{ padding: 16, gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 11, backgroundColor: hexA(C.orange, 0.13), borderWidth: 1, borderColor: hexA(C.orange, 0.3), alignItems: 'center', justifyContent: 'center' }}>
                    <Serif style={{ fontSize: 15, color: C.orange }}>{bpi + 1}</Serif>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Serif style={{ fontSize: 17 }}>{bp.body_part.trim() || `Workout ${bpi + 1}`}</Serif>
                    <Body style={{ fontSize: 11, color: C.muted3, marginTop: 1 }}>
                      {bp.exercises.length ? `${bp.exercises.length} exercise${bp.exercises.length === 1 ? '' : 's'}` : 'No exercises yet'}
                    </Body>
                  </View>
                  {bodyParts.length > 1 ? (
                    <Pressable onPress={() => setBodyParts((xs) => xs.filter((_, k) => k !== bpi))} hitSlop={8} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="close" size={14} color={C.muted2} strokeWidth={2.2} />
                    </Pressable>
                  ) : null}
                </View>
                <View>
                  {label('WORKOUT NAME *')}
                  <TextInput
                    value={bp.body_part}
                    onChangeText={(t) => patchBp(bpi, { body_part: t })}
                    placeholder="e.g. Chest, Back, Legs"
                    placeholderTextColor={C.muted3}
                    style={inputStyle}
                  />
                </View>

                {bp.exercises.map((ex, exi) => (
                  <View key={exi} style={{ gap: 9, padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                      <View style={{ width: 24, height: 24, borderRadius: 8, backgroundColor: hexA(C.orange, 0.13), alignItems: 'center', justifyContent: 'center' }}>
                        <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.orange }}>{exi + 1}</Text>
                      </View>
                      <Body numberOfLines={1} style={{ flex: 1, fontSize: 14.5, fontFamily: F.bodySemi, color: '#fff' }}>{ex.name}</Body>
                      <Pressable onPress={() => removeExercise(bpi, exi)} hitSlop={8}>
                        <Icon name="close" size={15} color={C.muted2} strokeWidth={2.2} />
                      </Pressable>
                    </View>

                    {/* Reps vs Duration */}
                    <View style={{ flexDirection: 'row', gap: 7 }}>
                      {(['reps', 'duration'] as const).map((m) => (
                        <Chip key={m} text={m === 'reps' ? 'Reps' : 'Duration'} active={ex.measurement === m} onPress={() => patchEx(bpi, exi, { measurement: m })} color={C.blue} />
                      ))}
                    </View>

                    {/* Sets */}
                    <View style={{ flexDirection: 'row', gap: 7, paddingHorizontal: 2 }}>
                      <Text style={[colHead, { width: 34 }]}>SET</Text>
                      <Text style={[colHead, { flex: 1 }]}>LOAD (KG)</Text>
                      <Text style={[colHead, { flex: 1 }]}>{ex.measurement === 'duration' ? 'MINUTES' : 'REPS'}</Text>
                      <View style={{ width: 58 }} />
                    </View>
                    {ex.sets.map((st, si) => {
                      const k = advKey(bpi, exi, si);
                      const adv = openSet === k;
                      const hasAdv = !!(st.rest || st.tempo || st.rm || st.rir || st.ss || st.notes);
                      return (
                        <View key={si} style={{ gap: 8 }}>
                          <View style={{ flexDirection: 'row', gap: 7, alignItems: 'center' }}>
                            <View style={{ width: 34, height: 40, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' }}>
                              <Text style={{ fontFamily: F.mono, fontSize: 12.5, color: C.muted }}>{si + 1}</Text>
                            </View>
                            <TextInput value={st.load} onChangeText={(t) => patchSet(bpi, exi, si, { load: t })} placeholder="kg / BW" placeholderTextColor={C.muted3} style={[smallInput, { flex: 1 }]} />
                            {ex.measurement === 'duration' ? (
                              <TextInput value={st.duration} onChangeText={(t) => patchSet(bpi, exi, si, { duration: t })} placeholder="min" placeholderTextColor={C.muted3} style={[smallInput, { flex: 1 }]} />
                            ) : (
                              <TextInput value={st.reps} onChangeText={(t) => patchSet(bpi, exi, si, { reps: t.replace(/[^0-9]/g, '') })} keyboardType="number-pad" placeholder="—" placeholderTextColor={C.muted3} style={[smallInput, { flex: 1 }]} />
                            )}
                            <Pressable onPress={() => setOpenSet(adv ? null : k)} style={{ width: 30, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={4}>
                              <Icon name={adv ? 'chevUp' : 'chevDown'} size={15} color={hasAdv ? C.orange : C.muted} strokeWidth={2.2} />
                            </Pressable>
                            <Pressable onPress={() => removeSet(bpi, exi, si)} disabled={ex.sets.length === 1} style={{ width: 24, alignItems: 'center', opacity: ex.sets.length === 1 ? 0.3 : 1 }} hitSlop={6}>
                              <Icon name="close" size={13} color={C.muted2} strokeWidth={2.2} />
                            </Pressable>
                          </View>
                          {adv ? (
                            <View style={{ gap: 8, padding: 10, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.025)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                              <View style={{ flexDirection: 'row', gap: 7 }}>
                                {([
                                  ['REST (S)', st.rest, (t: string) => patchSet(bpi, exi, si, { rest: t.replace(/[^0-9]/g, '') }), 'number-pad'],
                                  ['TEMPO', st.tempo, (t: string) => patchSet(bpi, exi, si, { tempo: t }), 'default'],
                                ] as const).map(([l, v, fn, kb]) => (
                                  <View key={l} style={{ flex: 1 }}>
                                    <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3, marginBottom: 4 }}>{l}</Mono>
                                    <TextInput value={v} onChangeText={fn} keyboardType={kb as any} placeholder={l === 'TEMPO' ? '3-0-1-0' : '—'} placeholderTextColor={C.muted3} style={smallInput} />
                                  </View>
                                ))}
                              </View>
                              <View style={{ flexDirection: 'row', gap: 7 }}>
                                {([
                                  ['% RM', st.rm, (t: string) => patchSet(bpi, exi, si, { rm: t.replace(/[^0-9.]/g, '') }), 'decimal-pad'],
                                  ['RIR', st.rir, (t: string) => patchSet(bpi, exi, si, { rir: t.replace(/[^0-9]/g, '') }), 'number-pad'],
                                  ['SS GROUP', st.ss, (t: string) => patchSet(bpi, exi, si, { ss: t }), 'default'],
                                ] as const).map(([l, v, fn, kb]) => (
                                  <View key={l} style={{ flex: 1 }}>
                                    <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3, marginBottom: 4 }}>{l}</Mono>
                                    <TextInput value={v} onChangeText={fn} keyboardType={kb as any} placeholder={l === 'SS GROUP' ? 'A' : '—'} placeholderTextColor={C.muted3} style={smallInput} />
                                  </View>
                                ))}
                              </View>
                              <View>
                                <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted3, marginBottom: 4 }}>NOTES</Mono>
                                <TextInput value={st.notes} onChangeText={(t) => patchSet(bpi, exi, si, { notes: t })} placeholder="Cues, setup, form notes…" placeholderTextColor={C.muted3} style={[smallInput, { textAlign: 'left', fontFamily: F.body, paddingHorizontal: 10 }]} />
                              </View>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                    <Pressable onPress={() => addSet(bpi, exi)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 9, borderRadius: 10, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.13)' }}>
                      <Icon name="plus" size={13} color={C.muted} strokeWidth={2.2} />
                      <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.muted }}>Add set</Text>
                    </Pressable>
                  </View>
                ))}

                {bp.body_part.trim() ? (
                  <DashedBtn small text="Add Exercises" onPress={() => openPicker(bpi)} />
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 13, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(255,255,255,0.015)' }}>
                    <Icon name="plus" size={14} color={C.muted3} strokeWidth={2.2} />
                    <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.muted3 }}>Enter the workout name to add exercises</Text>
                  </View>
                )}
              </Card>
            ))}
            <DashedBtn text="Add Workout Section" onPress={() => setBodyParts((xs) => [...xs, { body_part: '', exercises: [] }])} />
          </>
        )}

        {createM.isError ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: hexA(C.red, 0.08), borderWidth: 1, borderColor: hexA(C.red, 0.28) }}>
            <Icon name="alert" size={14} color={C.red} strokeWidth={2.2} />
            <Body style={{ flex: 1, fontSize: 12, color: '#E0A090' }}>Couldn't create plan: {(createM.error as Error).message}</Body>
          </View>
        ) : null}
      </Page>

      {/* Sticky footer */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 12, paddingBottom: insets.bottom + 14, backgroundColor: 'rgba(8,6,6,0.96)', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
        {missingHint ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 9 }}>
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.gold }} />
            <Body style={{ flex: 1, fontSize: 11.5, color: C.muted2 }}>{missingHint}</Body>
          </View>
        ) : canSubmit ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 9 }}>
            <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: isOnline ? C.green : C.gold }} />
            <Body style={{ flex: 1, fontSize: 11.5, color: C.muted2 }}>
              {isOnline
                ? `${planName.trim()} · ${modality} · ${contentCount} ${modality === 'Yoga' || modality === 'Boxing' ? 'activit' + (contentCount === 1 ? 'y' : 'ies') : 'exercise' + (contentCount === 1 ? '' : 's')} · valid 42 days`
                : 'Offline — the plan saves to this device and syncs automatically'}
            </Body>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={guardedBack} style={{ paddingVertical: 15, paddingHorizontal: 20, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.ink3 }}>Cancel</Text>
          </Pressable>
          <Pressable onPress={submit} disabled={!canSubmit} style={{ flex: 1, opacity: canSubmit || done ? 1 : 0.5 }}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 14 }}>
              <Icon name="checks" path={done ? 'M20 6 9 17l-5-5' : undefined} size={16} color="#fff" strokeWidth={2.6} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: '#fff' }}>
                {createM.isPending ? 'Creating…' : done ? (savedOffline ? 'Saved on device ✓' : 'Sent for review!') : 'Create Plan'}
              </Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>

      {/* Exercise picker — multi-select, mirrors the web ExerciseSelection page */}
      <Modal visible={pickerFor !== null} transparent animationType="slide" onRequestClose={() => setPickerFor(null)}>
        <Pressable onPress={() => setPickerFor(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <Pressable onPress={() => {}} style={{ height: '90%', backgroundColor: '#0E0A09', borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14 }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 14 }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 20 }}>Add Exercises</Serif>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>
                  {pickerFor !== null ? `${bodyParts[pickerFor]?.body_part.trim() || `Workout ${pickerFor + 1}`} · ` : ''}{modality} — select as many as you need.
                </Body>
              </View>
              <Pressable onPress={() => setPickerFor(null)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 10 }}>
              <Icon name="search" size={17} color={C.muted3} strokeWidth={2} />
              <TextInput value={exSearch} onChangeText={setExSearch} placeholder="Search exercises, muscle groups…" placeholderTextColor={C.muted3} autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 15, color: '#fff', padding: 0 }} />
              {exSearch ? (
                <Pressable onPress={() => setExSearch('')} hitSlop={8}><Icon name="close" size={14} color={C.muted3} strokeWidth={2.2} /></Pressable>
              ) : null}
            </View>

            {/* + Add custom exercise */}
            {!customOpen ? (
              <Pressable onPress={() => { setCustomName(exSearch.trim()); setCustomOpen(true); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, borderRadius: 13, borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexA(C.orange, 0.32), backgroundColor: hexA(C.orange, 0.05), marginBottom: 10 }}>
                <Icon name="plus" size={15} color={C.orange} strokeWidth={2.6} />
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: C.orange }}>Add Custom Exercise</Text>
              </Pressable>
            ) : (
              <View style={{ padding: 13, borderRadius: 14, backgroundColor: hexA(C.orange, 0.06), borderWidth: 1, borderColor: hexA(C.orange, 0.28), gap: 10, marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Mono style={{ flex: 1, fontSize: 10, letterSpacing: 1, color: C.orange }}>CUSTOM EXERCISE</Mono>
                  <Pressable onPress={() => setCustomOpen(false)} hitSlop={8}><Icon name="close" size={15} color={C.muted} strokeWidth={2.3} /></Pressable>
                </View>
                <TextInput value={customName} onChangeText={setCustomName} placeholder="Exercise name *" placeholderTextColor={C.muted3} style={inputStyle} />
                <TextInput value={customMuscle} onChangeText={setCustomMuscle} placeholder="Muscle group * (e.g. Chest, Core)" placeholderTextColor={C.muted3} style={inputStyle} />
                <View style={{ flexDirection: 'row', gap: 7 }}>
                  {(['reps', 'duration'] as const).map((m) => (
                    <Chip key={m} text={m === 'reps' ? 'Measured in reps' : 'Measured in time'} active={customMeasure === m} onPress={() => setCustomMeasure(m)} color={C.blue} />
                  ))}
                </View>
                <View style={{ opacity: customName.trim() && customMuscle.trim() ? 1 : 0.45 }} pointerEvents={customName.trim() && customMuscle.trim() ? 'auto' : 'none'}>
                  <GradientButton label="Add & Select" onPress={addCustomToPool} />
                </View>
              </View>
            )}

            {(() => {
              const q = exSearch.trim().toLowerCase();
              const existing = new Set((pickerFor !== null ? bodyParts[pickerFor]?.exercises ?? [] : []).map((e) => e.name.toLowerCase()));
              const match = (e: DbExercise) => !q || e.name.toLowerCase().includes(q) || (e.muscle_group ?? '').toLowerCase().includes(q) || (e.equipment ?? '').toLowerCase().includes(q);
              const customList = customPool.filter(match);
              const dbList = (poolQ.data ?? []).filter((e) => match(e) && !customPool.some((c) => c.name.toLowerCase() === e.name.toLowerCase()));
              const groups = new Map<string, DbExercise[]>();
              for (const e of dbList) {
                const letter = e.name[0]?.toUpperCase() ?? '#';
                if (!groups.has(letter)) groups.set(letter, []);
                groups.get(letter)!.push(e);
              }
              const row = (e: DbExercise, custom: boolean) => {
                const already = existing.has(e.name.toLowerCase());
                const sel = !!selPick[e.name];
                return (
                  <Pressable
                    key={e.name}
                    disabled={already}
                    onPress={() => togglePick(e.name, e.measurement_type === 'duration' ? 'duration' : 'reps')}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 13, backgroundColor: sel ? hexA(C.orange, 0.09) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: sel ? hexA(C.orange, 0.4) : 'rgba(255,255,255,0.07)', opacity: already ? 0.45 : 1 }}
                  >
                    <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: hexA(custom ? C.gold : C.orange, 0.1), alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name={custom ? 'sparkle' : 'dumbbell'} size={15} color={custom ? C.gold : C.orange} strokeWidth={1.9} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Body style={{ fontSize: 14, fontFamily: F.bodySemi, color: sel ? C.orange : '#fff' }} numberOfLines={1}>{e.name}</Body>
                      {e.muscle_group || e.equipment ? <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{[e.muscle_group, e.equipment].filter(Boolean).join(' · ')}</Body> : null}
                    </View>
                    {already ? (
                      <Mono style={{ fontSize: 9, color: C.muted3 }}>ADDED</Mono>
                    ) : (
                      <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: sel ? C.orange : 'rgba(255,255,255,0.18)', backgroundColor: sel ? C.orange : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                        {sel ? <Icon path="M20 6 9 17l-5-5" size={12} color="#0c0808" strokeWidth={3} /> : null}
                      </View>
                    )}
                  </Pressable>
                );
              };
              return (
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: (kbH > 0 ? kbH : 0) + 12, gap: 8 }}>
                  {customList.length ? (
                    <>
                      <Mono style={{ fontSize: 9.5, letterSpacing: 1.4, color: C.gold, marginTop: 2 }}>CUSTOM</Mono>
                      {customList.map((e) => row(e, true))}
                    </>
                  ) : null}
                  {poolQ.isLoading ? (
                    <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 24 }}>Loading exercises…</Body>
                  ) : dbList.length === 0 && customList.length === 0 ? (
                    <Body style={{ color: C.muted2, textAlign: 'center', paddingVertical: 24 }}>{q ? `Nothing matches “${exSearch.trim()}” — add it as a custom exercise above.` : 'No saved exercises for this modality. Add a custom one above.'}</Body>
                  ) : (
                    Array.from(groups.keys()).sort().map((letter) => (
                      <View key={letter} style={{ gap: 8 }}>
                        <Mono style={{ fontSize: 9.5, letterSpacing: 1.4, color: C.muted3, marginTop: 2 }}>{letter}</Mono>
                        {groups.get(letter)!.map((e) => row(e, false))}
                      </View>
                    ))
                  )}
                </ScrollView>
              );
            })()}

            {/* Confirm bar */}
            <View style={{ paddingTop: 10, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
              <View style={{ opacity: Object.keys(selPick).length ? 1 : 0.45 }} pointerEvents={Object.keys(selPick).length ? 'auto' : 'none'}>
                <GradientButton
                  label={Object.keys(selPick).length ? `Add ${Object.keys(selPick).length} Exercise${Object.keys(selPick).length === 1 ? '' : 's'}` : 'Select exercises to add'}
                  onPress={confirmPick}
                />
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Unsaved-changes guard */}
      <Modal visible={exitConfirm} transparent animationType="fade" onRequestClose={() => setExitConfirm(false)}>
        <Pressable onPress={() => setExitConfirm(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 340, backgroundColor: '#12100E', borderWidth: 1, borderColor: 'rgba(255,150,90,0.16)', borderRadius: 20, padding: 20, gap: 14 }}>
            <Serif style={{ fontSize: 19 }}>Discard this plan?</Serif>
            <Body style={{ fontSize: 12.5, color: C.muted2 }}>You have unsaved changes. Leaving now will discard the plan you're building.</Body>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable onPress={() => setExitConfirm(false)} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Keep Editing</Text>
              </Pressable>
              <Pressable onPress={() => { setExitConfirm(false); goBack(); }} style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(C.red, 0.14), borderWidth: 1, borderColor: hexA(C.red, 0.4) }}>
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.red }}>Discard</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const colHead = { fontFamily: F.mono, fontSize: 9.5, color: C.faint, textTransform: 'uppercase' as const, letterSpacing: 0.6 };
