import React from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert, Platform, PermissionsAndroid, Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { F } from '../theme';
import { Icon } from '../icons';
import { useStore } from '../store';
import { backOverride } from '../gestureLock';
import { joinTargetRef, useCallEnded } from '../lib/consultantQueries';
import { CX } from '../components/consultantUi';

/* ============ CONSULTATION JOIN (native stand-in for /doctor/consultation-room) ============
   The web room joins 100ms with the SDK, records per-mic audio and transcribes
   it. None of that is ported: the phone opens the booking's meet_url (the
   100ms prebuilt room) in a WebView with camera and mic allowed, and Leave
   calls consultation_call_ended so the AI notes and the meeting summary start
   in the background exactly as when the doctor leaves the web room. Calls held
   here therefore have no transcript of their own; the CRM's browser in the
   same room still records one when the CRM is present. */

export function ConsultationJoin() {
  const { back } = useStore();
  const target = joinTargetRef.current;
  const ended = useCallEnded();
  const [perm, setPerm] = React.useState<'asking' | 'ok' | 'denied'>(Platform.OS === 'android' ? 'asking' : 'ok');
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const leftRef = React.useRef(false);

  React.useEffect(() => {
    if (!target) { back(); return; }
    if (Platform.OS !== 'android') return;
    PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.CAMERA, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO])
      .then((r) => setPerm(r[PermissionsAndroid.PERMISSIONS.CAMERA] === 'granted' && r[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === 'granted' ? 'ok' : 'denied'))
      .catch(() => setPerm('denied'));
  }, []);

  const doLeave = React.useCallback(() => {
    if (leftRef.current) return;
    leftRef.current = true;
    if (target) ended.mutate(target.slotId, { onError: () => { /* the Complete trigger catches it later */ } });
    joinTargetRef.current = null;
    back();
  }, [target, ended, back]);
  const leave = React.useCallback(() => {
    Alert.alert('Leave the call?', 'The AI notes and the meeting summary start generating once you leave.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: doLeave },
    ]);
  }, [doLeave]);
  // Hardware back and the edge swipe ask before leaving the call.
  React.useEffect(() => { backOverride.handler = leave; return () => { backOverride.handler = null; }; }, [leave]);

  if (!target) return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: CX.white, borderBottomWidth: 1, borderBottomColor: CX.indigo100 }}>
        <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: CX.indigo50, alignItems: 'center', justifyContent: 'center' }}><Icon name="phone" size={14} color={CX.indigo} strokeWidth={2.2} /></View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: CX.slate900 }}>{target.clientName}</Text>
          <Text numberOfLines={1} style={{ fontFamily: F.bodyReg, fontSize: 10.5, color: CX.slate500 }}>Consultation room</Text>
        </View>
        <Pressable onPress={() => Linking.openURL(target.url).catch(() => {})} hitSlop={8} accessibilityRole="button" accessibilityLabel="Open in browser" style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: CX.slate100, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="arrowRight" size={14} color={CX.slate600} strokeWidth={2.2} />
        </Pressable>
        <Pressable onPress={leave} accessibilityRole="button" accessibilityLabel="Leave the call" style={({ pressed }) => ({ height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: pressed ? CX.rose600 : CX.rose, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 })}>
          <Icon name="logout" size={13} color="#fff" strokeWidth={2.4} />
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: '#fff' }}>Leave</Text>
        </Pressable>
      </View>
      {perm === 'asking' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <ActivityIndicator color={CX.indigoB} size="large" />
          <Text style={{ fontFamily: F.body, fontSize: 12.5, color: 'rgba(255,255,255,0.7)' }}>Allow the camera and microphone to join.</Text>
        </View>
      ) : perm === 'denied' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <Icon name="alert" size={28} color={CX.amber} strokeWidth={1.8} />
          <Text style={{ fontFamily: F.body, fontSize: 13.5, color: '#fff', textAlign: 'center', lineHeight: 20 }}>The call needs the camera and the microphone. Allow both in the phone's app settings, then open the call again.</Text>
          <Pressable onPress={() => Linking.openSettings().catch(() => {})} accessibilityRole="button" style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: CX.indigo }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }}>Open app settings</Text></Pressable>
        </View>
      ) : failed ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
          <Icon name="alert" size={28} color={CX.amber} strokeWidth={1.8} />
          <Text style={{ fontFamily: F.body, fontSize: 13.5, color: '#fff', textAlign: 'center', lineHeight: 20 }}>The room did not load. Check the connection and retry, or open it in the browser.</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={() => { setFailed(false); setAttempt((a) => a + 1); }} accessibilityRole="button" style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: CX.indigo }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }}>Retry</Text></Pressable>
            <Pressable onPress={() => Linking.openURL(target.url).catch(() => {})} accessibilityRole="button" style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' }}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }}>Open in browser</Text></Pressable>
          </View>
        </View>
      ) : (
        <WebView
          key={attempt}
          source={{ uri: target.url }}
          style={{ flex: 1, backgroundColor: '#000' }}
          javaScriptEnabled
          domStorageEnabled
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          originWhitelist={['*']}
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={() => (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' }}>
              <ActivityIndicator color={CX.indigoB} size="large" />
            </View>
          )}
          onError={() => setFailed(true)}
          onHttpError={(e) => { if (e.nativeEvent.statusCode >= 500) setFailed(true); }}
        />
      )}
    </View>
  );
}
