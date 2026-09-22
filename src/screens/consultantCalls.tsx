import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator, Alert, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { F } from '../theme';
import { Icon, IconName } from '../icons';
import { useAuth } from '../auth';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { useDoctorIdentity } from '../lib/doctorQueries';
import {
  CallRow, RxData, RxEditEntry, RxMedicineLine, useDoctorCalls, useAmendPrescription, useMedicinesCatalog, useClientDob,
  isSlotElapsed, slotPersonName, rxState, isRxApproved, hasMeetingNotes, hasAiNotes, parseNextFollowUp, followUpLabel,
  timeLabel, fmtLongDate, fmtDayMonth, dateFromYmd, ymdLocal, startOfWeekMon, addDays, MONTHS_LONG, MONTHS_SHORT, DAYS_LONG, describeConsultError,
} from '../lib/consultantQueries';
import { sharePrescriptionPdf } from '../lib/prescriptionSheet';
import {
  CX, ConsultantShell, LCard, SearchBox, SegChip, LightBtn, LightInput, Label, StatusPill, slotTone, RxBadge, ApprovedBadge,
  PrescriptionView, EditHistoryList, MeetingNotesView, AiNotesView, useSlotActions, useNow, initialsOf,
} from '../components/consultantUi';
import { HScroll } from './common';

/* ============ ALL CALLS (port of web ConsultantCalls.tsx, 22 Sep 2026) ============
   Every booking for the doctor, newest first: date filter, patient cards that
   focus the list, KPI tiles over the filtered set, month groups, ten rows a
   page, and per row Prescription / Meeting Summary / AI Notes (one popup, three
   tabs), Reports, Complete and Join. The popup's Prescription tab carries the
   after-call editor (amend_prescription) and Download PDF (expo-print). */

type RangeKey = 'all' | 'today' | 'week' | 'month' | 'custom';
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'all', label: 'All time' }, { key: 'today', label: 'Today' }, { key: 'week', label: 'This week' }, { key: 'month', label: 'This month' }, { key: 'custom', label: 'Custom' },
];
/** Calls per page; the KPI tiles and counts cover every page. */
const PAGE_SIZE = 10;
type DetailTab = 'rx' | 'summary' | 'notes';
const validYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(dateFromYmd(s).getTime());

interface ClientSummary { id: string; name: string; total: number; scheduled: number; completed: number; finalizedRx: number; lastDate: string | null; nextDate: string | null }

/* ---------- prescription editor (port of PrescriptionPanel in amend mode) ---------- */
const FREQUENCIES = ['OD', 'BD', 'TDS', 'QID', 'HS', 'SOS'];
const TIMINGS = ['After food', 'Before food', 'With food', 'Empty stomach', 'Early morning', 'Before bed', 'Any time'];
const DURATION_UNITS = ['days', 'weeks', 'months'];
const newLine = (order: number): RxMedicineLine => ({
  line_id: `m${order}-${Math.random().toString(36).slice(2, 7)}`, medicine_id: null, name: '', strength: null, dose_amount: '1', frequency: 'BD', timing: 'After food',
  duration_value: 5, duration_unit: 'days', is_sos: false, instruction: '', sort_order: order,
});
/** DOB arrives as ISO (clients.date_of_birth) or dd/mm/yyyy strings; parse both. */
const parseDob = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) { const d = dateFromYmd(v); return isNaN(d.getTime()) ? null : d; }
  const m = String(v).match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) { const year = m[3].length === 2 ? Number(`19${m[3]}`) : Number(m[3]); const d = new Date(year, Number(m[2]) - 1, Number(m[1])); if (!isNaN(d.getTime())) return d; }
  return null;
};
const ageOf = (dob: Date): number => { const t = new Date(); let a = t.getFullYear() - dob.getFullYear(); const md = t.getMonth() - dob.getMonth(); if (md < 0 || (md === 0 && t.getDate() < dob.getDate())) a -= 1; return a; };

function ChipRow({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} accessibilityRole="button" accessibilityState={{ selected: value === o }} hitSlop={4}
          style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: value === o ? CX.indigo : CX.slate200, backgroundColor: value === o ? CX.indigo : CX.white }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: value === o ? '#fff' : CX.slate600 }}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function PrescriptionEditor({ call, doctorName, onSaved, onCancel }: { call: CallRow; doctorName: string; onSaved: (rx: RxData, history: RxEditEntry[]) => void; onCancel: () => void }) {
  const clientName = slotPersonName(call.client);
  const initial = call.prescription;
  const catalogQ = useMedicinesCatalog();
  const catalog = catalogQ.data ?? [];
  const medCatalog = catalog.filter((c) => c.item_type !== 'blood_test');
  const testCatalog = catalog.filter((c) => c.item_type === 'blood_test');
  const dobQ = useClientDob(call.client_id);
  const amend = useAmendPrescription();
  const [medicines, setMedicines] = React.useState<RxMedicineLine[]>(() => (initial?.medicines?.length ? initial.medicines.map((m, i) => ({ ...m, sort_order: i + 1 })) : [newLine(1)]));
  // A fresh prescription opens with its first line ready to fill; an existing one lists its lines collapsed.
  const [editingId, setEditingId] = React.useState<string | null>(() => (initial?.medicines?.length ? null : medicines[0]?.line_id ?? null));
  const [tests, setTests] = React.useState<string[]>(() => (initial?.lab_tests ?? []).map((t) => t.name));
  const [advice, setAdvice] = React.useState(() => (initial?.advice ?? []).map((a) => a.text).join('\n'));
  const [fuValue, setFuValue] = React.useState(() => (initial?.follow_up?.after_value != null ? String(initial.follow_up.after_value) : ''));
  const [fuUnit, setFuUnit] = React.useState(initial?.follow_up?.after_unit ?? 'days');
  const [note, setNote] = React.useState('');
  const [medQuery, setMedQuery] = React.useState('');
  const [testQuery, setTestQuery] = React.useState('');
  const isFinalized = initial?.status === 'finalized';
  const nextVersion = isFinalized ? (initial?.version ?? 1) + 1 : 1;
  const dobDate = parseDob(dobQ.data ?? initial?.patient?.dob ?? null);
  const age = dobDate ? ageOf(dobDate) : initial?.patient?.age ?? null;

  const setLine = (id: string, patch: Partial<RxMedicineLine>) => setMedicines((prev) => prev.map((m) => (m.line_id === id ? { ...m, ...patch } : m)));
  const removeLine = (id: string) => { setMedicines((prev) => prev.filter((m) => m.line_id !== id)); if (editingId === id) setEditingId(null); };
  const addLine = () => { const l = newLine(medicines.length + 1); setMedicines((prev) => [...prev, l]); setEditingId(l.line_id); setMedQuery(''); };

  const buildPayload = (): RxData => ({
    schema_version: 1,
    status: 'draft',
    version: initial?.version ?? 1,
    date: initial?.date ?? new Date().toISOString(),
    doctor: { id: call.doctor_id, name: doctorName },
    patient: { name: clientName, dob: dobDate ? ymdLocal(dobDate) : null, age },
    medicines: medicines.filter((m) => m.name.trim() !== '').map((m, i) => ({ ...m, is_sos: m.frequency === 'SOS', sort_order: i + 1 })),
    lab_tests: tests.map((name, i) => ({ line_id: `l${i + 1}`, name, test_id: testCatalog.find((t) => t.name === name)?.id ?? null, sort_order: i + 1 })),
    advice: advice.split('\n').map((s) => s.trim()).filter(Boolean).map((text, i) => ({ line_id: `a${i + 1}`, text, sort_order: i + 1 })),
    follow_up: { after_value: fuValue.trim() === '' ? null : Number(fuValue), after_unit: fuUnit, note: '' },
    history: (initial?.history as unknown[]) ?? [],
  });
  const save = () => {
    const payload = buildPayload();
    if (payload.medicines.length === 0) { Alert.alert('Add a medicine', 'Add at least one medicine before saving.'); return; }
    if (fuValue.trim() !== '' && !(Number(fuValue) > 0)) { Alert.alert('Check the follow-up', 'The follow-up must be a number of days, weeks or months.'); return; }
    Keyboard.dismiss();
    amend.mutate({ slotId: call.id, payload, note: note.trim() || null }, {
      onSuccess: (out) => { onSaved(out.prescription, out.edit_history); Alert.alert('Saved', `Prescription saved as v${out.prescription.version ?? 1}`); },
      onError: (e) => Alert.alert("Couldn't save the prescription", describeConsultError(e)),
    });
  };

  const q = medQuery.trim().toLowerCase();
  const medMatches = medCatalog.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.generic_name ?? '').toLowerCase().includes(q)).slice(0, 8);
  const tq = testQuery.trim().toLowerCase();
  const testMatches = testCatalog.filter((c) => !tests.includes(c.name) && (!tq || c.name.toLowerCase().includes(tq))).slice(0, 8);
  const addTest = (name: string) => { const n = name.trim(); if (!n || tests.includes(n)) return; setTests((prev) => [...prev, n]); setTestQuery(''); };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ backgroundColor: CX.white, borderRadius: 16, borderWidth: 1, borderColor: CX.indigo100, padding: 14, gap: 4 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: CX.slate900 }}>{isFinalized ? `Edit prescription (v${initial?.version ?? 1} to v${nextVersion})` : 'Write prescription'}</Text>
        <Text style={{ fontFamily: F.bodyReg, fontSize: 12, color: CX.slate500, lineHeight: 17 }}>For {clientName}{age != null ? `, ${age} yrs` : ''}. Saved through the edit trail; the CRM sees the new version at once.</Text>
      </View>

      {/* medicines */}
      <View style={{ gap: 8 }}>
        <Label>Medicines · {medicines.filter((m) => m.name.trim()).length}</Label>
        {medicines.map((m, idx) => m.line_id !== editingId ? (
          <Pressable key={m.line_id} onPress={() => { setEditingId(m.line_id); setMedQuery(''); }} accessibilityRole="button" accessibilityLabel={`Edit ${m.name || 'medicine'}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: CX.white, borderWidth: 1, borderColor: CX.slate200, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: CX.indigo100, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: CX.indigo }}>{idx + 1}</Text></View>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: m.name ? CX.slate900 : CX.slate400 }}>{m.name || 'Untitled medicine (tap to pick)'}{m.strength ? <Text style={{ fontFamily: F.bodyReg, color: CX.slate500 }}> {m.strength}</Text> : null}</Text>
              <Text numberOfLines={1} style={{ fontFamily: F.bodyReg, fontSize: 11.5, color: CX.slate500 }}>{m.dose_amount} · {m.frequency} · {m.timing}{m.duration_value ? ` · ${m.duration_value} ${m.duration_unit}` : ''}</Text>
            </View>
            <Pressable onPress={() => removeLine(m.line_id)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove medicine"><Icon name="trash" size={14} color={CX.rose600} strokeWidth={2} /></Pressable>
          </Pressable>
        ) : (
          <View key={m.line_id} style={{ backgroundColor: CX.indigo50, borderWidth: 1, borderColor: CX.indigo200, borderRadius: 16, padding: 12, gap: 10 }}>
            {m.name ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 14, color: CX.slate900 }}>{m.name}{m.strength ? <Text style={{ fontFamily: F.bodyReg, color: CX.slate500 }}> {m.strength}</Text> : null}</Text>
                <LightBtn small label="Change" tone="ghost" onPress={() => { setLine(m.line_id, { medicine_id: null, name: '', strength: null }); setMedQuery(''); }} />
              </View>
            ) : (
              <View style={{ gap: 6 }}>
                <LightInput value={medQuery} onChangeText={setMedQuery} placeholder="Search medicine or type your own" autoFocus returnKeyType="done"
                  onSubmitEditing={() => { const n = medQuery.trim(); if (n) setLine(m.line_id, { medicine_id: null, name: n, strength: null }); }} />
                {catalogQ.isPending ? <ActivityIndicator color={CX.indigo} /> : (
                  <View style={{ gap: 4 }}>
                    {medMatches.map((c) => (
                      <Pressable key={c.id} onPress={() => { setLine(m.line_id, { medicine_id: c.id, name: c.name, strength: c.strength ?? null }); setMedQuery(''); }} accessibilityRole="button"
                        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: pressed ? CX.indigo100 : CX.white })}>
                        <Icon name="clipboard" size={12} color={CX.indigo} strokeWidth={2.2} />
                        <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 12.5, color: CX.slate800 }}>{c.name}{c.strength ? <Text style={{ fontFamily: F.bodyReg, color: CX.slate500 }}> {c.strength}</Text> : null}</Text>
                        {c.generic_name ? <Text numberOfLines={1} style={{ fontFamily: F.bodyReg, fontSize: 10.5, color: CX.slate400, maxWidth: 120 }}>{c.generic_name}</Text> : null}
                      </Pressable>
                    ))}
                    {q && !medCatalog.some((c) => c.name.toLowerCase() === q) ? (
                      <Pressable onPress={() => setLine(m.line_id, { medicine_id: null, name: medQuery.trim(), strength: null })} accessibilityRole="button"
                        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: pressed ? CX.indigo100 : CX.white, borderWidth: 1, borderStyle: 'dashed', borderColor: CX.indigo200 })}>
                        <Icon name="plus" size={12} color={CX.indigo} strokeWidth={2.4} />
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: CX.indigo }}>Use "{medQuery.trim()}" as typed</Text>
                      </Pressable>
                    ) : null}
                  </View>
                )}
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1, gap: 5 }}><Label>Dose</Label><LightInput value={m.dose_amount} onChangeText={(v) => setLine(m.line_id, { dose_amount: v })} placeholder="1" /></View>
              <View style={{ flex: 1, gap: 5 }}><Label>Duration</Label>
                <LightInput value={m.duration_value == null ? '' : String(m.duration_value)} onChangeText={(v) => setLine(m.line_id, { duration_value: v.trim() === '' ? null : Number(v.replace(/[^0-9]/g, '')) || null })} keyboardType="number-pad" placeholder="5" />
              </View>
            </View>
            <View style={{ gap: 5 }}><Label>Frequency</Label><ChipRow options={FREQUENCIES} value={m.frequency} onChange={(v) => setLine(m.line_id, { frequency: v, is_sos: v === 'SOS' })} /></View>
            <View style={{ gap: 5 }}><Label>Timing</Label><ChipRow options={TIMINGS} value={m.timing} onChange={(v) => setLine(m.line_id, { timing: v })} /></View>
            <View style={{ gap: 5 }}><Label>Duration unit</Label><ChipRow options={DURATION_UNITS} value={m.duration_unit} onChange={(v) => setLine(m.line_id, { duration_unit: v })} /></View>
            <View style={{ gap: 5 }}><Label>Instruction (optional)</Label><LightInput value={m.instruction} onChangeText={(v) => setLine(m.line_id, { instruction: v })} placeholder="Written on the sheet instead of the built sentence" /></View>
            <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
              <LightBtn small label="Remove" icon="trash" tone="rose" onPress={() => removeLine(m.line_id)} />
              <LightBtn small label="Done" icon="checks" tone="solid" onPress={() => setEditingId(null)} />
            </View>
          </View>
        ))}
        <LightBtn label="Add medicine" icon="plus" tone="outline" onPress={addLine} />
      </View>

      {/* tests */}
      <View style={{ gap: 8 }}>
        <Label>Tests advised · {tests.length}</Label>
        {tests.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {tests.map((t) => (
              <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: CX.sky50, borderWidth: 1, borderColor: CX.sky100, borderRadius: 999, paddingLeft: 10, paddingRight: 6, paddingVertical: 5 }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: CX.sky600 }}>{t}</Text>
                <Pressable onPress={() => setTests((prev) => prev.filter((x) => x !== t))} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${t}`}><Icon name="close" size={11} color={CX.sky600} strokeWidth={2.4} /></Pressable>
              </View>
            ))}
          </View>
        ) : null}
        <LightInput value={testQuery} onChangeText={setTestQuery} placeholder="Search a blood test or type your own" returnKeyType="done" onSubmitEditing={() => addTest(testQuery)} />
        {testQuery.trim() || tests.length === 0 ? (
          <View style={{ gap: 4 }}>
            {testMatches.map((c) => (
              <Pressable key={c.id} onPress={() => addTest(c.name)} accessibilityRole="button" style={({ pressed }) => ({ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: pressed ? CX.sky100 : CX.white, borderWidth: 1, borderColor: CX.slate200 })}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: CX.slate800 }}>{c.name}</Text>
              </Pressable>
            ))}
            {tq && !testCatalog.some((c) => c.name.toLowerCase() === tq) ? <LightBtn small label={`Add "${testQuery.trim()}"`} icon="plus" tone="outline" onPress={() => addTest(testQuery)} style={{ alignSelf: 'flex-start' }} /> : null}
          </View>
        ) : null}
      </View>

      {/* advice */}
      <View style={{ gap: 6 }}>
        <Label>Recommendations · one per line</Label>
        <LightInput value={advice} onChangeText={setAdvice} multiline placeholder={'Walk 30 minutes daily\nAvoid fried food'} style={{ minHeight: 84, textAlignVertical: 'top' }} />
      </View>

      {/* follow-up */}
      <View style={{ gap: 6 }}>
        <Label>Follow up after</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <LightInput value={fuValue} onChangeText={(v) => setFuValue(v.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="Not set" style={{ width: 90 }} />
          <ChipRow options={DURATION_UNITS} value={fuUnit} onChange={setFuUnit} />
        </View>
      </View>

      {/* note */}
      <View style={{ gap: 6 }}>
        <Label>Reason for the change (optional)</Label>
        <LightInput value={note} onChangeText={setNote} placeholder="Recorded on the edit trail" />
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <LightBtn label="Cancel" tone="ghost" onPress={onCancel} disabled={amend.isPending} style={{ flex: 1 }} />
        <LightBtn label={amend.isPending ? 'Saving' : `Save changes as v${nextVersion}`} icon="checks" tone="solid" onPress={save} busy={amend.isPending} style={{ flex: 1.6 }} />
      </View>
    </View>
  );
}

/* ---------- the record popup: Prescription / Meeting Summary / AI Notes ---------- */
function CallRecordSheet({ call, tab, onTab, onClose, onRxSaved, doctorName }: { call: CallRow | null; tab: DetailTab; onTab: (t: DetailTab) => void; onClose: () => void; onRxSaved: (callId: string, rx: RxData, history: RxEditEntry[]) => void; doctorName: string }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => { setEditing(false); }, [call?.id]);
  const visible = !!call;
  const fu = call ? parseNextFollowUp(call.next_follow_up) : null;
  const tone = call ? slotTone(call) : null;
  const savePdf = async () => {
    if (!call?.prescription) return;
    setSaving(true);
    try { await sharePrescriptionPdf({ rx: call.prescription, clientName: slotPersonName(call.client), doctorName: slotPersonName(call.doctor) }); }
    catch (e: any) { Alert.alert("Couldn't build the prescription PDF", e?.message ?? 'Try again.'); }
    finally { setSaving(false); }
  };
  const close = () => { if (editing) { Alert.alert('Discard the edits?', 'The prescription has not been saved.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: onClose }]); return; } onClose(); };
  const TABS: { key: DetailTab; label: string; icon: IconName }[] = [{ key: 'rx', label: 'Prescription', icon: 'clipboard' }, { key: 'summary', label: 'Meeting Summary', icon: 'file' }, { key: 'notes', label: 'AI Notes', icon: 'sparkle' }];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,23,42,0.45)' }} />
        <View accessibilityViewIsModal style={{ maxHeight: '94%', backgroundColor: CX.sheet, borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden', paddingBottom: kbH > 0 ? kbH : insets.bottom + 8 }}>
          {call ? (
            <>
              <View style={{ backgroundColor: CX.white, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10, gap: 8 }}>
                <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: CX.slate200, alignSelf: 'center' }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: CX.slate900 }}>{slotPersonName(call.client)}</Text>
                  {tone ? <StatusPill label={tone.label} tone={tone.tone} /> : null}
                  <RxBadge rx={call.prescription} />
                  <View style={{ flex: 1 }} />
                  <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: CX.slate100, alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={14} color={CX.slate600} strokeWidth={2.4} /></Pressable>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1, minWidth: 180 }}>
                    <Icon name="clock" size={11} color={CX.slate300} strokeWidth={2.2} />
                    <Text numberOfLines={2} style={{ fontFamily: F.bodyReg, fontSize: 11.5, color: CX.slate500, flex: 1 }}>{fmtLongDate(call.consultation_date)} · {timeLabel(call.start_time)} to {timeLabel(call.end_time)}{call.description ? <Text style={{ color: CX.slate400 }}> · {call.description}</Text> : null}</Text>
                  </View>
                  {rxState(call.prescription) !== 'none' ? <LightBtn small label="Download PDF" icon="file" tone="outline" busy={saving} onPress={savePdf} /> : null}
                </View>
              </View>
              <View style={{ backgroundColor: CX.white, borderBottomWidth: 1, borderBottomColor: CX.indigo100, paddingHorizontal: 18, paddingBottom: 10, shadowColor: '#1e293b', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 2, zIndex: 2 }}>
                <View style={{ flexDirection: 'row', backgroundColor: CX.slate100, borderRadius: 999, padding: 4, gap: 4, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)' }}>
                  {TABS.map((t) => (
                    <Pressable key={t.key} onPress={() => onTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 7, borderRadius: 999, backgroundColor: tab === t.key ? CX.white : 'transparent', ...(tab === t.key ? { shadowColor: '#1e293b', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 1 } : null) }}>
                      <Icon name={t.icon} size={12} color={tab === t.key ? CX.indigo : CX.slate500} strokeWidth={2.2} />
                      <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 11, color: tab === t.key ? CX.indigo : CX.slate500 }}>{t.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24, gap: 12 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {tab === 'rx' ? (
                  editing ? (
                    <PrescriptionEditor call={call} doctorName={doctorName} onCancel={() => setEditing(false)} onSaved={(rx, history) => { onRxSaved(call.id, rx, history); setEditing(false); }} />
                  ) : (
                    <>
                      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                        {isRxApproved(call.prescription_approval) ? <ApprovedBadge approval={call.prescription_approval!} /> : (
                          <LightBtn small label={rxState(call.prescription) === 'none' ? 'Write prescription' : 'Edit prescription'} icon="plus" tone="outline" onPress={() => setEditing(true)} />
                        )}
                      </View>
                      <PrescriptionView rx={call.prescription} />
                      <EditHistoryList entries={call.edit_history} />
                      {fu ? (
                        <View style={{ backgroundColor: CX.white, borderRadius: 16, borderWidth: 1, borderColor: CX.slate100, paddingHorizontal: 14, paddingVertical: 10 }}>
                          <Text style={{ fontFamily: F.bodyReg, fontSize: 12, color: CX.slate600 }}><Text style={{ fontFamily: F.bodySemi, color: CX.slate700 }}>CRM follow-up plan:</Text> {followUpLabel(fu)}{fu.note ? <Text style={{ color: CX.slate400 }}> · {fu.note}</Text> : null}</Text>
                        </View>
                      ) : null}
                    </>
                  )
                ) : tab === 'summary' ? <MeetingNotesView summary={call.meeting_summary} /> : <AiNotesView notes={call.ai_notes} />}
              </ScrollView>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/* ---------- the page ---------- */
function KpiTile({ label, value, tone }: { label: string; value: number; tone: 'indigo' | 'emerald' | 'amber' | 'slate' | 'violet' }) {
  const fg = tone === 'indigo' ? CX.indigo : tone === 'emerald' ? CX.emerald600 : tone === 'amber' ? CX.amber600 : tone === 'violet' ? '#7c3aed' : CX.slate600;
  return (
    <LCard pad={12} style={{ flex: 1, minWidth: 96 }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 22, color: fg }}>{value}</Text>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: CX.slate500, marginTop: 2 }}>{label}</Text>
    </LCard>
  );
}

export function ConsultantCalls() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const ident = useDoctorIdentity();
  const callsQ = useDoctorCalls(uid);
  const calls = callsQ.data ?? [];
  const actions = useSlotActions();
  const nowDate = useNow(60_000);
  const now = nowDate.getTime();
  const [range, setRange] = React.useState<RangeKey>('all');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [selectedClient, setSelectedClient] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  React.useEffect(() => { setPage(1); }, [range, from, to, search, selectedClient]);
  const [detail, setDetail] = React.useState<{ call: CallRow; tab: DetailTab } | null>(null);
  // The open row shows the freshest copy of itself when the list re-reads behind it.
  React.useEffect(() => { if (detail) { const fresh = calls.find((c) => c.id === detail.call.id); if (fresh && fresh !== detail.call) setDetail({ ...detail, call: fresh }); } }, [calls]);

  const todayYmd = ymdLocal(nowDate);
  const win = ((): { from: string | null; to: string | null } => {
    switch (range) {
      case 'today': return { from: todayYmd, to: todayYmd };
      case 'week': { const s = startOfWeekMon(nowDate); return { from: ymdLocal(s), to: ymdLocal(addDays(s, 6)) }; }
      case 'month': return { from: `${todayYmd.slice(0, 7)}-01`, to: ymdLocal(new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0)) };
      case 'custom': return { from: validYmd(from) ? from : null, to: validYmd(to) ? to : null };
      default: return { from: null, to: null };
    }
  })();
  const q = search.trim().toLowerCase();
  const inWindow = calls.filter((c) => (!win.from || c.consultation_date >= win.from) && (!win.to || c.consultation_date <= win.to));
  const searched = inWindow.filter((c) => !q || slotPersonName(c.client).toLowerCase().includes(q));
  // Client cards summarise the date-filtered set, not the selected client.
  const clientMap: Record<string, ClientSummary> = {};
  for (const c of searched) {
    const s = clientMap[c.client_id] ?? { id: c.client_id, name: slotPersonName(c.client), total: 0, scheduled: 0, completed: 0, finalizedRx: 0, lastDate: null, nextDate: null };
    if (c.status !== 'cancelled') {
      s.total += 1;
      if (c.status === 'scheduled') s.scheduled += 1;
      if (c.status === 'completed') s.completed += 1;
      if (rxState(c.prescription) === 'finalized') s.finalizedRx += 1;
      if (c.consultation_date <= todayYmd && (!s.lastDate || c.consultation_date > s.lastDate)) s.lastDate = c.consultation_date;
      if (c.status === 'scheduled' && c.consultation_date >= todayYmd && (!s.nextDate || c.consultation_date < s.nextDate)) s.nextDate = c.consultation_date;
    }
    clientMap[c.client_id] = s;
  }
  const activityKey = (s: ClientSummary) => s.lastDate ?? s.nextDate ?? '';
  const clients = Object.values(clientMap).filter((s) => s.total > 0).sort((a, b) => activityKey(b).localeCompare(activityKey(a)) || a.name.localeCompare(b.name));
  const visible = searched.filter((c) => !selectedClient || c.client_id === selectedClient);
  const selectedSummary = selectedClient ? clientMap[selectedClient] ?? null : null;
  const active = visible.filter((c) => c.status !== 'cancelled');
  const counts = {
    total: active.length,
    scheduled: active.filter((c) => c.status === 'scheduled' && !isSlotElapsed(c, now)).length,
    elapsed: active.filter((c) => isSlotElapsed(c, now)).length,
    completed: active.filter((c) => c.status === 'completed').length,
    withRx: active.filter((c) => rxState(c.prescription) === 'finalized').length,
    cancelled: visible.length - active.length,
  };
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = visible.slice(pageStart, pageStart + PAGE_SIZE);
  const pageItems = ((): Array<number | 'gap'> => {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
    const around = [currentPage - 1, currentPage, currentPage + 1].filter((p) => p > 1 && p < pageCount);
    const items: Array<number | 'gap'> = [1];
    if (around[0] > 2) items.push('gap');
    items.push(...around);
    if (around[around.length - 1] < pageCount - 1) items.push('gap');
    items.push(pageCount);
    return items;
  })();
  const groups: { key: string; label: string; rows: CallRow[] }[] = [];
  for (const c of pageRows) {
    const key = c.consultation_date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { const [y, m] = key.split('-').map(Number); g = { key, label: `${MONTHS_LONG[m - 1]} ${y}`, rows: [] }; groups.push(g); }
    g.rows.push(c);
  }
  const doctorName = ident.data.fullName;
  const drName = doctorName ? `Dr. ${doctorName.replace(/^dr\.?\s*/i, '')}` : 'Doctor';

  return (
    <ConsultantShell active="calls">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search by patient name" />
      </View>

      <View style={{ gap: 4 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, letterSpacing: 1.2, color: CX.indigo }}>CONSULTATIONS</Text>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 26, color: CX.slate900 }}>All Calls</Text>
        <Text style={{ fontFamily: F.bodyReg, fontSize: 12.5, lineHeight: 18, color: CX.slate500 }}>{drName} · every consultation, latest first. Select a patient to focus, open Prescription for the Rx and the AI summary.</Text>
      </View>

      <LCard pad={6} style={{ borderRadius: 999 }}>
        <HScroll gap={2}>{RANGES.map((r) => <SegChip key={r.key} label={r.label} active={range === r.key} onPress={() => setRange(r.key)} />)}</HScroll>
      </LCard>
      {range === 'custom' ? (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1, gap: 5 }}><Label>From (yyyy-mm-dd)</Label><LightInput value={from} onChangeText={setFrom} placeholder="2026-09-01" keyboardType="numbers-and-punctuation" autoCapitalize="none" /></View>
          <View style={{ flex: 1, gap: 5 }}><Label>To (yyyy-mm-dd)</Label><LightInput value={to} onChangeText={setTo} placeholder={todayYmd} keyboardType="numbers-and-punctuation" autoCapitalize="none" /></View>
        </View>
      ) : null}

      {callsQ.isError ? <LCard pad={14}><Text style={{ fontFamily: F.body, fontSize: 12.5, color: CX.rose600 }}>Could not load your calls. Pull down to retry.</Text></LCard> : null}

      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <KpiTile label="Total calls" value={counts.total} tone="slate" />
          <KpiTile label="Scheduled" value={counts.scheduled} tone="indigo" />
          <KpiTile label="Elapsed" value={counts.elapsed} tone="amber" />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <KpiTile label="Completed" value={counts.completed} tone="emerald" />
          <KpiTile label="With Rx" value={counts.withRx} tone="violet" />
          <KpiTile label="Cancelled" value={counts.cancelled} tone="slate" />
        </View>
      </View>

      {/* patients */}
      <LCard pad={0} style={{ overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: CX.slate100 }}>
          <Icon name="users" size={14} color={CX.indigo} strokeWidth={2.2} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: CX.slate800, flex: 1 }}>Patients</Text>
          <Text style={{ fontFamily: F.bodyReg, fontSize: 11, color: CX.slate400 }}>{clients.length}</Text>
        </View>
        <View style={{ padding: 12 }}>
          {callsQ.isPending && !!uid ? <ActivityIndicator color={CX.slate400} style={{ paddingVertical: 14 }} /> : clients.length === 0 ? (
            <Text style={{ fontFamily: F.bodyReg, fontSize: 13, color: CX.slate400, textAlign: 'center', paddingVertical: 12 }}>{calls.length === 0 ? 'No calls booked yet.' : q ? 'No patients match your search.' : 'No calls in this date range.'}</Text>
          ) : (
            <HScroll gap={8}>
              <Pressable onPress={() => setSelectedClient(null)} accessibilityRole="button" accessibilityState={{ selected: selectedClient === null }}
                style={{ width: 150, borderRadius: 16, borderWidth: 1, padding: 12, gap: 8, borderColor: selectedClient === null ? CX.indigo : CX.slate200, backgroundColor: selectedClient === null ? 'rgba(238,242,255,0.7)' : CX.white }}>
                <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: CX.indigo100, alignItems: 'center', justifyContent: 'center' }}><Icon name="users" size={15} color={CX.indigo} strokeWidth={2.2} /></View>
                <View><Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: CX.slate900 }}>All patients</Text><Text style={{ fontFamily: F.bodyReg, fontSize: 11, color: CX.slate500 }}>{searched.filter((c) => c.status !== 'cancelled').length} calls</Text></View>
              </Pressable>
              {clients.map((s) => {
                const selected = selectedClient === s.id;
                return (
                  <Pressable key={s.id} onPress={() => setSelectedClient(selected ? null : s.id)} accessibilityRole="button" accessibilityState={{ selected }}
                    style={{ width: 168, borderRadius: 16, borderWidth: 1, padding: 12, gap: 8, borderColor: selected ? CX.indigo : CX.slate200, backgroundColor: selected ? 'rgba(238,242,255,0.7)' : CX.white }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: CX.indigo, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>{initialsOf(s.name)}</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 13, color: CX.slate900 }}>{s.name}</Text>
                        <Text numberOfLines={1} style={{ fontFamily: F.bodyReg, fontSize: 11, color: CX.slate500 }}>{s.total} call{s.total === 1 ? '' : 's'}{s.finalizedRx > 0 ? ` · ${s.finalizedRx} Rx` : ''}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="clock" size={10} color={CX.slate300} strokeWidth={2.2} /><Text style={{ fontFamily: F.bodyReg, fontSize: 10.5, color: CX.slate500 }}>{s.lastDate ? `Last ${fmtDayMonth(s.lastDate)}` : 'Not seen yet'}</Text></View>
                      {s.nextDate ? <StatusPill label={`Next ${fmtDayMonth(s.nextDate)}`} tone="indigo" /> : s.scheduled > 0 ? <StatusPill label={`${s.scheduled} elapsed`} tone="amber" /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </HScroll>
          )}
        </View>
      </LCard>

      {/* calls */}
      <LCard pad={0} style={{ overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: CX.slate100 }}>
          <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 14, color: CX.slate800, flexShrink: 1 }}>{selectedSummary ? `${selectedSummary.name} · calls` : 'Calls'}</Text>
          <View style={{ backgroundColor: CX.indigo50, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, color: CX.indigo }}>{visible.length}</Text></View>
          <View style={{ flex: 1 }} />
          <Text style={{ fontFamily: F.bodyReg, fontSize: 10.5, color: CX.slate400 }}>{visible.length > PAGE_SIZE ? `${pageStart + 1} to ${Math.min(pageStart + PAGE_SIZE, visible.length)} of ${visible.length}` : 'Latest first'}</Text>
        </View>
        {callsQ.isPending && !!uid ? <ActivityIndicator color={CX.slate400} style={{ paddingVertical: 20 }} /> : visible.length === 0 ? (
          <Text style={{ fontFamily: F.bodyReg, fontSize: 13, color: CX.slate400, textAlign: 'center', paddingVertical: 24 }}>{calls.length === 0 ? 'No calls booked yet.' : 'Nothing here for this filter.'}</Text>
        ) : groups.map((g) => (
          <View key={g.key}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(248,250,252,0.9)', borderBottomWidth: 1, borderBottomColor: CX.slate100 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, letterSpacing: 0.9, textTransform: 'uppercase', color: CX.slate500, flex: 1 }}>{g.label}</Text>
              <Text style={{ fontFamily: F.bodyReg, fontSize: 11, color: CX.slate400 }}>{g.rows.length}</Text>
            </View>
            {g.rows.map((c) => {
              const tone = slotTone(c, now);
              const name = slotPersonName(c.client);
              const hasRx = rxState(c.prescription) !== 'none';
              const d = dateFromYmd(c.consultation_date);
              const busy = actions.busyId === c.id;
              return (
                <View key={c.id} style={{ flexDirection: 'row', gap: 12, paddingLeft: 16, paddingRight: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: CX.slate100, opacity: c.status === 'cancelled' ? 0.6 : 1 }}>
                  <View style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: tone.bar }} />
                  <View style={{ width: 44, height: 48, borderRadius: 12, backgroundColor: CX.slate50, borderWidth: 1, borderColor: CX.slate100, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: CX.slate900 }}>{String(d.getDate()).padStart(2, '0')}</Text>
                    <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, letterSpacing: 0.6, textTransform: 'uppercase', color: CX.slate400 }}>{MONTHS_SHORT[d.getMonth()]}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 6 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: CX.slate900, flexShrink: 1 }}>{name}</Text>
                      <StatusPill label={tone.label} tone={tone.tone} />
                      {hasRx ? <RxBadge rx={c.prescription} /> : null}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Icon name="clock" size={11} color={CX.slate300} strokeWidth={2.2} />
                      <Text numberOfLines={2} style={{ fontFamily: F.bodyReg, fontSize: 11.5, color: CX.slate500, flex: 1 }}>{DAYS_LONG[d.getDay()]} · {timeLabel(c.start_time)} to {timeLabel(c.end_time)}{c.description ? <Text style={{ color: CX.slate400 }}> · {c.description}</Text> : null}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                      <LightBtn small label={hasRx ? 'Prescription' : 'Empty prescription'} icon="clipboard" tone={hasRx ? 'outline' : 'ghost'} onPress={() => setDetail({ call: c, tab: 'rx' })} />
                      {c.status === 'completed' ? (
                        <>
                          <LightBtn small label="Meeting Summary" icon="file" tone={hasMeetingNotes(c.meeting_summary) ? 'outline' : 'ghost'} onPress={() => setDetail({ call: c, tab: 'summary' })} />
                          <LightBtn small label="AI Notes" icon="sparkle" tone={hasAiNotes(c.ai_notes) ? 'outline' : 'ghost'} onPress={() => setDetail({ call: c, tab: 'notes' })} />
                        </>
                      ) : null}
                      <LightBtn small label="Reports" tone="slate" onPress={() => actions.reports(c)} />
                      {c.status === 'scheduled' ? <LightBtn small label="Complete" icon="checks" tone="emerald" busy={busy && actions.completing} onPress={() => actions.complete(c)} /> : null}
                      {c.meet_url && c.status === 'scheduled' ? <LightBtn small label="Join" icon="phone" tone="solid" onPress={() => actions.join(c)} /> : null}
                      {!c.meet_url && c.status === 'scheduled' ? <LightBtn small label="Generate link" icon="send" tone="outline" busy={busy && actions.provisioning} onPress={() => actions.generateLink(c)} /> : null}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        ))}
        {pageCount > 1 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 12, flexWrap: 'wrap' }}>
            <Text style={{ fontFamily: F.bodyReg, fontSize: 11, color: CX.slate500, marginRight: 4 }}>Page {currentPage} of {pageCount}</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={() => setPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1} hitSlop={6} accessibilityRole="button" accessibilityLabel="Previous page" style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', opacity: currentPage === 1 ? 0.4 : 1 }}><Icon name="chevLeft" size={14} color={CX.slate600} strokeWidth={2.4} /></Pressable>
            {pageItems.map((item, i) => item === 'gap' ? <Text key={`gap${i}`} style={{ fontFamily: F.bodyReg, fontSize: 12, color: CX.slate400, paddingHorizontal: 2 }}>…</Text> : (
              <Pressable key={item} onPress={() => setPage(item)} accessibilityRole="button" accessibilityState={{ selected: item === currentPage }} hitSlop={4}
                style={{ minWidth: 30, height: 30, paddingHorizontal: 8, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: item === currentPage ? CX.indigo : 'transparent' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: item === currentPage ? '#fff' : CX.slate600 }}>{item}</Text>
              </Pressable>
            ))}
            <Pressable onPress={() => setPage(Math.min(pageCount, currentPage + 1))} disabled={currentPage === pageCount} hitSlop={6} accessibilityRole="button" accessibilityLabel="Next page" style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', opacity: currentPage === pageCount ? 0.4 : 1 }}><Icon name="chevRight" size={14} color={CX.slate600} strokeWidth={2.4} /></Pressable>
          </View>
        ) : null}
      </LCard>

      <CallRecordSheet call={detail?.call ?? null} tab={detail?.tab ?? 'rx'} onTab={(t) => setDetail((d) => (d ? { ...d, tab: t } : d))} onClose={() => setDetail(null)} doctorName={doctorName}
        onRxSaved={(callId, rx, history) => setDetail((d) => (d && d.call.id === callId ? { ...d, call: { ...d.call, prescription: rx, edit_history: history } } : d))} />
    </ConsultantShell>
  );
}
