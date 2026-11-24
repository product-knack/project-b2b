import React from 'react';
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono, Serif } from './primitives';
import { useAuth } from '../auth';
import { useStore } from '../store';
import { friendlyError } from '../lib/friendlyError';
import {
  creditClaimLabel, creditQueueLine, hotReferralLine, istDay, leadHotReferral, leadReferralInfo, leadReferredTag,
  referralErrorText, type CreditQueueItem,
} from '../lib/staffReferral';
import {
  creditDay, creditQueueTitle, hotActiveLine, hotFlashSub, hotFlashTitle, leadReferralView, referralEntryLines,
  type HotReferralLead,
} from '../lib/referralLeadView';
import { WIN_MARK_ERROR, winAsk, winHeadline, winLine } from '../lib/referralWins';
import { REFERRAL_SCREENS_ON } from '../lib/staffReferralSwitch';
import { useDecideReferralCredit, useMarkReferralCongratulated, useMyClientReferralWins, useReferralCreditQueue } from '../lib/referralLeadQueries';

/* ============ Staff referrals as the leads team and the client's CRM see them (24 Nov 2026) ============
   The web's feature (docs/features/web/shared/staff-referrals.md), drawn the app's own way:
   - on the Leads screen: the Hot lead tag, the flash card, the Referred / Duplicate referral tag and, inside the
     lead's sheet, every submission with who sent it. These read the lead's own remarks and are NOT behind the
     release switch (they only draw for a lead a team member referred).
   - on the Ops dashboard: "Whose referral is this?" for a converted lead with more than one claim.
   - on the CRM dashboard: the celebration when a client's referral has joined.
   The last two are behind REFERRAL_SCREENS_ON, as on the web. */

const HOT_RED = '#EF4444';
const HOT_ORANGE = '#F97316';
const VIOLET = C.purple;
const HOT_GRAD: [string, string] = [HOT_RED, HOT_ORANGE];

export const todayInIndia = (): string => istDay(new Date().toISOString());

/** True when the lead carries the Hot lead tag (also used to tint its row). */
export const isHotLead = (lead: { remarks?: unknown; stage?: string | null }): boolean =>
  leadHotReferral(lead.remarks, lead.stage, todayInIndia()).hot;

/** A plain sentence for a failed save: the server's own REFERRAL_ sentence, else the app's usual wording. */
const plainError = (e: unknown, fallback: string): string => referralErrorText(e, '') || friendlyError(e, fallback);

/* ---------------- tags ---------------- */

/** "HOT LEAD" with a flame: a lead a team member referred again in the last 7 days and that is still open. */
export function HotLeadTag({ remarks, stage }: { remarks: unknown; stage?: string | null }) {
  const h = leadHotReferral(remarks, stage, todayInIndia());
  if (!h.hot) return null;
  return (
    <LinearGradient colors={HOT_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} accessible accessibilityLabel={`Hot lead. ${hotReferralLine(h)}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999 }}>
      <Icon name="flame" size={10} color="#fff" strokeWidth={2.6} />
      <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, letterSpacing: 0.4, color: '#fff' }}>HOT LEAD</Text>
    </LinearGradient>
  );
}

/** "Referred" for one submission of a new number; "Duplicate referral (N)" when the number came in more than once. */
export function LeadReferredTag({ remarks }: { remarks: unknown }) {
  const info = leadReferralInfo(remarks);
  const text = leadReferredTag(info);
  if (!text) return null;
  const dup = info.duplicate;
  return (
    <View accessible accessibilityLabel={`${text}. Referred by ${info.members.join(', ')}.`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingHorizontal: 8, borderRadius: 999, backgroundColor: dup ? C.gold : hexA(VIOLET, 0.16), borderWidth: 1, borderColor: dup ? C.gold : hexA(VIOLET, 0.45) }}>
      <Icon name={dup ? 'copy' : 'gift'} size={10} color={dup ? '#1a1206' : VIOLET} strokeWidth={2.4} />
      <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: dup ? '#1a1206' : VIOLET }}>{text}</Text>
    </View>
  );
}

/* ---------------- the flash card on the Leads screen ---------------- */

const SHOWN = 3;

export function HotReferralFlash({ leads, active, onView, onClear }: {
  leads: HotReferralLead[];
  /** The list is already narrowed to the hot leads. */
  active: boolean;
  onView: () => void;
  onClear: () => void;
}) {
  const n = leads.length;
  if (n === 0) return null;

  if (active) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 13, backgroundColor: hexA(HOT_RED, 0.08), borderWidth: 1, borderColor: hexA(HOT_RED, 0.4) }}>
        <Icon name="flame" size={13} color={HOT_RED} strokeWidth={2.4} />
        <Body style={{ flex: 1, fontSize: 11.5, color: '#F3B0A4', lineHeight: 16 }}>{hotActiveLine(n)}</Body>
        <Pressable onPress={onClear} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear the hot leads view"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)' }}>
          <Icon name="close" size={10} color={C.muted} strokeWidth={2.4} />
          <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.muted }}>Clear</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <LinearGradient colors={['#DC2626', '#EF4444', '#F97316']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 17, padding: 14, gap: 11 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11 }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' }}>
          <Icon name="flame" size={19} color="#fff" strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 14.5, color: '#fff', lineHeight: 19 }}>{hotFlashTitle(n)}</Text>
          <Body style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.92)', lineHeight: 16 }}>{hotFlashSub(n)}</Body>
        </View>
      </View>
      <View style={{ gap: 7 }}>
        {leads.slice(0, SHOWN).map((l) => (
          <View key={l.id} style={{ padding: 9, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.16)', gap: 2 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>{l.name}{l.phone ? <Text style={{ fontFamily: F.body, color: 'rgba(255,255,255,0.85)' }}>{`  ${l.phone}`}</Text> : null}</Text>
            <Body style={{ fontSize: 11, color: 'rgba(255,255,255,0.92)', lineHeight: 15.5 }}>{l.line}</Body>
          </View>
        ))}
        {n > SHOWN ? <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: 'rgba(255,255,255,0.9)' }}>and {n - SHOWN} more</Text> : null}
      </View>
      <Pressable onPress={onView} accessibilityRole="button" accessibilityLabel={`View ${n === 1 ? 'the hot lead' : 'the hot leads'}`}
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 42, borderRadius: 11, backgroundColor: '#fff' }}>
        <Icon name="flame" size={13} color="#B91C1C" strokeWidth={2.4} />
        <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#B91C1C' }}>View hot {n === 1 ? 'lead' : 'leads'}</Text>
      </Pressable>
    </LinearGradient>
  );
}

/* ---------------- inside the lead's sheet: every submission ---------------- */

export function LeadReferralDetails({ remarks, stage }: { remarks: unknown; stage?: string | null }) {
  const view = leadReferralView(remarks);
  if (!view) return null;
  const { info, title, sub } = view;
  const dup = info.duplicate;
  const tone = dup ? C.gold : VIOLET;
  const hot = leadHotReferral(remarks, stage, todayInIndia());
  return (
    <View style={{ borderRadius: 13, overflow: 'hidden', borderWidth: 1, borderColor: hexA(tone, 0.4), backgroundColor: hexA(tone, 0.06) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 11, backgroundColor: hexA(tone, 0.16) }}>
        <Icon name={dup ? 'copy' : 'gift'} size={14} color={tone} strokeWidth={2.3} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: tone }}>{title}</Text>
          <Body style={{ fontSize: 10.5, color: C.muted, lineHeight: 14.5 }}>{sub}</Body>
        </View>
      </View>
      {hot.hot ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 7, paddingVertical: 8, paddingHorizontal: 11, backgroundColor: hexA(HOT_RED, 0.1) }}>
          <View style={{ marginTop: 2 }}><Icon name="flame" size={11} color={HOT_RED} strokeWidth={2.5} /></View>
          <Body style={{ flex: 1, fontSize: 11, color: '#F3B0A4', lineHeight: 15.5 }}>{hotReferralLine(hot)}</Body>
        </View>
      ) : null}
      <View style={{ padding: 9, gap: 7 }}>
        {info.entries.map((e, i) => (
          <View key={i} style={{ padding: 9, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.24)', gap: 4 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <Text style={{ flex: 1, fontFamily: F.bodySemi, fontSize: 12, color: '#fff' }}>{info.entries.length > 1 ? `${i + 1}. ` : ''}{e.member}</Text>
              {e.day ? <Mono style={{ fontSize: 8, letterSpacing: 0.4, color: C.muted3, marginTop: 2 }}>{e.day.toUpperCase()}</Mono> : null}
            </View>
            {referralEntryLines(e).map((line, j) => (
              <Text key={j} style={{ fontFamily: F.body, fontSize: 11, color: C.muted, lineHeight: 15.5 }}>
                {line.label ? <Text style={{ fontFamily: F.bodySemi, color: C.ink2 }}>{`${line.label}: `}</Text> : null}
                {line.value}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

/* ---------------- Ops dashboard: whose referral is this? ---------------- */

const NOBODY = 'nobody';

export function ReferralCreditAlert({ enabled = REFERRAL_SCREENS_ON }: { enabled?: boolean }) {
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const q = useReferralCreditQueue(userId, enabled);
  const decide = useDecideReferralCredit();
  const [item, setItem] = React.useState<CreditQueueItem | null>(null);
  const [choice, setChoice] = React.useState('');
  const queue = q.data ?? [];
  if (!enabled || queue.length === 0) return null;

  const openFor = (i: CreditQueueItem) => { setItem(i); setChoice(''); };
  const close = () => { if (!decide.isPending) setItem(null); };
  const save = () => {
    if (!item || !choice || decide.isPending) return;
    decide.mutate({ leadId: item.lead_id, referralId: choice === NOBODY ? null : choice }, {
      onSuccess: (res) => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setItem(null);
        Alert.alert('Saved', res?.credited ? 'The member has been credited and told.' : 'No referral credit for this lead.');
      },
      onError: (e) => Alert.alert('Not saved', plainError(e, 'The decision could not be saved. Check your connection and try again.')),
    });
  };
  const radio = (id: string, label: string, note?: string) => {
    const on = choice === id;
    return (
      <Pressable key={id} onPress={() => setChoice(id)} accessibilityRole="radio" accessibilityState={{ selected: on }}
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 46, padding: 11, borderRadius: 12, backgroundColor: on ? hexA(C.gold, 0.12) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: on ? hexA(C.gold, 0.6) : 'rgba(255,255,255,0.1)' }}>
        <View style={{ width: 18, height: 18, borderRadius: 9, marginTop: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: on ? C.gold : C.muted3 }}>
          {on ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: C.gold }} /> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Body style={{ fontSize: 12.5, color: '#fff', lineHeight: 17 }}>{label}</Body>
          {note ? <Body style={{ fontSize: 10.5, color: C.muted2, marginTop: 1 }}>{note}</Body> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <>
      <View style={{ borderRadius: 16, padding: 13, gap: 10, backgroundColor: hexA(C.gold, 0.07), borderWidth: 1.5, borderColor: hexA(C.gold, 0.55) }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: C.gold }}>
            <Icon name="userPlus" size={16} color="#1a1206" strokeWidth={2.3} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#F2C066', lineHeight: 18 }}>{creditQueueTitle(queue.length)}</Text>
            <Body style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>Choose the member whose referral it is, so they get the credit.</Body>
          </View>
        </View>
        {queue.slice(0, 5).map((i) => (
          <View key={i.lead_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.24)' }}>
            <View style={{ flex: 1 }}>
              <Body numberOfLines={1} style={{ fontSize: 13, fontFamily: F.bodySemi, color: '#fff' }}>{i.lead_name}</Body>
              <Body style={{ fontSize: 10.5, color: C.muted2, lineHeight: 15, marginTop: 1 }}>{i.converted_at ? `Converted ${creditDay(i.converted_at)}. ` : ''}{creditQueueLine(i)}</Body>
            </View>
            <Pressable onPress={() => openFor(i)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Decide the referral credit for ${i.lead_name}`}
              style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: C.gold }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: '#1a1206' }}>Decide</Text>
            </Pressable>
          </View>
        ))}
        {queue.length > 5 ? <Body style={{ fontSize: 10.5, color: C.muted2, textAlign: 'right' }}>and {queue.length - 5} more after these</Body> : null}
      </View>

      <Modal visible={!!item} transparent animationType="slide" onRequestClose={close}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
          <View accessibilityViewIsModal style={{ maxHeight: '86%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA(C.gold, 0.3), paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14 + insets.bottom }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginBottom: 12 }} />
            <Serif style={{ fontSize: 19 }}>Whose referral is this?</Serif>
            {item ? (
              <Body style={{ fontSize: 12, color: C.muted2, lineHeight: 17, marginTop: 4, marginBottom: 12 }}>
                {`${item.lead_name}${item.converted_at ? ` converted on ${creditDay(item.converted_at)}` : ' has converted'}. ${creditQueueLine(item)}`}
              </Body>
            ) : null}
            <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ gap: 8, paddingBottom: 6 }}>
              {(item?.claims ?? []).map((c) => radio(c.referral_id, creditClaimLabel(c), c.created_the_lead ? 'This referral created the lead.' : undefined))}
              {radio(NOBODY, 'No referral credit')}
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 10, paddingTop: 12 }}>
              <Pressable onPress={close} disabled={decide.isPending} accessibilityRole="button"
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 46, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.muted }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={save} disabled={!choice || decide.isPending} accessibilityRole="button" accessibilityLabel="Save the decision"
                style={{ flex: 1.4, alignItems: 'center', justifyContent: 'center', minHeight: 46, borderRadius: 12, backgroundColor: C.gold, opacity: !choice || decide.isPending ? 0.5 : 1 }}>
                {decide.isPending ? <ActivityIndicator size="small" color="#1a1206" /> : <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: '#1a1206' }}>Save</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

/* ---------------- CRM dashboard: a client's referral has joined ---------------- */

export function ClientReferralCelebration({ enabled = REFERRAL_SCREENS_ON }: { enabled?: boolean }) {
  const { session, dbRole } = useAuth();
  const { go, set } = useStore();
  const userId = session?.user?.id ?? null;
  const on = enabled && dbRole === 'crm' && !!userId;
  const q = useMyClientReferralWins(userId, on);
  const mark = useMarkReferralCongratulated();
  const [saving, setSaving] = React.useState<string | null>(null);
  const wins = q.data ?? [];
  if (!on || wins.length === 0) return null;

  const done = (key: string, leadId: string, clientId: string, clientName: string) => {
    if (saving) return;
    setSaving(key);
    mark.mutate({ leadId, clientId }, {
      onSuccess: () => {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        Alert.alert('Saved', `${clientName} has been congratulated.`);
      },
      onError: (e) => Alert.alert('Not saved', plainError(e, WIN_MARK_ERROR)),
      onSettled: () => setSaving(null),
    });
  };

  return (
    <View style={{ gap: 10 }}>
      {wins.map((w) => (
        <LinearGradient key={w.key} colors={['#C026D3', '#EC4899', '#F59E0B']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 17, padding: 14, gap: 11 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11 }}>
            <View style={{ width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' }}>
              <Icon name="gift" size={21} color="#fff" strokeWidth={2.1} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: '#fff', lineHeight: 20 }}>{winHeadline(w)}</Text>
              <Body style={{ fontSize: 12, color: 'rgba(255,255,255,0.95)', lineHeight: 17 }}>{winLine(w)}</Body>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: '#fff', lineHeight: 17 }}>{winAsk(w)}</Text>
              {w.submittedBy ? <Body style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.82)', marginTop: 2 }}>Referral submitted by {w.submittedBy}</Body> : null}
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => { set({ selectedClientId: w.clientId, selectedClientName: w.clientName }); go('crm-client'); }} accessibilityRole="button" accessibilityLabel={`Open ${w.clientName}`}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 42, borderRadius: 11, backgroundColor: '#fff' }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#A21CAF' }}>Open client</Text>
              <Icon name="arrowRight" size={13} color="#A21CAF" strokeWidth={2.4} />
            </Pressable>
            <Pressable onPress={() => done(w.key, w.leadId, w.clientId, w.clientName)} disabled={saving !== null} accessibilityRole="button" accessibilityLabel={`Mark ${w.clientName} as congratulated`}
              style={{ flex: 1.2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 42, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', opacity: saving !== null ? 0.6 : 1 }}>
              {saving === w.key ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="checks" size={13} color="#fff" strokeWidth={2.8} />}
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: '#fff' }}>{saving === w.key ? 'Saving' : 'Done, congratulated'}</Text>
            </Pressable>
          </View>
        </LinearGradient>
      ))}
    </View>
  );
}
