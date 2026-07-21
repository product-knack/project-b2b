import React from 'react';
import { View, Text, Pressable, ScrollView, RefreshControl, Animated, Easing, Platform } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { getIsOnline } from '../lib/offline';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon } from '../icons';
import { Serif, Body, Mono, Avatar, AvatarPhoto, Card, Pill } from '../components/primitives';

/* Horizontal scroller that disables the page swipe-back gesture while touched,
   so scrolling tabs/chips never triggers navigation. */
import { backSwipeLock } from '../gestureLock';
export function HScroll({ children, gap = 8 }: { children: React.ReactNode; gap?: number }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap }}
      onTouchStart={() => { backSwipeLock.locked = true; }}
      onTouchEnd={() => { backSwipeLock.locked = false; }}
      onTouchCancel={() => { backSwipeLock.locked = false; }}
    >
      {children}
    </ScrollView>
  );
}

/* Flexible time picker: all 24 hours + 5-minute chips + ±1 min fine-tune,
   so any exact time is reachable. Value in/out is 'HH:mm' 24-hour. */
export function TimeDial({ time, onChange, accent = C.gold }: { time: string; onChange: (t: string) => void; accent?: string }) {
  const [hh, mm] = time.split(':').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const lock = {
    onTouchStart: () => { backSwipeLock.locked = true; },
    onTouchEnd: () => { backSwipeLock.locked = false; },
    onTouchCancel: () => { backSwipeLock.locked = false; },
  };
  const nudge = (d: number) => {
    const total = (hh * 60 + mm + d + 1440) % 1440;
    onChange(`${pad(Math.floor(total / 60))}:${pad(total % 60)}`);
  };
  return (
    <View style={{ gap: 8 }}>
      <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: C.muted3 }}>HOUR</Mono>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} {...lock}>
        {Array.from({ length: 24 }, (_, h) => {
          const active = hh === h;
          return (
            <Pressable key={h} onPress={() => onChange(`${pad(h)}:${pad(mm)}`)} style={{ alignItems: 'center', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 11, backgroundColor: active ? hexA(accent, 0.18) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(accent, 0.55) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 13, color: active ? accent : C.muted }}>{((h + 11) % 12) + 1}</Text>
              <Text style={{ fontFamily: F.mono, fontSize: 7, color: active ? accent : C.muted3 }}>{h < 12 ? 'AM' : 'PM'}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Mono style={{ fontSize: 7.5, letterSpacing: 0.8, color: C.muted3 }}>MINUTES</Mono>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} {...lock}>
        {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => {
          const active = mm === m;
          return (
            <Pressable key={m} onPress={() => onChange(`${pad(hh)}:${pad(m)}`)} style={{ alignItems: 'center', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 11, backgroundColor: active ? hexA(accent, 0.18) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(accent, 0.55) : 'rgba(255,255,255,0.09)' }}>
              <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 12, color: active ? accent : C.muted }}>:{pad(m)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {/* Exact-minute fine tune around the live preview */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <Pressable onPress={() => nudge(-1)} hitSlop={6} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.muted }}>−</Text>
        </Pressable>
        <View style={{ paddingVertical: 6, paddingHorizontal: 16, borderRadius: 999, backgroundColor: hexA(accent, 0.1), borderWidth: 1, borderColor: hexA(accent, 0.35) }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: accent }}>
            {((hh + 11) % 12) + 1}:{pad(mm)} {hh < 12 ? 'AM' : 'PM'}
          </Text>
        </View>
        <Pressable onPress={() => nudge(1)} hitSlop={6} style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.muted }}>+</Text>
        </Pressable>
      </View>
      <Mono style={{ fontSize: 7, color: C.muted3, textAlign: 'center' }}>− / + ADJUST BY 1 MINUTE</Mono>
    </View>
  );
}

/* Selectable chip/button wrapper: shrinks while touched, and springs with a
   satisfying pop the moment it becomes the selected one. */
export function AnimChip({ active, onPress, disabled, grow, style, children }: {
  active?: boolean; onPress: () => void; disabled?: boolean; grow?: boolean; style?: any; children: React.ReactNode;
}) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const prev = React.useRef(active);
  React.useEffect(() => {
    if (active && !prev.current) {
      scale.setValue(0.82);
      Animated.spring(scale, { toValue: 1, friction: 4.5, tension: 190, useNativeDriver: true }).start();
    }
    prev.current = active;
  }, [active]);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={grow ? { flex: 1 } : undefined}
      onPressIn={() => Animated.timing(scale, { toValue: 0.92, duration: 60, useNativeDriver: true }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, friction: 5, tension: 220, useNativeDriver: true }).start()}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/* App-styled refresh loader: a floating pill with a spinning orange arc and a
   mono label, shown while pull-to-refresh is running (replaces the native spinner). */
function RefreshPill({ visible }: { visible: boolean }) {
  const spin = React.useRef(new Animated.Value(0)).current;
  const scale = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    if (visible) {
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 22, bounciness: 7 }).start();
      const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 850, easing: Easing.linear, useNativeDriver: true }));
      loop.start();
      return () => { loop.stop(); spin.setValue(0); };
    }
    Animated.timing(scale, { toValue: 0, duration: 160, useNativeDriver: true }).start();
  }, [visible]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center', zIndex: 20 }}>
      <Animated.View style={{ opacity: scale, transform: [{ scale }], flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 9, paddingHorizontal: 15, borderRadius: 999, backgroundColor: '#171210', borderWidth: 1, borderColor: 'rgba(255,150,90,0.28)', shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 9 }}>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Icon path="M21 12a9 9 0 1 1-6.2-8.56" size={15} color={C.orange} strokeWidth={2.4} />
        </Animated.View>
        <Text style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: 1.6, color: C.ink2 }}>REFRESHING</Text>
      </Animated.View>
    </View>
  );
}

/* Standard scrollable page body with consistent horizontal padding. */
// Remembers each screen's scroll offset across unmount/remount (screens are
// recreated on every navigation), so returning to a page lands where you left
// off instead of jumping to the top. Keyed by the caller's `scrollKey`.
const scrollMemory = new Map<string, number>();

export const Page = React.forwardRef<ScrollView, { children: React.ReactNode; gap?: number; pt?: number; pb?: number; kbAware?: boolean; scrollKey?: string }>(function Page({ children, gap = 22, pt = 8, pb = 92, kbAware = false, scrollKey }, ref) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);
  const scrollRef = React.useRef<ScrollView>(null);
  // Expose the ScrollView so screens can imperatively scrollTo a section.
  React.useImperativeHandle(ref, () => scrollRef.current as ScrollView, []);
  const restored = React.useRef(false);
  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    // OFFLINE: refetching can only fail — errors would replace the cached (SQLite)
    // content on screen. Spin briefly for feedback and keep showing saved data.
    if (!getIsOnline()) {
      setTimeout(() => setRefreshing(false), 400);
      return;
    }
    // Refetch all active queries (live-data screens update; static screens are a no-op).
    await queryClient.invalidateQueries();
    setTimeout(() => setRefreshing(false), 500);
  }, [queryClient]);
  // Restore the saved offset as soon as the content is tall enough to reach it.
  const onContentSizeChange = React.useCallback((_w: number, h: number) => {
    if (!scrollKey || restored.current) return;
    const target = scrollMemory.get(scrollKey) ?? 0;
    if (target <= 0) { restored.current = true; return; }
    if (h >= target) {
      scrollRef.current?.scrollTo({ y: target, animated: false });
      restored.current = true;
    }
  }, [scrollKey]);
  const onScroll = React.useCallback((e: any) => {
    if (scrollKey) scrollMemory.set(scrollKey, e.nativeEvent.contentOffset.y);
  }, [scrollKey]);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        onScroll={scrollKey ? onScroll : undefined}
        onContentSizeChange={scrollKey ? onContentSizeChange : undefined}
        scrollEventThrottle={scrollKey ? 64 : undefined}
        // Input-heavy forms: on iOS this scrolls the focused input above the keyboard.
        automaticallyAdjustKeyboardInsets={kbAware}
        keyboardShouldPersistTaps={kbAware ? 'handled' : undefined}
        // Capped + centered on wide screens (tablet/web); no effect on phones.
      contentContainerStyle={{ paddingHorizontal: 18, paddingTop: pt, paddingBottom: pb, gap, width: '100%', maxWidth: 640, alignSelf: 'center' }}
        refreshControl={
          // The native spinner is hidden (transparent on iOS, pushed off-screen on
          // Android) — the RefreshPill overlay below is the visible loader.
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="transparent"
            colors={['transparent']}
            progressBackgroundColor="transparent"
            progressViewOffset={Platform.OS === 'android' ? -1000 : 0}
          />
        }
      >
        {children}
      </ScrollView>
      <RefreshPill visible={refreshing} />
    </View>
  );
});

/* Greeting header: mono date, serif greeting, avatar. */
export function GreetingHeader({ date, name, sub, initial, avatarUrl, rightAction }: { date: string; name: string; sub: string; initial: string; avatarUrl?: string | null; rightAction?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <View style={{ flex: 1 }}>
        {/* Date pill */}
        <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(C.orange, 0.09), borderWidth: 1, borderColor: hexA(C.orange, 0.22) }}>
          <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.orange }} />
          <Mono style={{ fontSize: 10.5, letterSpacing: 1.6, color: '#F0A875' }}>{date}</Mono>
        </View>
        <Serif style={{ fontSize: 31, lineHeight: 35, marginTop: 12 }}>{name}</Serif>
        <Body style={{ fontSize: 14, color: C.muted, marginTop: 5 }}>{sub}</Body>
      </View>
      {rightAction ?? null}
      {/* Avatar with gradient ring + online dot */}
      <View>
        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: 2.5, borderRadius: 32 }}>
          <View style={{ padding: 2.5, borderRadius: 30, backgroundColor: C.bg }}>
            <AvatarPhoto url={avatarUrl} initial={initial} size={52} fontSize={19} />
          </View>
        </LinearGradient>
        <View style={{ position: 'absolute', right: 1, bottom: 1, width: 15, height: 15, borderRadius: 8, backgroundColor: C.green, borderWidth: 2.5, borderColor: C.bg }} />
      </View>
    </View>
  );
}

/* Screen title block (serif heading + muted subtitle). */
export function TitleBlock({ title, sub }: { title: string; sub?: string }) {
  return (
    <View>
      <Serif style={{ fontSize: 24 }}>{title}</Serif>
      {sub ? <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 2 }}>{sub}</Body> : null}
    </View>
  );
}

/* Back link row. */
export function BackLink({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name="arrowLeft" size={16} color={C.ink2} strokeWidth={2.2} />
      <Body style={{ fontSize: 14, fontFamily: F.bodySemi }}>{label}</Body>
    </Pressable>
  );
}

/* Small three-up mini stat cards. */
export function MiniStat({ value, label, color = '#fff', borderColor }: { value: string; label: string; color?: string; borderColor?: string }) {
  return (
    <Card colors={['rgba(60,38,24,0.45)', 'rgba(18,14,14,0.5)']} border={borderColor ?? 'rgba(255,150,90,0.1)'} radius={16} style={{ flex: 1, paddingVertical: 14, paddingHorizontal: 10 }}>
      <Serif style={{ fontSize: 26, color }}>{value}</Serif>
      <Body style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{label}</Body>
    </Card>
  );
}

/* Colored status badge pill. */
export function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 7, backgroundColor: hexA(color, 0.14) }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color }}>{text}</Text>
    </View>
  );
}

/* Session card used on Dashboard roster + Sessions screen. */
export function SessionCard({ s }: { s: { date: string; time: string; ampm: string; name: string; modality: string; window: string } }) {
  return (
    <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={20} style={{ padding: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <View style={{ alignItems: 'center', borderWidth: 1, borderColor: hexA(C.orange, 0.3), borderRadius: 13, paddingVertical: 9, paddingHorizontal: 12, backgroundColor: hexA(C.orange, 0.04) }}>
          <Mono style={{ fontSize: 9.5, letterSpacing: 1, color: C.mono2 }}>{s.date}</Mono>
          <Serif style={{ fontSize: 20, color: C.orange, marginTop: 2 }}>{s.time}</Serif>
          <Mono style={{ fontSize: 9.5, color: C.mono2 }}>{s.ampm}</Mono>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 9 }}>
            <Icon name="user" size={15} color={C.muted} strokeWidth={1.8} />
            <Body style={{ fontSize: 16, fontFamily: F.bodySemi, color: '#fff' }}>{s.name}</Body>
          </View>
          <View style={{ flexDirection: 'row', gap: 7, flexWrap: 'wrap' }}>
            <Pill label={s.modality} />
            <Pill label="Scheduled" color={C.blue} bg={hexA(C.blue, 0.08)} border={hexA(C.blue, 0.4)} />
            <Pill label="Overdue" color={C.red} bg={hexA(C.red, 0.08)} border={hexA(C.red, 0.4)} />
          </View>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: hexA(C.red, 0.25), backgroundColor: hexA(C.red, 0.05), marginBottom: 12 }}>
        <Icon name="clock" size={15} color={C.red} strokeWidth={1.9} />
        <Body style={{ fontSize: 13, color: '#CC9999' }}>Log window closed · {s.window}</Body>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <ActionBtn label="Reschedule" icon="calendar" accent />
        <ActionBtn label="Add Missed Remark" icon="alert" />
      </View>
    </Card>
  );
}

/* Collapsible session row: shows just the client name; tap to expand full details. */
export function CollapsibleSessionCard({
  s,
  open,
  onToggle,
}: {
  s: { date: string; time: string; ampm: string; name: string; modality: string; window: string; status?: 'Pending' | 'Completed' };
  open: boolean;
  onToggle: () => void;
}) {
  const statusColor = s.status === 'Completed' ? C.green : C.gold;
  return (
    <Card colors={['rgba(46,28,18,0.42)', 'rgba(18,14,14,0.5)']} border="rgba(255,150,90,0.09)" radius={16} style={{ padding: 14 }}>
      <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
        <Icon name="user" size={16} color={C.muted} strokeWidth={1.8} />
        <Body numberOfLines={1} style={{ flexShrink: 1, fontSize: 15, fontFamily: F.bodySemi, color: '#fff' }}>{s.name}</Body>
        {s.status ? <Badge text={s.status} color={statusColor} /> : null}
        <View style={{ flex: 1 }} />
        <Mono style={{ fontSize: 11, color: C.mono2 }}>{s.time} {s.ampm}</Mono>
        <Icon name={open ? 'chevUp' : 'chevDown'} size={16} color={C.muted} strokeWidth={2.2} />
      </Pressable>
      {open ? (
        <View style={{ marginTop: 13, paddingTop: 13, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: 12 }}>
            <View style={{ alignItems: 'center', borderWidth: 1, borderColor: hexA(C.orange, 0.3), borderRadius: 12, paddingVertical: 8, paddingHorizontal: 11, backgroundColor: hexA(C.orange, 0.04) }}>
              <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.mono2 }}>{s.date}</Mono>
              <Serif style={{ fontSize: 18, color: C.orange, marginTop: 2 }}>{s.time}</Serif>
              <Mono style={{ fontSize: 9, color: C.mono2 }}>{s.ampm}</Mono>
            </View>
            <View style={{ flex: 1, flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              <Pill label={s.modality} />
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 11, borderWidth: 1, borderColor: hexA(C.red, 0.25), backgroundColor: hexA(C.red, 0.05), marginBottom: 11 }}>
            <Icon name="clock" size={14} color={C.red} strokeWidth={1.9} />
            <Body style={{ fontSize: 12.5, color: '#CC9999' }}>Log window closed · {s.window}</Body>
          </View>
          <View style={{ flexDirection: 'row', gap: 9 }}>
            <ActionBtn label="Reschedule" icon="calendar" accent />
            <ActionBtn label="Add Missed Remark" icon="alert" />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

/* Dual outline action buttons (used in session cards, roster). */
export function ActionBtn({ label, icon, accent, onPress }: { label: string; icon: any; accent?: boolean; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13, borderRadius: 13, borderWidth: 1, borderColor: accent ? hexA(C.orange, 0.35) : 'rgba(255,255,255,0.08)', backgroundColor: accent ? hexA(C.orange, 0.05) : 'rgba(0,0,0,0.35)' }}
    >
      <Icon name={icon} size={15} color={accent ? C.orange : C.ink} strokeWidth={2} />
      <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: accent ? C.orange : C.ink }}>{label}</Text>
    </Pressable>
  );
}

/* Small avatar with initials (38px, flat gradient). */
export function MiniAvatar({ initial, colors, size = 38 }: { initial: string; colors: [string, string]; size?: number }) {
  return <Avatar initial={initial} size={size} colors={colors} fontSize={size < 40 ? 13 : 16} />;
}
