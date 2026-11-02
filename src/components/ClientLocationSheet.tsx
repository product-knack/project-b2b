import React from 'react';
import { View, Text, Pressable, Modal, TextInput, ScrollView, ActivityIndicator, Keyboard, Linking, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Serif, Mono } from './primitives';
import { useKeyboardHeight } from '../lib/useKeyboardHeight';
import { useIsOnline } from '../lib/offline';
import { useSetClientPin, locationErrorText, type ClientPin } from '../lib/clientLocationQueries';
import { parseSharedLocation, isShortMapsLink, mapsLinkFor, formatCoord, methodLabel } from '../lib/sharedLocation';

/* Add / Update client location (2 Nov 2026): the QHP manager pastes the location the client shared on WhatsApp (a
   Google Maps link, an Apple Maps link, geo:, degrees, or "lat, lng"); the sheet reads the coordinates as they
   paste and saves them to the client card through set_client_brb_location. Same words as the web Leads dialog.
   Sheet rules: sibling backdrop, keyboard padding, keyboardShouldPersistTaps, hitSlop >= 10, one Modal at a time
   (the caller mounts it next to its other sheets and opens it alone). */
export type LocationTarget = { clientId: string; name: string } | null;

const SOURCE_LABEL: Record<string, string> = {
  google_maps_link: 'Google Maps link',
  apple_maps_link: 'Apple Maps link',
  geo_uri: 'geo link',
  degrees: 'degree notation',
  coordinates: 'coordinates',
};
const EMPTY_HINT = 'In WhatsApp, open the shared location, copy the message or the Google Maps link, and paste it here.';
const SHORT_LINK_HINT = 'This is a shortened Google Maps link and does not contain the coordinates. Open it in a browser and paste the full link from the address bar, or paste the coordinates.';
const UNREADABLE_HINT = 'Could not find coordinates in this text. Paste the Google Maps link from the WhatsApp location message, or the coordinates like 28.530761, 77.106838.';
const OFFLINE_LINE = 'No connection. The location can only be saved online.';

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
};

export function ClientLocationSheet({ target, existing, onClose }: { target: LocationTarget; existing: ClientPin | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const kbH = useKeyboardHeight();
  const online = useIsOnline();
  const saveM = useSetClientPin();
  const [text, setText] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const visible = !!target;
  const busy = saveM.isPending;

  React.useEffect(() => {
    if (visible) { setText(''); setErr(null); saveM.reset(); } else Keyboard.dismiss();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = parseSharedLocation(text);
  const trimmed = text.trim();
  const shortLink = !parsed && !!trimmed && isShortMapsLink(trimmed);
  const unreadable = !parsed && !!trimmed && !shortLink;
  const canSave = !!parsed && !!target && online && !busy;

  const paste = async () => {
    try { const t = await Clipboard.getStringAsync(); if (t) { setText(t); setErr(null); } } catch { /* nothing on the clipboard */ }
  };
  const save = async () => {
    if (!parsed || !target) return;
    setErr(null);
    try {
      const pin = await saveM.mutateAsync({ clientId: target.clientId, lat: parsed.lat, lng: parsed.lng });
      Keyboard.dismiss();
      onClose();
      Alert.alert('Location saved', `${formatCoord(pin.lat)}, ${formatCoord(pin.lng)}`);
    } catch (e) {
      setErr(locationErrorText(e));
    }
  };
  const close = () => { if (!busy) onClose(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.7)' }} />
        <View accessibilityViewIsModal style={{ maxHeight: '88%', backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)', paddingHorizontal: 18, paddingTop: 14, paddingBottom: insets.bottom + 18 + kbH }}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 13 }}>
            <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' }} />
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: hexA(C.green, 0.14), borderWidth: 1, borderColor: hexA(C.green, 0.35), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="pin" size={18} color={C.green} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 20 }}>Add location for {target?.name ?? ''}</Serif>
                <Body style={{ fontSize: 12, color: C.muted2, marginTop: 3, lineHeight: 17 }}>The pin the assessor navigates to. Saved to the client card, like the Leads page.</Body>
              </View>
              <Pressable onPress={close} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={13} color="#B8B2AC" strokeWidth={2.3} />
              </Pressable>
            </View>

            {existing ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: 11, backgroundColor: hexA(C.gold, 0.08), borderWidth: 1, borderColor: hexA(C.gold, 0.3) }}>
                <View style={{ marginTop: 1 }}><Icon name="alert" size={13} color={C.gold} strokeWidth={2.2} /></View>
                <Body style={{ flex: 1, fontSize: 11.5, color: C.gold, lineHeight: 16 }}>
                  Already has a pin ({methodLabel(existing.method)}{existing.updated_at ? `, ${fmtDay(existing.updated_at)}` : ''}). Saving replaces it.{' '}
                  <Text onPress={() => Linking.openURL(mapsLinkFor(existing.lat, existing.lng)).catch(() => {})} style={{ fontFamily: F.bodyBold, textDecorationLine: 'underline' }}>View</Text>
                </Body>
              </View>
            ) : null}

            <View style={{ gap: 7 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Mono style={{ flex: 1, fontSize: 9.5, letterSpacing: 1.1, color: C.mono2 }}>LOCATION SHARED ON WHATSAPP</Mono>
                <Pressable onPress={paste} hitSlop={10} accessibilityRole="button" accessibilityLabel="Paste from the clipboard" style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
                  <Icon name="clipboard" size={11} color={C.ink3} strokeWidth={2.1} />
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.ink3 }}>Paste</Text>
                </Pressable>
              </View>
              <TextInput
                value={text}
                onChangeText={(t) => { setText(t); if (err) setErr(null); }}
                multiline
                autoCorrect={false}
                autoCapitalize="none"
                keyboardType="default"
                editable={!busy}
                accessibilityLabel="Location shared on WhatsApp"
                placeholder="Paste the location message or Google Maps link"
                placeholderTextColor={C.muted3}
                style={{ minHeight: 84, textAlignVertical: 'top', paddingVertical: 12, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: parsed ? hexA(C.green, 0.45) : unreadable ? hexA(C.red, 0.45) : 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.25)', color: '#fff', fontFamily: F.body, fontSize: 14 }}
              />
            </View>

            {parsed ? (
              <View style={{ padding: 11, borderRadius: 12, backgroundColor: hexA(C.green, 0.08), borderWidth: 1, borderColor: hexA(C.green, 0.3), gap: 4 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 13.5, color: '#fff' }}>Lat {formatCoord(parsed.lat)} · Lng {formatCoord(parsed.lng)}</Text>
                <Body style={{ fontSize: 11, color: C.muted2 }}>Read from {SOURCE_LABEL[parsed.source] ?? parsed.source}</Body>
                <Pressable onPress={() => Linking.openURL(mapsLinkFor(parsed.lat, parsed.lng)).catch(() => {})} hitSlop={10} accessibilityRole="link" style={{ alignSelf: 'flex-start', marginTop: 2 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.green, textDecorationLine: 'underline' }}>Open in Google Maps</Text>
                </Pressable>
              </View>
            ) : shortLink ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                <View style={{ marginTop: 1 }}><Icon name="alert" size={13} color={C.gold} strokeWidth={2.2} /></View>
                <Body style={{ flex: 1, fontSize: 11.5, color: C.gold, lineHeight: 16 }}>{SHORT_LINK_HINT}</Body>
              </View>
            ) : unreadable ? (
              <Body style={{ fontSize: 11.5, color: C.red, lineHeight: 16 }}>{UNREADABLE_HINT}</Body>
            ) : (
              <Body style={{ fontSize: 11.5, color: C.muted2, lineHeight: 16 }}>{EMPTY_HINT}</Body>
            )}

            {!online ? <Body style={{ fontSize: 12, color: C.gold, textAlign: 'center' }}>{OFFLINE_LINE}</Body> : null}
            {err ? <Body style={{ fontSize: 12, color: C.red, textAlign: 'center' }}>{err}</Body> : null}

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
              <Pressable onPress={close} disabled={busy} hitSlop={10} accessibilityRole="button" style={{ flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.ink }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={save} disabled={!canSave} hitSlop={10} accessibilityRole="button" accessibilityState={{ disabled: !canSave }} style={{ flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, borderRadius: 13, backgroundColor: hexA(C.green, canSave ? 0.18 : 0.08), borderWidth: 1, borderColor: hexA(C.green, canSave ? 0.5 : 0.2), opacity: canSave ? 1 : 0.55 }}>
                {busy ? <ActivityIndicator size="small" color={C.green} /> : <Icon name="pin" size={14} color={C.green} strokeWidth={2.3} />}
                <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.green }}>{busy ? 'Saving…' : 'Save location'}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
