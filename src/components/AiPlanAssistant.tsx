/* Odds AI plan assistant panel (16 Oct 2026), shown at the top of Create Plan for an Essentials client
   the trainer may plan for: pick a split (sessions a week = the client's weekly slots, no picker since 16 Oct 2026),
   an optional note, then "Generate workout plan": the edge function ai-plan-draft drafts the plan from
   the client's latest QHP, medical and blood reports and from our exercises; the parent drops the
   draft into the normal builder, where the trainer edits, adds and deletes anything before submitting.
   Nothing is saved until the trainer submits. */
import React from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono, Serif } from './primitives';
import { trackEvent } from '../lib/amplitude';
import { useAiPlanDraft } from '../lib/aiPlanQueries';
import { SPLITS, splitOf, aiPromptLine, sourcesLine, draftExerciseCount, draftNewExercises, type AiPlanPreview, type AiPlanResult, type SplitKey } from '../lib/aiPlanDraft';

const AI = '#A78BFA';
const STEPS = ['Reading the QHP', 'Checking blood markers and medical history', 'Picking exercises from the Odds library', 'Setting sets, reps and rest', 'Checking every exercise against the library'];

export function AiPlanAssistant({ clientId, clientName, preview, onApply }: {
  clientId: string;
  clientName: string;
  preview: AiPlanPreview;
  /** Drop the draft into the builder (the parent asks before replacing exercises already in the form).
      `prompt` is the registry's ai_prompt for this draft: the split label and the note as one line. */
  onApply: (r: AiPlanResult, prompt: string) => void;
}) {
  const draftM = useAiPlanDraft();
  const [open, setOpen] = React.useState(true);
  const [split, setSplit] = React.useState<SplitKey | null>(null);
  const [note, setNote] = React.useState('');
  const [result, setResult] = React.useState<AiPlanResult | null>(null);
  const [step, setStep] = React.useState(0);
  const [secs, setSecs] = React.useState(0);

  // The waiting line: a step every 6 s and a seconds counter (a draft takes 20 to 40 s).
  React.useEffect(() => {
    if (!draftM.isPending) { setStep(0); setSecs(0); return; }
    const t0 = Date.now();
    const t = setInterval(() => {
      const s = Math.round((Date.now() - t0) / 1000);
      setSecs(s);
      setStep(Math.min(STEPS.length - 1, Math.floor(s / 6)));
    }, 1000);
    return () => clearInterval(t);
  }, [draftM.isPending]);

  const generate = async () => {
    if (!split || draftM.isPending) return;
    trackEvent('AI Plan Generate Tapped', { client_id: clientId, split, has_note: !!note.trim() });
    try {
      // Sessions a week: the server takes the client's weekly slot count (owner, 16 Oct 2026: no picker).
      const r = await draftM.mutateAsync({ clientId, split, note });
      setResult(r);
      trackEvent('AI Plan Generated', { client_id: clientId, split, model: r.model, exercises: draftExerciseCount(r.draft), not_in_db: draftNewExercises(r.draft).length, dropped: r.dropped.length });
      onApply(r, aiPromptLine(r.draft.split_label || splitOf(split)?.label || split, note));
    } catch (e: any) {
      trackEvent('AI Plan Generate Failed', { client_id: clientId, split, error: String(e?.message ?? e).slice(0, 120) });
    }
  };

  const src = sourcesLine(preview.sources);

  return (
    <LinearGradient colors={['rgba(76,52,140,0.42)', 'rgba(18,14,22,0.6)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ borderRadius: 20, borderWidth: 1, borderColor: hexA(AI, 0.4), padding: 15, gap: 13 }}>
      <Pressable onPress={() => setOpen((o) => !o)} hitSlop={10} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA(AI, 0.16), borderWidth: 1, borderColor: hexA(AI, 0.45), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="sparkle" size={18} color={AI} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Serif style={{ fontSize: 17 }}>Odds AI plan assistant</Serif>
          <Body style={{ fontSize: 11, color: C.muted2, marginTop: 2, lineHeight: 15 }}>{preview.essentials ? 'Essentials client · ' : ''}Drafts {clientName.split(' ')[0]}'s Strength Training plan from the QHP, medical and blood reports</Body>
        </View>
        <Icon name={open ? 'chevUp' : 'chevDown'} size={15} color={AI} strokeWidth={2.4} />
      </Pressable>

      {open ? (
        <>
          {src ? (
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.25)' }}>
              <Icon name="file" size={12} color={C.muted} strokeWidth={2.1} />
              <Body style={{ flex: 1, fontSize: 11, color: C.ink3, lineHeight: 15 }}>Reads {src}</Body>
            </View>
          ) : null}

          {/* 1 · split */}
          <View style={{ gap: 8 }}>
            <Mono style={{ fontSize: 9.5, letterSpacing: 1.3, color: AI }}>CHOOSE A SPLIT</Mono>
            {SPLITS.map((s) => {
              const active = split === s.key;
              return (
                <Pressable key={s.key} onPress={() => setSplit(s.key)} hitSlop={4} accessibilityRole="radio" accessibilityState={{ selected: active }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 11, borderRadius: 14, backgroundColor: active ? hexA(AI, 0.16) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: active ? hexA(AI, 0.6) : 'rgba(255,255,255,0.08)' }}>
                  <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: active ? AI : C.muted3, alignItems: 'center', justifyContent: 'center' }}>
                    {active ? <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: AI }} /> : null}
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: active ? '#fff' : C.ink }}>{s.label}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                      {s.sections.map((n) => (
                        <View key={n} style={{ paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)' }}>
                          <Text style={{ fontFamily: F.bodySemi, fontSize: 9.5, color: C.ink3 }}>{n}</Text>
                        </View>
                      ))}
                    </View>
                    <Body style={{ fontSize: 10.5, color: C.muted2 }}>{s.blurb}</Body>
                  </View>
                </Pressable>
              );
            })}
          </View>


          <View style={{ gap: 6 }}>
            <Mono style={{ fontSize: 9.5, letterSpacing: 1.3, color: C.muted2 }}>NOTE FOR ODDS AI (OPTIONAL)</Mono>
            <TextInput value={note} onChangeText={(t) => setNote(t.slice(0, 300))} placeholder="e.g. no machines at home, wants to focus on posture" placeholderTextColor={C.muted3} multiline
              style={{ minHeight: 48, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.03)', color: '#fff', fontFamily: F.body, fontSize: 13, textAlignVertical: 'top' }} />
          </View>

          <Pressable onPress={generate} disabled={!split || draftM.isPending} hitSlop={6} accessibilityRole="button" accessibilityState={{ disabled: !split || draftM.isPending }}
            style={{ borderRadius: 14, overflow: 'hidden', opacity: !split ? 0.5 : 1 }}>
            <LinearGradient colors={['#8B5CF6', '#6D28D9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 }}>
              {draftM.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="sparkle" size={15} color="#fff" strokeWidth={2.2} />}
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>
                {draftM.isPending ? `Drafting… ${secs}s` : !split ? 'Choose a split first' : result ? 'Generate again' : 'Generate workout plan'}
              </Text>
            </LinearGradient>
          </Pressable>
          {draftM.isPending ? <Body style={{ fontSize: 11, color: AI, textAlign: 'center' }}>{STEPS[step]}…</Body> : null}
          {draftM.error && !draftM.isPending ? <Body style={{ fontSize: 11.5, color: C.red }}>{(draftM.error as Error).message}</Body> : null}

          {result && !draftM.isPending ? (
            <View style={{ gap: 9, padding: 12, borderRadius: 14, backgroundColor: hexA(C.green, 0.07), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Icon name="checks" size={14} color={C.green} strokeWidth={2.4} />
                <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 12.5, color: '#fff' }}>
                  Draft added below: {draftExerciseCount(result.draft)} exercises in {result.draft.sections.map((s) => s.name).join(', ')}
                </Text>
              </View>
              <Body style={{ fontSize: 11, color: C.muted2, lineHeight: 15 }}>Change, add or delete anything, then submit. It goes for approval like any plan.</Body>
              {draftNewExercises(result.draft).length ? (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 9, borderRadius: 11, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
                  <Icon name="plus" size={11} color={C.gold} strokeWidth={2.6} />
                  <Body style={{ flex: 1, fontSize: 11, color: C.gold, lineHeight: 15 }}>
                    Not in our library yet: {draftNewExercises(result.draft).join(', ')}. They are marked NOT IN DB below and join the library when you submit; delete any you do not want.
                  </Body>
                </View>
              ) : null}
              {result.draft.rationale.length ? (
                <View style={{ gap: 4 }}>
                  <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: C.green }}>WHY THIS PLAN</Mono>
                  {result.draft.rationale.map((l, i) => <Body key={i} style={{ fontSize: 11.5, color: C.ink, lineHeight: 16 }}>· {l}</Body>)}
                </View>
              ) : null}
              {result.draft.avoided.length ? (
                <View style={{ gap: 4 }}>
                  <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: C.gold }}>AVOIDED</Mono>
                  {result.draft.avoided.map((l, i) => <Body key={i} style={{ fontSize: 11.5, color: C.ink3, lineHeight: 16 }}>· {l}</Body>)}
                </View>
              ) : null}
              {result.dropped.length ? (
                <Body style={{ fontSize: 10.5, color: C.muted3 }}>Left out (not in the Odds library): {result.dropped.join(', ')}</Body>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </LinearGradient>
  );
}
