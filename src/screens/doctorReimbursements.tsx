import React from 'react';
import { View, Text, Pressable, TextInput, Modal, ScrollView, Image, ActivityIndicator, Alert, Keyboard, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, BackLink, AccessPending, Badge } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { useMyCapabilities } from '../lib/capabilities';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { TechFilePreview } from './techDesk';
import {
  REIMBURSEMENT_TYPES, REIMBURSEMENT_MAX_FILES, ReimbursementType, ReimbursementStatus, ReimbursementRow, ReimbursementWithRequester,
  PickedScreenshot, ScreenshotRef, STATUS_LABEL, effectiveStatus, screenshotFileProblem, screenshotUrl, describeReimbursementError,
  fmtExpenseDate, fmtStamp, fmtRupees, todayIst,
} from '../lib/reimbursements';
import { useMyReimbursements, useReimbursementsReview, useSubmitReimbursement, useReviewReimbursement } from '../lib/reimbursementQueries';

/* ============ Reimbursement requests (doctor side + doctors' manager review) ============
   Port of hub-track ReimbursementDialog.tsx (New request / My requests) and
   DoctorReimbursements.tsx (the physio HOD's review page). Same table, same
   bucket, same insert shape, same RPC; the human state of a row always comes
   from effectiveStatus(), never the status column (owner rule). */

const ACC = '#5CB8FF';
const STATUS_COLOR: Record<ReimbursementStatus, string> = { pending: C.gold, approved: C.green, rejected: C.red };
const fmtBytes = (n: number | null | undefined) => (n == null ? '' : n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/* ---------- screenshot chips: signed URL resolved on tap, never stored ---------- */
function ScreenshotChips({ shots }: { shots: ScreenshotRef[] }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<{ name: string; url: string } | null>(null);
  const open = async (s: ScreenshotRef) => {
    if (busy) return;
    setBusy(s.path);
    try {
      const url = await screenshotUrl(s.path);
      const isPdf = (s.type ?? '').includes('pdf') || /\.pdf$/i.test(s.name);
      if (isPdf) await Linking.openURL(url); // PDFs: the system browser, like the web's new tab
      else setPreview({ name: s.name, url });
    } catch (e) {
      Alert.alert("Couldn't open the screenshot", describeReimbursementError(e));
    } finally { setBusy(null); }
  };
  if (!shots.length) return null;
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {shots.map((s, i) => (
          <Pressable key={s.path} onPress={() => open(s)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Open screenshot ${i + 1}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(ACC, 0.1), borderWidth: 1, borderColor: hexA(ACC, 0.35), opacity: busy && busy !== s.path ? 0.6 : 1 }}>
            {busy === s.path ? <ActivityIndicator size="small" color={ACC} /> : <Icon name="file" size={11} color={ACC} strokeWidth={2.2} />}
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: ACC }}>Screenshot {i + 1}</Text>
          </Pressable>
        ))}
      </View>
      <TechFilePreview file={preview ? { name: preview.name, kind: 'image' } : null} url={preview?.url ?? null} onClose={() => setPreview(null)} />
    </>
  );
}

/* ---------- one request card (both screens) ---------- */
function RequestCard({ r, requesterName, children }: { r: ReimbursementRow; requesterName?: string; children?: React.ReactNode }) {
  const st = effectiveStatus(r);
  const col = STATUS_COLOR[st];
  const ed = r.expense_details ?? ({} as any);
  const typeLabel = REIMBURSEMENT_TYPES.find((t) => t.value === ed.type)?.label ?? String(ed.type ?? 'Expense');
  const amount = fmtRupees(ed.amount);
  const stamp = r.approved_by;
  return (
    <View style={{ padding: 13, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.22)', borderWidth: 1, borderColor: hexA(col, 0.22), borderLeftWidth: 3, borderLeftColor: col, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          {requesterName ? <Body numberOfLines={1} style={{ fontSize: 14, fontFamily: F.bodySemi, color: '#fff' }}>{requesterName}</Body> : null}
          <Body style={{ fontSize: requesterName ? 12 : 14, fontFamily: requesterName ? F.body : F.bodySemi, color: requesterName ? C.ink3 : '#fff' }}>
            {typeLabel} · {fmtExpenseDate(ed.expense_date)}{amount ? ` · ${amount}` : ''}
          </Body>
          {!amount ? <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 1 }}>NO AMOUNT GIVEN</Mono> : null}
        </View>
        <Badge text={STATUS_LABEL[st]} color={col} />
      </View>
      {ed.note ? <Body style={{ fontSize: 12, color: C.muted2, lineHeight: 17 }}>{ed.note}</Body> : null}
      <ScreenshotChips shots={r.screenshots} />
      <View style={{ gap: 3 }}>
        <Mono style={{ fontSize: 8.5, color: C.muted3 }}>RAISED {fmtStamp(r.created_at).toUpperCase()}</Mono>
        {stamp ? (
          <Body style={{ fontSize: 11, color: stamp.decision === 'rejected' ? C.red : C.green }}>
            {stamp.decision === 'rejected' ? 'Rejected' : 'Approved'} {fmtStamp(stamp.at)}{stamp.name ? ` by ${stamp.name}` : ''}{stamp.note ? ` · ${stamp.note}` : ''}
          </Body>
        ) : null}
        {r.paid_by ? (
          <Body style={{ fontSize: 11, color: C.green }}>
            Paid {fmtStamp(r.paid_by.at)}{r.paid_by.amount != null ? ` ${fmtRupees(r.paid_by.amount)}` : ''}{r.paid_by.name ? ` by ${r.paid_by.name}` : ''}{r.paid_by.note ? ` · ${r.paid_by.note}` : ''}
          </Body>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/* ---------- filter pills with counts ---------- */
type Filter = 'all' | ReimbursementStatus;
function FilterPills({ value, onChange, counts, order }: { value: Filter; onChange: (f: Filter) => void; counts: Record<Filter, number>; order: Filter[] }) {
  const label: Record<Filter, string> = { all: 'All', pending: 'Pending', approved: 'Approved', rejected: 'Rejected' };
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 7 }}>
      {order.map((f) => {
        const on = value === f;
        const col = f === 'all' ? ACC : STATUS_COLOR[f];
        return (
          <Pressable key={f} onPress={() => onChange(f)} accessibilityRole="button" accessibilityState={{ selected: on }} hitSlop={4}
            style={{ minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: on ? hexA(col, 0.16) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(col, 0.5) : 'rgba(255,255,255,0.09)' }}>
            <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 12, color: on ? col : C.muted }}>{label[f]}</Text>
            <Text style={{ fontFamily: F.mono, fontSize: 10.5, color: on ? col : C.muted3 }}>{counts[f]}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const countBy = (rows: { status: ReimbursementStatus; approved_by: any }[]): Record<Filter, number> => {
  const c: Record<Filter, number> = { all: rows.length, pending: 0, approved: 0, rejected: 0 };
  rows.forEach((r) => { c[effectiveStatus(r)]++; });
  return c;
};

/* ============ Doctor side: New request / My requests ============ */
export function DoctorReimbursements() {
  const { back, canGoBack, go } = useStore();
  const { session } = useAuth();
  const uid = session?.user?.id ?? null; // RLS: requester_id must equal auth.uid()
  const kbH = useKeyboardHeight();
  const [tab, setTab] = React.useState<'new' | 'mine'>('new');
  const [filter, setFilter] = React.useState<Filter>('all');
  const listQ = useMyReimbursements(uid);
  const submitM = useSubmitReimbursement();

  // form
  const [type, setType] = React.useState<ReimbursementType>('cab');
  const [expenseDate, setExpenseDate] = React.useState(todayIst());
  const [amount, setAmount] = React.useState('');
  const [note, setNote] = React.useState('');
  const [files, setFiles] = React.useState<PickedScreenshot[]>([]);
  const sentRef = React.useRef(false);

  // Last 30 days, today first: the expense date can never be in the future.
  const days = React.useMemo(() => Array.from({ length: 30 }, (_, i) => {
    const d = new Date(Date.now() - i * 86_400_000);
    return {
      iso: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d),
      dow: i === 0 ? 'TODAY' : i === 1 ? 'YDAY' : d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short' }).toUpperCase(),
      day: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric' }),
      mon: d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short' }).toUpperCase(),
    };
  }), []);

  const amountTrim = amount.trim();
  const amountNum = amountTrim ? Number(amountTrim) : null;
  const amountOk = amountTrim === '' || (Number.isFinite(amountNum) && (amountNum as number) >= 0);
  const canSubmit = !!uid && !!expenseDate && files.length > 0 && amountOk && !submitM.isPending;

  const addFiles = (picked: PickedScreenshot[]) => {
    setFiles((prev) => {
      const next = [...prev];
      const refused: string[] = [];
      for (const f of picked) {
        if (next.length >= REIMBURSEMENT_MAX_FILES) { refused.push(`${f.name}: at most ${REIMBURSEMENT_MAX_FILES} screenshots.`); continue; }
        const problem = screenshotFileProblem(f);
        if (problem) { refused.push(problem); continue; }
        if (next.some((x) => x.uri === f.uri || (x.name === f.name && x.size === f.size))) continue; // duplicate
        next.push(f);
      }
      if (refused.length) setTimeout(() => Alert.alert('Some files were skipped', refused.join('\n')), 50);
      return next;
    });
  };
  const pickImages = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to attach screenshots.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: Math.max(1, REIMBURSEMENT_MAX_FILES - files.length), quality: 0.85 });
    if (res.canceled || !res.assets?.length) return;
    addFiles(res.assets.map((a) => ({ uri: a.uri, name: a.fileName || `screenshot-${Date.now()}.jpg`, mime: a.mimeType || 'image/jpeg', size: (a as any).fileSize ?? null })));
  };
  const pickPdf = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], multiple: true, copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    addFiles(res.assets.map((a) => ({ uri: a.uri, name: a.name || 'document.pdf', mime: a.mimeType || (/\.pdf$/i.test(a.name ?? '') ? 'application/pdf' : 'image/jpeg'), size: a.size ?? null })));
  };
  const reset = () => { setType('cab'); setExpenseDate(todayIst()); setAmount(''); setNote(''); setFiles([]); sentRef.current = false; submitM.reset(); };

  const submit = () => {
    if (!canSubmit || sentRef.current || !uid) return;
    Keyboard.dismiss();
    sentRef.current = true;
    submitM.mutate({ requesterId: uid, type, expenseDate, amount: amountNum, note: note.trim() || null, files }, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        reset();
        setFilter('all');
        setTab('mine');
        Alert.alert('Request sent', 'Reimbursement request sent. It is pending review.');
      },
      onError: (e) => { sentRef.current = false; Alert.alert("Couldn't send the request", describeReimbursementError(e)); },
    });
  };

  if (!session) return <AccessPending />;

  const rows = listQ.data ?? [];
  const counts = countBy(rows);
  const shown = filter === 'all' ? rows : rows.filter((r) => effectiveStatus(r) === filter);
  const label = (t: string) => <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>{t}</Mono>;
  const field = {
    fontFamily: F.body, fontSize: 14, color: '#fff', paddingVertical: 11, paddingHorizontal: 12,
    borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  } as const;

  return (
    <Page gap={12} pt={6}>
      <BackLink label="Back" onPress={() => (canGoBack ? back() : go('doctor-dashboard'))} />
      <TitleBlock title="Reimbursement" sub="Cab expenses with payment screenshots, reviewed by your manager" />

      {/* Tabs, like the web popup */}
      <View style={{ flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.3)', borderRadius: 999, padding: 3 }}>
        {([['new', 'New request'], ['mine', counts.pending ? `My requests · ${counts.pending} pending` : `My requests · ${counts.all}`]] as const).map(([id, lab]) => {
          const on = tab === id;
          return on ? (
            <LinearGradient key={id} colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: '#fff' }}>{lab}</Text>
            </LinearGradient>
          ) : (
            <Pressable key={id} onPress={() => setTab(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: id === 'mine' && counts.pending ? C.gold : C.muted }}>{lab}</Text>
            </Pressable>
          );
        })}
      </View>

      {tab === 'new' ? (
        <View style={{ gap: 13, paddingBottom: kbH > 0 ? 8 : 0 }}>
          <View style={{ gap: 6 }}>
            {label('TYPE')}
            <View style={{ flexDirection: 'row', gap: 7 }}>
              {REIMBURSEMENT_TYPES.map((t) => {
                const on = type === t.value;
                return (
                  <Pressable key={t.value} onPress={() => setType(t.value)} accessibilityRole="button" accessibilityState={{ selected: on }}
                    style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 9, paddingHorizontal: 14, borderRadius: 11, backgroundColor: on ? hexA(ACC, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(ACC, 0.45) : 'rgba(255,255,255,0.09)' }}>
                    <Icon name="route" size={13} color={on ? ACC : C.muted} strokeWidth={2.1} />
                    <Text style={{ fontFamily: on ? F.bodyBold : F.bodySemi, fontSize: 12.5, color: on ? ACC : C.muted }}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View style={{ gap: 6 }}>
            {label('EXPENSE DATE · SWIPE FOR EARLIER')}
            <ScrollView keyboardShouldPersistTaps="handled" horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
              {days.map((d) => {
                const on = expenseDate === d.iso;
                return (
                  <Pressable key={d.iso} onPress={() => setExpenseDate(d.iso)} accessibilityRole="button" accessibilityState={{ selected: on }}
                    style={{ width: 62, alignItems: 'center', paddingVertical: 9, borderRadius: 13, backgroundColor: on ? hexA(ACC, 0.14) : 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: on ? hexA(ACC, 0.45) : 'rgba(255,255,255,0.08)' }}>
                    <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: on ? ACC : C.muted3 }}>{d.dow}</Mono>
                    <Serif style={{ fontSize: 19, color: on ? ACC : C.ink, marginTop: 2 }}>{d.day}</Serif>
                    <Mono style={{ fontSize: 8.5, color: on ? hexA(ACC, 0.8) : C.faint }}>{d.mon}</Mono>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <View style={{ gap: 6 }}>
            {label('AMOUNT PAID (RUPEES, OPTIONAL)')}
            <TextInput value={amount} onChangeText={setAmount} placeholder="e.g. 450" placeholderTextColor={C.muted3} keyboardType="decimal-pad"
              accessibilityLabel="Amount paid" style={[field, { borderColor: amountOk ? 'rgba(255,255,255,0.1)' : hexA(C.red, 0.5) }]} />
            {!amountOk ? <Body style={{ fontSize: 10.5, color: C.red }}>Enter a number of rupees, 0 or more.</Body> : null}
          </View>

          <View style={{ gap: 6 }}>
            {label('NOTE (OPTIONAL)')}
            <TextInput value={note} onChangeText={setNote} placeholder="What was the trip for?" placeholderTextColor={C.muted3} multiline
              accessibilityLabel="Note" style={[field, { minHeight: 70, textAlignVertical: 'top' }]} />
          </View>

          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {label('PAYMENT SCREENSHOTS *')}
              <Mono style={{ flex: 1, textAlign: 'right', fontSize: 9, color: files.length ? ACC : C.muted3 }}>{files.length} OF {REIMBURSEMENT_MAX_FILES}</Mono>
            </View>
            {files.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {files.map((f) => {
                  const isPdf = f.mime === 'application/pdf';
                  return (
                    <View key={f.uri} style={{ width: 84, gap: 4 }}>
                      <View style={{ width: 84, height: 84, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                        {isPdf ? <Icon name="file" size={26} color={C.muted2} strokeWidth={1.8} /> : <Image source={{ uri: f.uri }} style={{ width: 84, height: 84 }} />}
                        <Pressable onPress={() => setFiles((p) => p.filter((x) => x.uri !== f.uri))} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`}
                          style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="close" size={11} color="#fff" strokeWidth={2.6} />
                        </Pressable>
                      </View>
                      <Body numberOfLines={1} style={{ fontSize: 9.5, color: C.muted3 }}>{f.name}{f.size ? ` · ${fmtBytes(f.size)}` : ''}</Body>
                    </View>
                  );
                })}
              </View>
            ) : null}
            {files.length < REIMBURSEMENT_MAX_FILES ? (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable onPress={pickImages} accessibilityRole="button" accessibilityLabel="Add screenshots from photos"
                  style={{ flex: 1.4, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: hexA(ACC, 0.45) }}>
                  <Icon name="plus" size={13} color={ACC} strokeWidth={2.4} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: ACC }}>{files.length ? 'Add more screenshots' : 'Add screenshots'}</Text>
                </Pressable>
                <Pressable onPress={pickPdf} accessibilityRole="button" accessibilityLabel="Add a PDF"
                  style={{ flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.16)' }}>
                  <Icon name="file" size={13} color={C.muted2} strokeWidth={2} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.muted }}>PDF</Text>
                </Pressable>
              </View>
            ) : null}
            <Body style={{ fontSize: 10.5, color: C.muted3 }}>Images or PDFs, up to 10 MB each, 1 to {REIMBURSEMENT_MAX_FILES} files.</Body>
          </View>

          <Pressable onPress={submit} disabled={!canSubmit} accessibilityRole="button" accessibilityLabel="Submit request"
            style={{ borderRadius: 13, overflow: 'hidden', opacity: canSubmit ? 1 : 0.5 }}>
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {submitM.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="send" size={14} color="#fff" strokeWidth={2.3} />}
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{submitM.isPending ? `Uploading ${files.length} file${files.length === 1 ? '' : 's'}…` : 'Submit request'}</Text>
            </LinearGradient>
          </Pressable>
          {!canSubmit && !submitM.isPending ? <Mono style={{ fontSize: 8.5, color: C.faint, textAlign: 'center' }}>A DATE AND AT LEAST ONE SCREENSHOT ARE REQUIRED</Mono> : null}
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <FilterPills value={filter} onChange={setFilter} counts={counts} order={['all', 'pending', 'approved', 'rejected']} />
          {listQ.isPending ? <ActivityIndicator color={ACC} style={{ paddingVertical: 30 }} />
            : listQ.isError ? <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 20 }}>{describeReimbursementError(listQ.error)}</Body>
            : shown.length === 0 ? (
              <Card style={{ padding: 22, alignItems: 'center', gap: 9 }}>
                <Icon name="rupee" size={26} color={C.faint} strokeWidth={1.6} />
                <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center' }}>{filter === 'all' ? 'No requests yet.' : `No ${filter} requests.`}</Body>
                <Pressable onPress={() => setTab('new')} hitSlop={8} accessibilityRole="button"><Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: ACC }}>Raise one</Text></Pressable>
              </Card>
            ) : shown.map((r) => <RequestCard key={r.id} r={r} />)}
        </View>
      )}
    </Page>
  );
}

/* ============ Doctors' manager side: review every request ============ */
function DecisionSheet({ row, decision, onClose, onDone }: { row: ReimbursementWithRequester | null; decision: 'approved' | 'rejected'; onClose: () => void; onDone: (name: string) => void }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const reviewM = useReviewReimbursement();
  const [note, setNote] = React.useState('');
  const visible = !!row;
  React.useEffect(() => { if (visible) { setNote(''); reviewM.reset(); } }, [visible]);
  const reject = decision === 'rejected';
  const col = reject ? C.red : C.green;
  const ed = row?.expense_details;
  const confirm = () => {
    if (!row || reviewM.isPending) return;
    Keyboard.dismiss();
    reviewM.mutate({ id: row.id, decision, note }, {
      onSuccess: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); onClose(); onDone(row.requester_name); },
      onError: (e) => Alert.alert(reject ? "Couldn't reject" : "Couldn't approve", describeReimbursementError(e)),
    });
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !reviewM.isPending && onClose()}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={() => !reviewM.isPending && onClose()} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ maxHeight: '88%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(col, 0.3), paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom + kbH }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
          <Serif style={{ fontSize: 19 }}>{reject ? 'Reject this request?' : 'Approve this request?'}</Serif>
          <Body style={{ fontSize: 12, color: C.muted2, lineHeight: 17, marginTop: 4, marginBottom: 12 }}>
            {reject
              ? 'Rejecting closes the request as rejected and the doctor sees your note.'
              : 'Approving saves your name and the time on the request; it stays open until it is paid out.'}
          </Body>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
            <View style={{ padding: 11, borderRadius: 13, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 3 }}>
              <Body style={{ fontSize: 13.5, fontFamily: F.bodySemi, color: '#fff' }}>{row?.requester_name}</Body>
              <Body style={{ fontSize: 12, color: C.ink3 }}>
                {REIMBURSEMENT_TYPES.find((t) => t.value === ed?.type)?.label ?? 'Expense'} · {fmtExpenseDate(ed?.expense_date)}{ed?.amount != null ? ` · ${fmtRupees(ed.amount)}` : ' · no amount given'}
              </Body>
              {ed?.note ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>{ed.note}</Body> : null}
              <Mono style={{ fontSize: 8.5, color: C.muted3, marginTop: 2 }}>{row?.screenshots.length ?? 0} SCREENSHOT{(row?.screenshots.length ?? 0) === 1 ? '' : 'S'} · RAISED {fmtStamp(row?.created_at).toUpperCase()}</Mono>
            </View>
            <View style={{ gap: 6 }}>
              <Mono style={{ fontSize: 9, letterSpacing: 0.8, color: C.muted3 }}>{reject ? 'NOTE · TELL THE DOCTOR WHY (OPTIONAL)' : 'NOTE (OPTIONAL)'}</Mono>
              <TextInput value={note} onChangeText={setNote} multiline placeholder={reject ? 'Why is it rejected?' : 'Anything to add'} placeholderTextColor={C.muted3}
                accessibilityLabel="Decision note"
                style={{ minHeight: 70, textAlignVertical: 'top', fontFamily: F.body, fontSize: 14, color: '#fff', paddingVertical: 11, paddingHorizontal: 12, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }} />
            </View>
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12 }}>
            <Pressable onPress={onClose} disabled={reviewM.isPending} accessibilityRole="button"
              style={{ flex: 1, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Cancel</Text>
            </Pressable>
            <Pressable onPress={confirm} disabled={reviewM.isPending} accessibilityRole="button" accessibilityLabel={reject ? 'Reject' : 'Approve'}
              style={{ flex: 1.4, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, backgroundColor: hexA(col, 0.16), borderWidth: 1, borderColor: hexA(col, 0.5), opacity: reviewM.isPending ? 0.6 : 1 }}>
              {reviewM.isPending ? <ActivityIndicator size="small" color={col} /> : <Icon name={reject ? 'close' : 'checks'} size={13} color={col} strokeWidth={2.6} />}
              <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: col }}>{reviewM.isPending ? 'Saving…' : reject ? 'Reject' : 'Approve'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function DoctorReimbursementReview() {
  const { back, canGoBack, go } = useStore();
  const caps = useMyCapabilities();
  const { dbRole } = useAuth();
  // Physio HOD (head-doctor id / physio_hod tag) or an admin app user; the RPC re-checks server-side.
  const allowed = caps.data.isPhysioHod || dbRole === 'admin' || dbRole === 'super_admin';
  const q = useReimbursementsReview(allowed);
  const [filter, setFilter] = React.useState<Filter>('pending');
  const [query, setQuery] = React.useState('');
  const [decide, setDecide] = React.useState<{ row: ReimbursementWithRequester; decision: 'approved' | 'rejected' } | null>(null);

  if (caps.isPending || caps.isError) return <AccessPending paused={caps.isPaused} error={caps.isError} onRetry={caps.refetch} />;
  if (!allowed) {
    return (
      <Page gap={14} pt={6}>
        <TitleBlock title="Reimbursements" sub="Doctors' manager" />
        <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center', paddingVertical: 30 }}>This page is for the doctors' manager only.</Body>
      </Page>
    );
  }

  const rows = q.data ?? [];
  const counts = countBy(rows);
  const needle = query.trim().toLowerCase();
  const shown = rows
    .filter((r) => filter === 'all' || effectiveStatus(r) === filter)
    .filter((r) => !needle || r.requester_name.toLowerCase().includes(needle) || (r.expense_details?.note ?? '').toLowerCase().includes(needle) || String(r.expense_details?.amount ?? '').includes(needle));

  return (
    <Page gap={12} pt={6}>
      <BackLink label="Back" onPress={() => (canGoBack ? back() : go('doctor-dashboard'))} />
      <TitleBlock title="Reimbursements" sub="Every doctor's request. Approve or reject the pending ones." />
      <FilterPills value={filter} onChange={setFilter} counts={counts} order={['pending', 'approved', 'rejected', 'all']} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <Icon name="search" size={14} color={C.muted3} strokeWidth={2} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Doctor, note or amount" placeholderTextColor={C.muted3} autoCorrect={false}
          accessibilityLabel="Search requests" style={{ flex: 1, fontFamily: F.body, fontSize: 13.5, color: '#fff', padding: 0 }} />
        {query ? <Pressable onPress={() => setQuery('')} hitSlop={10}><Icon name="close" size={12} color={C.muted2} strokeWidth={2.3} /></Pressable> : null}
      </View>

      {q.isPending ? <ActivityIndicator color={ACC} style={{ paddingVertical: 30 }} />
        : q.isError ? <Body style={{ fontSize: 12, color: C.red, textAlign: 'center', paddingVertical: 20 }}>{describeReimbursementError(q.error)}</Body>
        : shown.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 34, gap: 8 }}>
            <Icon name="checks" size={24} color={filter === 'pending' ? C.green : C.muted3} strokeWidth={2} />
            <Body style={{ fontSize: 12.5, color: C.muted3 }}>{filter === 'pending' ? 'No requests waiting on you.' : 'Nothing here.'}</Body>
          </View>
        ) : shown.map((r) => (
          <RequestCard key={r.id} r={r} requesterName={r.requester_name}>
            {effectiveStatus(r) === 'pending' ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                <Pressable onPress={() => setDecide({ row: r, decision: 'rejected' })} accessibilityRole="button" accessibilityLabel={`Reject ${r.requester_name}'s request`}
                  style={{ flex: 1, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.03)', borderWidth: 1, borderColor: hexA(C.red, 0.4) }}>
                  <Icon name="close" size={12} color={C.red} strokeWidth={2.5} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: C.red }}>Reject</Text>
                </Pressable>
                <Pressable onPress={() => setDecide({ row: r, decision: 'approved' })} accessibilityRole="button" accessibilityLabel={`Approve ${r.requester_name}'s request`}
                  style={{ flex: 1.3, minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 11, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.45) }}>
                  <Icon name="checks" size={13} color={C.green} strokeWidth={2.6} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.green }}>Approve</Text>
                </Pressable>
              </View>
            ) : null}
          </RequestCard>
        ))}

      <DecisionSheet row={decide?.row ?? null} decision={decide?.decision ?? 'approved'} onClose={() => setDecide(null)}
        onDone={(name) => Alert.alert(decide?.decision === 'rejected' ? 'Rejected' : 'Approved', `${decide?.decision === 'rejected' ? 'Rejected' : 'Approved'} the request from ${name}.`)} />
    </Page>
  );
}
