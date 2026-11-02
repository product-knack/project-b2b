/* Odds AI plan bill (Team Wallet, 2 Nov 2026): after a trainer's draft the server holds it behind a bill of Rs 30 to
   50. One tap Deduct from wallet pays it and returns the draft to Create Plan; Discard throws it away (nothing
   charged, at most 3 a day). A short balance keeps the bill waiting: the sheet says so and opens the Wallet.
   Sheet rules: sibling backdrop, hitSlop >= 10, one Modal at a time (Create Plan mounts it alone). */
import React from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Serif, Mono } from './primitives';
import { useStore } from '../store';
import { useIsOnline } from '../lib/offline';
import { useSettleAiBill, useDiscardAiBill, walletErrorText } from '../lib/teamWalletQueries';
import { billLines, billPreviewLine, rupees, walletCodeOf, type BillPreview } from '../lib/teamWallet';
import type { AiPlanResult } from '../lib/aiPlanDraft';
import { trackEvent } from '../lib/amplitude';

export type AiBillTarget = { tx_id: string; bill_paise: number; balance_paise: number; preview: BillPreview | null; clientName: string } | null;

export function AiBillSheet({ bill, onDeducted, onDiscarded, onClose }: {
  bill: AiBillTarget;
  /** The paid draft, applied to the builder exactly as a free draft is. */
  onDeducted: (r: AiPlanResult) => void;
  onDiscarded: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { go } = useStore();
  const online = useIsOnline();
  const settleM = useSettleAiBill();
  const discardM = useDiscardAiBill();
  const [err, setErr] = React.useState<{ text: string; short: boolean } | null>(null);
  const visible = !!bill;
  const busy = settleM.isPending || discardM.isPending;
  React.useEffect(() => { if (visible) { setErr(null); settleM.reset(); discardM.reset(); } }, [visible, bill?.tx_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const deduct = () => {
    if (!bill || busy || !online) return;
    setErr(null);
    settleM.mutate({ tx_id: bill.tx_id }, {
      onSuccess: (r) => { trackEvent('AI Plan Bill Deducted', { bill_paise: bill.bill_paise, already: r.already }); onDeducted(r.result); },
      onError: (e) => { const code = walletCodeOf(e); setErr({ text: walletErrorText(e, 'Could not deduct the bill. Try again.'), short: code === 'WALLET_INSUFFICIENT' }); },
    });
  };
  const discard = () => {
    if (!bill || busy || !online) return;
    setErr(null);
    discardM.mutate({ tx_id: bill.tx_id }, {
      onSuccess: () => { trackEvent('AI Plan Bill Discarded', { bill_paise: bill.bill_paise }); onDiscarded(); },
      onError: (e) => setErr({ text: walletErrorText(e, 'Could not discard the draft. Try again.'), short: false }),
    });
  };

  const lines = bill ? billLines(bill.bill_paise, bill.balance_paise) : null;
  const preview = bill ? billPreviewLine(bill.preview) : '';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={busy ? () => {} : onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={busy ? undefined : onClose} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.64)' }} />
        <View accessibilityViewIsModal style={{ backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: hexA('#A78BFA', 0.3), paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16 + insets.bottom, gap: 12 }}>
          <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA('#A78BFA', 0.16), borderWidth: 1, borderColor: hexA('#A78BFA', 0.45), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="sparkle" size={17} color="#A78BFA" strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Serif style={{ fontSize: 19 }}>Your plan is ready</Serif>
              <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{bill?.clientName ? `For ${bill.clientName.split(' ')[0]}` : 'Odds AI draft'}{preview ? ` · ${preview}` : ''}</Body>
            </View>
            <Pressable onPress={onClose} disabled={busy} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"
              style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' }}>
              <Icon name="close" size={14} color={C.muted} strokeWidth={2.2} />
            </Pressable>
          </View>

          <View style={{ padding: 14, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.3)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 6 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 22, color: '#fff' }}>{lines?.bill}</Text>
            <Body style={{ fontSize: 12.5, color: C.ink3 }}>{lines?.after}</Body>
            <Body style={{ fontSize: 11, color: C.muted3, lineHeight: 15 }}>The draft opens in the builder once the bill is deducted. Discarding charges nothing.</Body>
          </View>

          {err ? (
            <View style={{ padding: 11, borderRadius: 12, backgroundColor: hexA(C.red, 0.1), borderWidth: 1, borderColor: hexA(C.red, 0.3), gap: 8 }}>
              <Body style={{ fontSize: 12, color: '#F0A0A0', lineHeight: 16 }}>{err.text}</Body>
              {err.short ? (
                <Pressable onPress={() => { onClose(); go('wallet'); }} hitSlop={10} accessibilityRole="button"
                  style={{ alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: hexA(C.orange, 0.16), borderWidth: 1, borderColor: hexA(C.orange, 0.5) }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: C.orange }}>Add money in Wallet</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {!online ? <Body style={{ fontSize: 11.5, color: C.gold }}>No connection. The bill can only be settled online.</Body> : null}

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={discard} disabled={busy || !online} hitSlop={6} accessibilityRole="button" accessibilityLabel="Discard the draft"
              style={{ flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', opacity: busy || !online ? 0.5 : 1 }}>
              {discardM.isPending ? <ActivityIndicator size="small" color={C.muted} /> : <Text style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: C.muted }}>Discard</Text>}
            </Pressable>
            <Pressable onPress={deduct} disabled={busy || !online} hitSlop={6} accessibilityRole="button" accessibilityLabel="Deduct from wallet"
              style={{ flex: 1.6, borderRadius: 13, overflow: 'hidden', opacity: busy || !online ? 0.6 : 1 }}>
              <LinearGradient colors={['#2FBF71', '#1E8E53']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {settleM.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="checks" size={15} color="#fff" strokeWidth={2.4} />}
                <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{settleM.isPending ? 'Deducting' : `Deduct ${bill ? rupees(bill.bill_paise) : ''}`}</Text>
              </LinearGradient>
            </Pressable>
          </View>
          <Mono style={{ fontSize: 8.5, color: C.faint, textAlign: 'center' }}>ONE TAP · THE BILL SHOWS IN YOUR WALLET HISTORY</Mono>
        </View>
      </View>
    </Modal>
  );
}
