import React from 'react';
import { View, Text, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Card } from './primitives';

/* Animated "Client Threads" entry card (trainer + CRM dashboards).
   Gentle ping ring around the icon + a breathing green NEW badge. */
export function ClientThreadsCard({ onPress, unread }: { onPress: () => void; unread: number }) {
  // Ping: ring expands & fades, restarts. Breathe: badge softly scales.
  const ping = React.useRef(new Animated.Value(0)).current;
  const breathe = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const a = Animated.loop(
      Animated.sequence([
        Animated.timing(ping, { toValue: 1, duration: 1700, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.delay(500),
      ])
    );
    const b = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    a.start(); b.start();
    return () => { a.stop(); b.stop(); ping.setValue(0); breathe.setValue(0); };
  }, []);

  const ringScale = ping.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] });
  const ringOpacity = ping.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.45, 0.12, 0] });
  const badgeScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });

  return (
    <Card onPress={onPress} colors={['rgba(38,28,52,0.5)', 'rgba(18,14,20,0.55)']} border={hexA(C.purple, 0.22)} radius={17} style={{ overflow: 'hidden' }}>
      <LinearGradient colors={[hexA(C.purple, 0.55), 'rgba(255,255,255,0.02)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 3 }} />
      <View style={{ paddingHorizontal: 13, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={{ position: 'absolute', width: 42, height: 42, borderRadius: 13, borderWidth: 1.5, borderColor: C.purple, opacity: ringOpacity, transform: [{ scale: ringScale }] }} />
          <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: hexA(C.purple, 0.14), borderWidth: 1, borderColor: hexA(C.purple, 0.32), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="atSign" size={19} color={C.purple} strokeWidth={1.9} />
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Body style={{ fontSize: 14.5, fontFamily: F.bodyBold, color: '#fff' }}>Client Threads</Body>
            <Animated.View style={{ transform: [{ scale: badgeScale }], paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(C.green, 0.16), borderWidth: 1, borderColor: hexA(C.green, 0.45) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 8.5, letterSpacing: 0.6, color: C.green }}>NEW</Text>
            </Animated.View>
          </View>
          <Body numberOfLines={1} style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>One team chat per client, whole team in a single place</Body>
        </View>
        {unread > 0 ? (
          <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: '#fff' }}>{unread > 99 ? '99+' : unread}</Text>
          </View>
        ) : null}
        <Icon name="chevRight" size={16} color={C.purple} strokeWidth={2.3} />
      </View>
    </Card>
  );
}
