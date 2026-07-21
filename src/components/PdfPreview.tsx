import React from 'react';
import { View, Text, Pressable, ActivityIndicator, Platform, Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body } from './primitives';

/* Inline PDF preview (web parity with the review dialog's <object>/gview embed).
   iOS WKWebView renders PDF URLs natively; Android WebView can't, so it goes
   through the Google Docs viewer — same fallback the web page uses. */
export function PdfPreview({ url, height = 420 }: { url: string; height?: number }) {
  const [loading, setLoading] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const gview = `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(url)}`;
  const uri = Platform.OS === 'ios' ? url : gview;

  return (
    <View style={{ height, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: '#141110' }}>
      {failed ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 }}>
          <Icon name="file" size={26} color={C.muted3} strokeWidth={1.8} />
          <Body style={{ fontSize: 11.5, color: C.muted2, textAlign: 'center' }}>Couldn't preview the PDF in-app.</Body>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => { setFailed(false); setLoading(true); setAttempt((a) => a + 1); }} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: C.muted }}>Retry</Text>
            </Pressable>
            <Pressable onPress={() => Linking.openURL(url)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: hexA(C.blue, 0.12), borderWidth: 1, borderColor: hexA(C.blue, 0.4) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: C.blue }}>Open externally</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <WebView
            key={attempt}
            source={{ uri }}
            style={{ flex: 1, backgroundColor: '#141110' }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={() => { setLoading(false); setFailed(true); }}
            onHttpError={(e) => { if (e.nativeEvent.statusCode >= 400) { setLoading(false); setFailed(true); } }}
            startInLoadingState={false}
          />
          {loading ? (
            <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(20,17,16,0.85)' }}>
              <ActivityIndicator color={C.orange} />
              <Body style={{ fontSize: 11, color: C.muted2 }}>Loading PDF preview…</Body>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}
