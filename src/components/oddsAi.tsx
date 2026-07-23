import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, Pressable, Image, Modal, TextInput, ScrollView, Platform, StyleSheet,
  Animated, Dimensions, Easing, Keyboard, LayoutAnimation, UIManager,
} from 'react-native';
import { PanGestureHandler, State, GestureHandlerRootView } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Ellipse } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { useStore } from '../store';

const MARK = require('../../assets/odds-mark.png');
export const WORDMARK = require('../../assets/odds-wordmark.png');
const WORDMARK_RATIO = 1920 / 750; // trimmed lockup aspect ratio

/* Odds AI gate — the assistant ships in the NEXT update. While false, opening
   the AI (any dashboard) shows the animated coming-soon card instead of the
   chat. Flip to true to re-enable the full chat untouched. */
const AI_ENABLED = false;

/* Animated "coming in the next update" card: backdrop fade, springy card
   entrance, breathing glow + ping ring around the mark. */
function AiComingSoon({ onClose }: { onClose: () => void }) {
  const enter = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 9 }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <Animated.View style={{ width: '100%', maxWidth: 340, opacity: enter, transform: [{ scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }, { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }] }}>
          <Pressable onPress={() => {}} style={{ borderRadius: 26, overflow: 'hidden', borderWidth: 1, borderColor: hexA(C.orange, 0.35) }}>
            <LinearGradient colors={['#2A1C14', '#131010']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 28, paddingHorizontal: 24 }}>
              {/* single ember accent */}
              <LinearGradient colors={[hexA(C.orange, 0.8), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4 }} />
              {/* breathing mark with ping ring */}
              <View style={{ width: 84, height: 84, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Animated.View style={{ position: 'absolute', width: 76, height: 76, borderRadius: 38, borderWidth: 1.5, borderColor: C.orange, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }] }} />
                <Animated.View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: hexA(C.orange, 0.12), borderWidth: 1, borderColor: hexA(C.orange, 0.4), alignItems: 'center', justifyContent: 'center', transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }] }}>
                  <Image source={MARK} style={{ width: 40, height: 40 }} resizeMode="contain" />
                </Animated.View>
              </View>
              <Text style={{ fontFamily: F.serif, fontSize: 22, color: '#fff', textAlign: 'center' }}>Odds AI is almost here</Text>
              <Text style={{ fontFamily: F.body, fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 19, marginTop: 8 }}>
                Your AI assistant arrives in the next update — smarter answers about clients, sessions and schedules, right from here.
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.32) }}>
                <Icon name="sparkle" size={12} color={C.gold} strokeWidth={2.1} />
                <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: C.gold }}>COMING IN THE NEXT UPDATE</Text>
              </View>
              <Pressable onPress={onClose} style={{ alignSelf: 'stretch', marginTop: 20, borderRadius: 14, overflow: 'hidden' }}>
                <LinearGradient colors={[C.orangeGradA, C.orangeGradB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ alignItems: 'center', paddingVertical: 13 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>Got it</Text>
                </LinearGradient>
              </Pressable>
            </LinearGradient>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

/* Brand lockup image (white "Odds" + orange mark). `height` sets the size; width follows. */
export function OddsWordmark({ height = 24 }: { height?: number }) {
  return <Image source={WORDMARK} style={{ height, width: height * WORDMARK_RATIO }} resizeMode="contain" />;
}

/* Centered circular launcher that replaces the bottom tab bar.
   On the home screen it opens Odds AI; on any other page it becomes a
   Home button that jumps back to the role's dashboard. */
export function OddsAiBar() {
  const { openAi, route, role, go } = useStore();
  const insets = useSafeAreaInsets();
  const homeRoute =
    role === 'crm' ? 'crm-dashboard'
    : role === 'coach' ? 'coach-dashboard'
    : role === 'ops' ? 'ops-dashboard'
    : role === 'admin' ? 'admin-dashboard'
    : role === 'doctor' ? 'doctor-dashboard'
    : role === 'marketing' ? 'marketing-dashboard'
    : 'dashboard';
  const isHome = route === homeRoute;
  return (
    <View pointerEvents="box-none" style={{ paddingBottom: insets.bottom + 6, paddingTop: 6, alignItems: 'center', backgroundColor: 'transparent' }}>
      <Pressable onPress={isHome ? openAi : () => go(homeRoute)} style={{ alignItems: 'center' }}>
        {/* soft glow */}
        <View style={{ position: 'absolute', width: 74, height: 74, borderRadius: 37, backgroundColor: hexA(C.orange, 0.16), top: -6 }} />
        <LinearGradient
          colors={['#1A130E', '#0C0908']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={{ width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: hexA(C.orange, 0.45) }}
        >
          {isHome ? (
            <Image source={MARK} style={{ width: 28, height: 24 }} resizeMode="contain" />
          ) : (
            <Icon name="home" size={22} color={C.orange} strokeWidth={2} />
          )}
        </LinearGradient>
      </Pressable>
    </View>
  );
}

type Msg = { id: number; role: 'user' | 'ai'; text: string };

const SCREEN_H = Dimensions.get('window').height;
const SHEET_H = Math.round(SCREEN_H * 0.7);

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/* Odds AI chat as a draggable bottom sheet — swipe down to dismiss. */
export function OddsAiChat() {
  const { aiOpen, closeAi } = useStore();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const nextId = useRef(1);
  const scrollRef = useRef<ScrollView>(null);

  // Track keyboard height so we can lift the input bar above it (KeyboardAvoidingView
  // can't push content up inside a fixed-height sheet anchored to the screen bottom).
  const [kbH, setKbH] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: any) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKbH(e.endCoordinates?.height ?? 0);
    };
    const onHide = () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKbH(0);
    };
    const s = Keyboard.addListener(showEvt, onShow);
    const h = Keyboard.addListener(hideEvt, onHide);
    return () => { s.remove(); h.remove(); };
  }, []);

  // Native-driven sheet position: openY handles open/close, dragY follows the finger
  // via the native gesture handler — the sheet tracks at 60fps off the JS thread.
  const openY = useRef(new Animated.Value(SHEET_H)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const sheetY = Animated.add(
    openY,
    dragY.interpolate({ inputRange: [0, SHEET_H], outputRange: [0, SHEET_H], extrapolateLeft: 'clamp' })
  );

  useEffect(() => {
    if (aiOpen) {
      dragY.setValue(0);
      openY.setValue(SHEET_H);
      Animated.timing(openY, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }
  }, [aiOpen]);

  const dismiss = (fromDy = 0) => {
    Animated.timing(openY, {
      toValue: SHEET_H - Math.max(0, fromDy),
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => closeAi());
  };

  const onGestureEvent = useRef(
    Animated.event([{ nativeEvent: { translationY: dragY } }], { useNativeDriver: true })
  ).current;

  const onHandlerStateChange = (e: any) => {
    const { oldState, translationY, velocityY } = e.nativeEvent;
    if (oldState === State.ACTIVE) {
      if (translationY > 45 || velocityY > 300) {
        dismiss(translationY);
      } else {
        Animated.spring(dragY, { toValue: 0, useNativeDriver: true, speed: 20, bounciness: 4 }).start();
      }
    }
  };

  const send = () => {
    const t = text.trim();
    if (!t) return;
    const uid = nextId.current++;
    setMsgs((m) => [...m, { id: uid, role: 'user', text: t }]);
    setText('');
    setTimeout(() => {
      setMsgs((m) => [
        ...m,
        { id: nextId.current++, role: 'ai', text: "Here's a quick take — I can help structure programming, periodization blocks, or a client's next session. What are you working on?" },
      ]);
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 450);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  };

  const reset = () => setMsgs([]);
  const empty = msgs.length === 0;

  // Pre-launch gate: until AI_ENABLED flips, opening the AI (any dashboard)
  // shows the animated coming-soon card instead of the chat.
  if (!AI_ENABLED) {
    return aiOpen ? <AiComingSoon onClose={closeAi} /> : null;
  }

  return (
    <Modal visible={aiOpen} animationType="none" onRequestClose={() => dismiss()} transparent>
      <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        {/* backdrop — static full-screen, dims proportionally as the sheet rises */}
        <Pressable onPress={() => dismiss()} style={StyleSheet.absoluteFill as any}>
          <Animated.View
            style={[
              StyleSheet.absoluteFill as any,
              { backgroundColor: '#000', opacity: sheetY.interpolate({ inputRange: [0, SHEET_H], outputRange: [0.6, 0] }) },
            ]}
          />
        </Pressable>

        <PanGestureHandler
          onGestureEvent={onGestureEvent}
          onHandlerStateChange={onHandlerStateChange}
          activeOffsetY={6}
          failOffsetX={[-20, 20]}
        >
        <Animated.View style={{ height: kbH > 0 ? SCREEN_H - insets.top - 8 : SHEET_H, transform: [{ translateY: sheetY }] }}>
          <View style={{ flex: 1, backgroundColor: C.sheetBg, borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden', borderTopWidth: 1, borderColor: 'rgba(255,150,90,0.14)' }}>
            <LinearGradient
              pointerEvents="none"
              colors={['rgba(242,107,26,0.14)', 'rgba(242,107,26,0.04)', C.sheetBg]}
              locations={[0, 0.3, 0.6]}
              style={StyleSheet.absoluteFill as any}
            />
            <View style={{ flex: 1 }}>
              {/* Drag is handled on the outer sheet view (capture), so this is a plain wrapper. */}
              <View style={{ flex: 1 }}>
                <View style={{ width: 40, height: 4, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.22)', alignSelf: 'center', marginTop: 10, marginBottom: 6 }} />
                <View style={{ paddingTop: 4, paddingHorizontal: 18, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <OddsWordmark height={26} />
                  <View style={{ flexDirection: 'row', gap: 9 }}>
                    <HeaderBtn icon="bubble" onPress={() => {}} />
                    <HeaderBtn icon="plus" onPress={reset} />
                    <HeaderBtn icon="close" onPress={dismiss} />
                  </View>
                </View>

          {/* Content */}
          <View style={{ flex: 1, position: 'relative' }}>
            {/* decorative corner brackets */}
            <CornerBrackets />

            {empty ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
                <View pointerEvents="none" style={{ alignItems: 'center', justifyContent: 'center', width: 260, height: 260 }}>
                  <Svg width={260} height={260} style={{ position: 'absolute' }}>
                    <Ellipse cx={130} cy={130} rx={118} ry={70} stroke={hexA(C.orange, 0.16)} strokeWidth={1} strokeDasharray="3 7" fill="none" transform="rotate(-24 130 130)" />
                    <Ellipse cx={130} cy={130} rx={95} ry={52} stroke={hexA('#7C8FE8', 0.1)} strokeWidth={1} strokeDasharray="2 8" fill="none" transform="rotate(-24 130 130)" />
                  </Svg>
                  <View style={{ shadowColor: C.orange, shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } }}>
                    <OddsWordmark height={58} />
                  </View>
                </View>
                <Text style={{ fontFamily: F.body, fontSize: 15, color: C.muted, textAlign: 'center', lineHeight: 22, marginTop: 8 }}>
                  Ask about programming, periodization, client management, or session planning.
                </Text>
              </View>
            ) : (
              <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 18, gap: 12 }} showsVerticalScrollIndicator={false}>
                {msgs.map((m) => (
                  <View key={m.id} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '84%' }}>
                    {m.role === 'user' ? (
                      <LinearGradient colors={[C.orangeGradA, C.orangeGradB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.bubbleUser}>
                        <Text style={{ fontFamily: F.body, fontSize: 14.5, color: '#fff', lineHeight: 20 }}>{m.text}</Text>
                      </LinearGradient>
                    ) : (
                      <View style={styles.bubbleAi}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <Image source={MARK} style={{ width: 14, height: 12 }} resizeMode="contain" />
                          <Text style={{ fontFamily: F.mono, fontSize: 9.5, letterSpacing: 1, color: C.mono2 }}>ODDS AI</Text>
                        </View>
                        <Text style={{ fontFamily: F.body, fontSize: 14.5, color: C.ink, lineHeight: 21 }}>{m.text}</Text>
                      </View>
                    )}
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
              </View>

          {/* Input bar (outside the drag zone) — lifted above the keyboard */}
          <View style={{ paddingHorizontal: 16, paddingBottom: (kbH > 0 ? kbH + 10 : insets.bottom + 12), paddingTop: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={styles.inputWrap}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Ask Odds AI…"
                placeholderTextColor={C.muted3}
                style={{ fontFamily: F.body, fontSize: 15, color: '#fff', paddingVertical: 2 }}
                onSubmitEditing={send}
                returnKeyType="send"
                multiline
              />
            </View>
            <Pressable onPress={send}>
              <LinearGradient colors={['#2E8C82', '#1E645C']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.sendBtn}>
                <Icon name="send" size={20} color="#fff" strokeWidth={2} />
              </LinearGradient>
            </Pressable>
          </View>
            </View>
          </View>
        </Animated.View>
        </PanGestureHandler>
      </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function HeaderBtn({ icon, onPress }: { icon: any; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(255,255,255,0.05)' }}>
      <Icon name={icon} size={19} color="#EDE8E2" strokeWidth={2} />
    </Pressable>
  );
}

function CornerBrackets() {
  const col = hexA(C.orange, 0.22);
  const S = 28;
  const base = { position: 'absolute' as const, width: S, height: S, borderColor: col, pointerEvents: 'none' as const };
  return (
    <>
      <View style={[base, { top: 8, left: 14, borderTopWidth: 1.5, borderLeftWidth: 1.5, borderTopLeftRadius: 10 }]} />
      <View style={[base, { top: 8, right: 14, borderTopWidth: 1.5, borderRightWidth: 1.5, borderTopRightRadius: 10 }]} />
      <View style={[base, { bottom: 8, left: 14, borderBottomWidth: 1.5, borderLeftWidth: 1.5, borderBottomLeftRadius: 10 }]} />
      <View style={[base, { bottom: 8, right: 14, borderBottomWidth: 1.5, borderRightWidth: 1.5, borderBottomRightRadius: 10 }]} />
    </>
  );
}

const styles = StyleSheet.create({
  bubbleUser: { paddingVertical: 11, paddingHorizontal: 15, borderRadius: 18, borderBottomRightRadius: 5 },
  bubbleAi: { paddingVertical: 12, paddingHorizontal: 15, borderRadius: 18, borderBottomLeftRadius: 5, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,150,90,0.12)' },
  inputWrap: { flex: 1, paddingVertical: 14, paddingHorizontal: 18, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: hexA(C.orange, 0.32), maxHeight: 120 },
  sendBtn: { width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
