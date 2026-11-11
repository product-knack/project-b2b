import React from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono } from './primitives';
import {
  REHAB_AREAS, REHAB_AREA_OTHER, REHAB_MAX_ENTRIES, REHAB_REFERRAL_LABEL, REHAB_SIDE_LABEL, REHAB_STATUS_LABEL, REHAB_TEXT_MAX, REHAB_TYPE_LABEL,
  emptyRehabEntry, rehabPainText, rehabProgress,
  type RecoveryRehabEntry, type RehabReferral, type RehabSide, type RehabStatus, type RehabTrend, type RehabType,
} from '../lib/recoveryRehab';

/* ============================================================================
   Recovery and rehab entries inside the QHP form's Pain / Discomfort section
   (11 Nov 2026). Native twin of the web RecoveryRehabCard: one card per area
   with area and side, pain 0 to 10, type, current status, the recovery / rehab
   recommendation and any referral. Entries carried from the previous QHP show
   how they stood last time. Saved in the same QHP JSON at
   medicalHistory.recoveryRehab (rules: src/lib/recoveryRehab.ts).
   ========================================================================== */

const IN_BG = 'rgba(255,255,255,0.045)';
const IN_BD = 'rgba(255,255,255,0.1)';
const TREND_TINT: Record<RehabTrend, string> = { better: C.green, resolved: C.green, worse: C.red, same: C.muted2, new: C.blue };

function Lbl({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: '#C8C2BC', marginBottom: 6 }}>{children}</Text>;
}
function Chips({ value, options, onPick }: { value: string; options: { v: string; l: string }[]; onPick: (v: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
      {options.map((o) => {
        const active = value === o.v;
        return (
          <Pressable
            key={o.v}
            onPress={() => onPick(active ? '' : o.v)}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={{ minHeight: 36, justifyContent: 'center', paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.16) : IN_BG, borderWidth: 1, borderColor: active ? hexA(C.orange, 0.55) : IN_BD }}
          >
            <Text style={{ fontFamily: active ? F.bodyBold : F.body, fontSize: 11.5, color: active ? C.orange : '#B8B2AC' }}>{o.l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
function Field({ value, onChange, placeholder, multi, max }: { value: string; onChange: (t: string) => void; placeholder: string; multi?: boolean; max: number }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor="#6B655F"
      multiline={!!multi}
      maxLength={max}
      style={{ backgroundColor: IN_BG, borderWidth: 1, borderColor: IN_BD, borderRadius: 12, paddingHorizontal: 12, paddingVertical: multi ? 10 : 9, minHeight: multi ? 72 : undefined, textAlignVertical: multi ? 'top' : 'center', color: '#fff', fontFamily: F.body, fontSize: 13 }}
    />
  );
}

const opts = <T extends string>(labels: Record<T, string>): { v: string; l: string }[] => (Object.keys(labels) as T[]).map((k) => ({ v: k, l: labels[k] }));
const AREA_OPTS = [...REHAB_AREAS.map((a) => ({ v: a as string, l: a as string })), { v: REHAB_AREA_OTHER, l: 'Other' }];
const SIDE_OPTS = opts(REHAB_SIDE_LABEL);
const TYPE_OPTS = opts(REHAB_TYPE_LABEL);
const STATUS_OPTS = opts(REHAB_STATUS_LABEL);
const REFERRAL_OPTS = opts(REHAB_REFERRAL_LABEL);
const PAIN_OPTS = Array.from({ length: 11 }, (_, n) => ({ v: String(n), l: String(n) }));

export function RehabEntries({ value, onChange }: { value: RecoveryRehabEntry[]; onChange: (next: RecoveryRehabEntry[]) => void }) {
  const entries = value ?? [];
  const setRow = (id: string, patch: Partial<RecoveryRehabEntry>) => onChange(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  return (
    <View style={{ gap: 12 }}>
      <Body style={{ fontSize: 11.5, color: C.muted, lineHeight: 17 }}>
        One entry per area that hurts or is recovering. The client's trainers read the open entries before the next session, and each entry is followed up at the next QHP.
      </Body>

      {entries.length === 0 ? (
        <View style={{ borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.14)', padding: 12 }}>
          <Body style={{ fontSize: 12, color: C.muted3 }}>No entries. Leave empty if the client has no pain, injury or recovery need right now.</Body>
        </View>
      ) : null}

      {entries.map((e, i) => {
        const onList = (REHAB_AREAS as readonly string[]).includes(e.area);
        // A typed area that is not on the list keeps the picker on "Other" with its text box open.
        const picker = e.area === '' ? '' : onList ? e.area : REHAB_AREA_OTHER;
        const progress = rehabProgress(e);
        const last = e.previous
          ? [rehabPainText(e.previous.intensity).toLowerCase(), e.previous.status ? REHAB_STATUS_LABEL[e.previous.status as Exclude<RehabStatus, ''>].toLowerCase() : ''].filter(Boolean).join(', ') || 'on record'
          : '';
        return (
          <View key={e.id} style={{ borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 12, gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Mono style={{ fontSize: 10, letterSpacing: 1.2, color: C.muted2 }}>AREA {i + 1}</Mono>
              <Pressable
                onPress={() => onChange(entries.filter((x) => x.id !== e.id))}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={`Remove area ${i + 1}`}
                style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.3) }}
              >
                <Icon name="trash" size={14} color={C.red} strokeWidth={2} />
              </Pressable>
            </View>

            {e.previous ? (
              <View style={{ borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10, backgroundColor: hexA(TREND_TINT[progress.trend], 0.1), borderWidth: 1, borderColor: hexA(TREND_TINT[progress.trend], 0.3) }}>
                <Body style={{ fontSize: 11.5, color: TREND_TINT[progress.trend], lineHeight: 17 }}>Last QHP: {last}. {progress.line}</Body>
              </View>
            ) : null}

            <View>
              <Lbl>Area of pain or injury</Lbl>
              <Chips
                value={picker}
                options={AREA_OPTS}
                onPick={(v) => setRow(e.id, { area: v === REHAB_AREA_OTHER ? (onList ? ' ' : e.area || ' ') : v })}
              />
              {picker === REHAB_AREA_OTHER ? (
                <View style={{ marginTop: 8 }}>
                  <Field value={e.area.trimStart()} onChange={(t) => setRow(e.id, { area: t === '' ? ' ' : t })} placeholder="Name the area, e.g. Achilles tendon" max={80} />
                </View>
              ) : null}
            </View>

            <View>
              <Lbl>Side</Lbl>
              <Chips value={e.side} options={SIDE_OPTS} onPick={(v) => setRow(e.id, { side: v as RehabSide })} />
            </View>

            <View>
              <Lbl>Pain intensity now, 0 (none) to 10 (worst)</Lbl>
              <Chips value={e.intensity == null ? '' : String(e.intensity)} options={PAIN_OPTS} onPick={(v) => setRow(e.id, { intensity: v === '' ? null : Number(v) })} />
            </View>

            <View>
              <Lbl>Type</Lbl>
              <Chips value={e.type} options={TYPE_OPTS} onPick={(v) => setRow(e.id, { type: v as RehabType })} />
            </View>

            <View>
              <Lbl>Current status</Lbl>
              <Chips value={e.status} options={STATUS_OPTS} onPick={(v) => setRow(e.id, { status: v as RehabStatus })} />
            </View>

            <View>
              <Lbl>Recovery / rehab recommendation</Lbl>
              <Field value={e.recommendation} onChange={(t) => setRow(e.id, { recommendation: t })} placeholder="What the trainers should do or avoid, e.g. no loaded knee flexion past 90 degrees, quad sets daily." multi max={REHAB_TEXT_MAX} />
            </View>

            <View>
              <Lbl>Referral made</Lbl>
              <Chips value={e.referral} options={REFERRAL_OPTS} onPick={(v) => setRow(e.id, { referral: v as RehabReferral })} />
              {e.referral && e.referral !== 'none' ? (
                <View style={{ marginTop: 8 }}>
                  <Field value={e.referralNote} onChange={(t) => setRow(e.id, { referralNote: t })} placeholder="Who, and when if known" max={200} />
                </View>
              ) : null}
            </View>
          </View>
        );
      })}

      {entries.length < REHAB_MAX_ENTRIES ? (
        <Pressable
          onPress={() => onChange([...entries, emptyRehabEntry()])}
          hitSlop={10}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12, backgroundColor: hexA(C.orange, 0.1), borderWidth: 1, borderColor: hexA(C.orange, 0.4) }}
        >
          <Icon name="plus" size={14} color={C.orange} strokeWidth={2.4} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.orange }}>{entries.length === 0 ? 'Add an area' : 'Add another area'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
