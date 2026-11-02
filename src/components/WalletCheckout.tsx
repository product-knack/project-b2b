/* Team Wallet checkout (2 Nov 2026): a full-screen WebView on the server's wallet-checkout-page, which opens Razorpay
   Standard Checkout at once and posts ONE message back: { ok, razorpay_order_id, razorpay_payment_id, razorpay_signature }
   | { dismissed } | { failed, reason }. UPI and app intents (upi://, intent://, tez://, phonepe://, paytmmp://) are handed
   to the system so GPay, PhonePe and Paytm open; Razorpay's page polls the payment when the user comes back.
   Close = dismissed: the row stays "Waiting for payment" for 30 minutes and can be reopened from the history. */
import React from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator, Linking, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { C, F } from '../theme';
import { Icon } from '../icons';
import { Body } from './primitives';
import { rupees } from '../lib/teamWallet';

export type CheckoutMessage =
  | { ok: true; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
  | { dismissed: true; paid?: boolean; expired?: boolean; error?: boolean }
  | { failed: true; reason: string };

const EXTERNAL = /^(upi|intent|tez|phonepe|paytmmp|gpay|bhim|credpay|cred|market):/i;

export function WalletCheckout({ visible, url, amountPaise, onMessage, onClose }: {
  visible: boolean;
  url: string | null;
  amountPaise: number;
  onMessage: (m: CheckoutMessage) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = React.useState(true);
  const [note, setNote] = React.useState<string | null>(null);
  React.useEffect(() => { if (visible) { setLoading(true); setNote(null); } }, [visible, url]);

  const handle = (raw: string) => {
    let m: any = null;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.failed) setNote(`Payment failed: ${String(m.reason ?? 'the payment did not go through')}. You can try again.`);
    onMessage(m as CheckoutMessage);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: '#0e0a09', paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>Pay {rupees(amountPaise)}</Text>
            <Body style={{ fontSize: 11, color: C.muted2, marginTop: 1 }}>Razorpay secure checkout</Body>
          </View>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close the checkout"
            style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.07)' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }}>Close</Text>
          </Pressable>
        </View>
        {note ? (
          <View style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'rgba(224,90,90,0.14)' }}>
            <Body style={{ fontSize: 12, color: '#F0A0A0' }}>{note}</Body>
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          {url ? (
            <WebView
              source={{ uri: url }}
              style={{ flex: 1, backgroundColor: '#0e0a09' }}
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={['*']}
              setSupportMultipleWindows={false}
              mixedContentMode="always"
              onLoadEnd={() => setLoading(false)}
              onMessage={(e) => handle(e.nativeEvent.data)}
              onShouldStartLoadWithRequest={(req) => {
                if (EXTERNAL.test(req.url)) {
                  Linking.openURL(req.url).catch(() => setNote('No UPI app could open. Pay with a card or net banking instead.'));
                  return false;
                }
                return true;
              }}
              {...(Platform.OS === 'android' ? { onOpenWindow: (e: any) => { const u = String(e?.nativeEvent?.targetUrl ?? ''); if (u) Linking.openURL(u).catch(() => {}); } } : {})}
            />
          ) : null}
          {loading ? (
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <ActivityIndicator color={C.orange} />
              <Body style={{ fontSize: 12, color: C.muted2 }}>Opening the checkout</Body>
            </View>
          ) : null}
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: insets.bottom + 10, paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="lock" size={11} color={C.muted3} strokeWidth={2} />
          <Body style={{ fontSize: 10.5, color: C.muted3 }}>Card and UPI details stay with Razorpay. Odds never sees them.</Body>
        </View>
      </View>
    </Modal>
  );
}
