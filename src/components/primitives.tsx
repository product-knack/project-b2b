import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ViewStyle,
  TextStyle,
  StyleProp,
  Animated,
  Easing,
  Image,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, ORANGE_GRAD, CARD_BORDER, hexA } from '../theme';
import { Icon, IconName } from '../icons';

/* ---------- Text helpers ---------- */
type TextProps = { children: React.ReactNode; style?: StyleProp<TextStyle>; numberOfLines?: number; adjustsFontSizeToFit?: boolean; minimumFontScale?: number };
export function Serif({ children, style, numberOfLines, adjustsFontSizeToFit, minimumFontScale }: TextProps) {
  return <Text numberOfLines={numberOfLines} adjustsFontSizeToFit={adjustsFontSizeToFit} minimumFontScale={minimumFontScale} style={[{ fontFamily: F.serif, color: C.white }, style]}>{children}</Text>;
}
export function Body({ children, style, numberOfLines, adjustsFontSizeToFit, minimumFontScale }: TextProps) {
  return <Text numberOfLines={numberOfLines} adjustsFontSizeToFit={adjustsFontSizeToFit} minimumFontScale={minimumFontScale} style={[{ fontFamily: F.body, color: C.ink }, style]}>{children}</Text>;
}
export function Mono({ children, style, numberOfLines }: TextProps) {
  return <Text numberOfLines={numberOfLines} style={[{ fontFamily: F.mono, color: C.mono }, style]}>{children}</Text>;
}

/* ---------- Warm gradient card ---------- */
export function Card({
  children,
  style,
  colors = ['rgba(56,34,21,0.42)', 'rgba(20,16,15,0.5)'],
  border = CARD_BORDER,
  radius = 22,
  onPress,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  colors?: [string, string];
  border?: string;
  radius?: number;
  onPress?: () => void;
}) {
  // The layout half of `style` (flex/width/alignSelf) must live on the Pressable
  // wrapper — otherwise a `flex: 1` card inside a row collapses to content width.
  // Those keys are REMOVED from the inner style: leaving e.g. `width: '47.5%'` on
  // both layers made the visible card 47.5% OF the already-47.5%-wide wrapper.
  const flat = (StyleSheet.flatten(style) ?? {}) as ViewStyle;
  const { flex, flexGrow, flexShrink, flexBasis, width, minWidth, maxWidth, alignSelf, ...innerOnly } = flat;
  const inner = (
    <LinearGradient
      colors={colors}
      start={{ x: 0.15, y: 0 }}
      end={{ x: 0.85, y: 1 }}
      style={[{ borderRadius: radius, borderWidth: 1, borderColor: border, overflow: 'hidden' }, onPress ? [innerOnly, { flexGrow: 1 }] : style]}
    >
      {/* Opaque underlay so content stays readable over the bright background mark. */}
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(12,9,8,0.6)' }} />
      {children}
    </LinearGradient>
  );
  if (onPress) {
    const wrapStyle: ViewStyle = { flex, flexGrow, flexShrink, flexBasis, width, minWidth, maxWidth, alignSelf };
    return <Pressable onPress={onPress} style={wrapStyle}>{inner}</Pressable>;
  }
  return inner;
}

/* ---------- Section label (mono, tracked) ---------- */
export function SectionLabel({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[styles.sectionLabel, style]}>{children}</Text>
  );
}

/* ---------- Orange gradient button ---------- */
export function GradientButton({
  label,
  onPress,
  icon,
  style,
}: {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable onPress={onPress} style={style}>
      <LinearGradient
        colors={ORANGE_GRAD}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradBtn}
      >
        {icon ? <Icon name={icon} size={18} color="#fff" strokeWidth={2.4} /> : null}
        <Text style={styles.gradBtnText}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
}

/* ---------- Round avatar with initials ---------- */
export function Avatar({
  initial,
  size = 46,
  colors = ORANGE_GRAD,
  fontSize,
}: {
  initial: string;
  size?: number;
  colors?: [string, string];
  fontSize?: number;
}) {
  return (
    <LinearGradient
      colors={colors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ fontFamily: F.bodyBold, color: '#0c0808', fontSize: fontSize ?? size * 0.35 }}>{initial}</Text>
    </LinearGradient>
  );
}

/* Avatar that shows the user's uploaded photo (profiles.avatar_url) and falls
   back to the gradient-initial Avatar when there's no photo or it fails to load. */
export function AvatarPhoto({
  url,
  initial,
  size = 46,
  colors,
  fontSize,
}: {
  url?: string | null;
  initial: string;
  size?: number;
  colors?: [string, string];
  fontSize?: number;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [url]);
  if (url && !failed) {
    return (
      <Image
        source={{ uri: url }}
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: 'rgba(255,255,255,0.06)' }}
      />
    );
  }
  return <Avatar initial={initial} size={size} colors={colors} fontSize={fontSize} />;
}

/* ---------- Progress bar ---------- */
export function ProgressBar({
  pct,
  height = 6,
  fill,
  track = 'rgba(255,255,255,0.07)',
  animated = false,
  duration = 850,
}: {
  pct: number;
  height?: number;
  fill?: string;
  track?: string;
  animated?: boolean;
  duration?: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const anim = React.useRef(new Animated.Value(animated ? 0 : 1)).current;
  React.useEffect(() => {
    if (!animated) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [animated, clamped, duration]);
  const width = animated
    ? anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', `${clamped}%`] })
    : (`${clamped}%` as const);
  return (
    <View style={{ height, borderRadius: 999, backgroundColor: track, overflow: 'hidden' }}>
      <Animated.View style={{ width, height: '100%', borderRadius: 999, overflow: 'hidden', backgroundColor: fill ?? undefined }}>
        {fill ? null : (
          <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, borderRadius: 999 }} />
        )}
      </Animated.View>
    </View>
  );
}

/* Count-up number — animates 0 → value on mount. Pass serif/mono via `style`. */
export function CountUp({ value, duration = 900, style }: { value: number; duration?: number; style?: StyleProp<TextStyle> }) {
  const [display, setDisplay] = React.useState(0);
  const anim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    anim.setValue(0);
    const id = anim.addListener(({ value: v }) => setDisplay(Math.round(v)));
    Animated.timing(anim, { toValue: value, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    return () => anim.removeListener(id);
  }, [value, duration]);
  return <Text style={[{ fontFamily: F.serif, color: C.white }, style]}>{display}</Text>;
}

/* ---------- Pill / chip ---------- */
export function Pill({
  label,
  color = C.ink3,
  bg = 'transparent',
  border = 'rgba(255,255,255,0.1)',
  style,
  textStyle,
}: {
  label: string;
  color?: string;
  bg?: string;
  border?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={[{ paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: bg, borderWidth: 1, borderColor: border }, style]}>
      <Text style={[{ fontFamily: F.body, fontSize: 11, color }, textStyle]}>{label}</Text>
    </View>
  );
}

/* ---------- Stat card (big serif number + delta) ---------- */
export function StatCard({
  value,
  label,
  delta,
  up = true,
}: {
  value: string;
  label: string;
  delta?: string;
  up?: boolean;
}) {
  const dc = up ? C.green : C.red;
  return (
    <Card colors={['rgba(74,42,24,0.5)', 'rgba(22,16,15,0.5)']} style={{ flex: 1, padding: 16, paddingVertical: 18 }}>
      <Serif style={{ fontSize: 42, lineHeight: 44 }}>{value}</Serif>
      <Body style={{ fontSize: 14.5, color: C.ink3, marginTop: 9 }}>{label}</Body>
      {delta ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 11 }}>
          <View style={{ paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: hexA(dc, 0.4) }}>
            <Text style={{ fontFamily: F.mono, fontSize: 11.5, color: dc }}>{delta}</Text>
          </View>
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: C.faint }}>vs last month</Text>
        </View>
      ) : null}
    </Card>
  );
}

/* ---------- Quick-action ring button ---------- */
export function QuickAction({
  label,
  icon,
  color,
  badge,
  onPress,
}: {
  label: string;
  icon: IconName;
  color: string;
  badge?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={{ alignItems: 'center', gap: 11, flex: 1 }}>
      <View>
        <LinearGradient
          colors={[hexA(color, 0.22), 'rgba(255,255,255,0.012)']}
          start={{ x: 0.5, y: 0.12 }}
          end={{ x: 0.5, y: 1 }}
          style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: hexA(color, 0.4) }}
        >
          <Icon name={icon} size={25} color={color} />
        </LinearGradient>
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={{ fontFamily: F.body, fontSize: 13.5, color: C.ink2, textAlign: 'center', maxWidth: 104, lineHeight: 17 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/* ---------- Icon chip (rounded square behind an icon) ---------- */
export function IconChip({
  icon,
  color,
  size = 44,
  radius = 13,
  bgAlpha = 0.14,
  borderAlpha = 0.3,
  iconSize = 22,
}: {
  icon: IconName;
  color: string;
  size?: number;
  radius?: number;
  bgAlpha?: number;
  borderAlpha?: number;
  iconSize?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: hexA(color, bgAlpha),
        borderWidth: 1,
        borderColor: hexA(color, borderAlpha),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={iconSize} color={color} />
    </View>
  );
}

/* ---------- Scrollable horizontal tab row ---------- */
export function Tab({
  label,
  active,
  onPress,
  count,
  accent = C.orange,
  variant = 'outline',
}: {
  label: string;
  active: boolean;
  onPress?: () => void;
  count?: number | string;
  accent?: string;
  variant?: 'outline' | 'solid';
}) {
  if (variant === 'solid') {
    const inner = (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <Text style={{ fontFamily: active ? F.bodyBold : F.bodySemi, fontSize: 13, color: active ? '#fff' : C.muted }}>{label}</Text>
        {count != null ? (
          <View style={{ paddingVertical: 1, paddingHorizontal: 6, borderRadius: 8, backgroundColor: active ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)' }}>
            <Text style={{ fontFamily: F.mono, fontSize: 11, color: active ? '#fff' : C.muted }}>{count}</Text>
          </View>
        ) : null}
      </View>
    );
    return (
      <Pressable onPress={onPress}>
        {active ? (
          <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.tabSolid}>
            {inner}
          </LinearGradient>
        ) : (
          <View style={[styles.tabSolid, { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }]}>{inner}</View>
        )}
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 7,
        paddingVertical: 9,
        paddingHorizontal: 14,
        borderRadius: 999,
        backgroundColor: active ? hexA(accent, 0.13) : 'transparent',
        borderWidth: 1,
        borderColor: active ? hexA(accent, 0.3) : 'rgba(255,255,255,0.05)',
      }}
    >
      <Text style={{ fontFamily: active ? F.bodySemi : F.body, fontSize: 13, color: active ? accent : C.muted }}>{label}</Text>
      {count != null ? (
        <View style={{ paddingVertical: 1, paddingHorizontal: 6, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)' }}>
          <Text style={{ fontFamily: F.mono, fontSize: 11, color: accent }}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/* ---------- "Needs attention" style banner list ---------- */
export function AttentionBanner({
  icon,
  color,
  title,
  short,
}: {
  icon: IconName;
  color: string;
  title: string;
  short: string;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.05)' }}>
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: hexA(color, 0.13), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={17} color={color} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Body style={{ fontSize: 14, fontFamily: F.bodySemi }}>{title}</Body>
        <Body style={{ fontSize: 12, color: C.muted2, marginTop: 1 }}>{short}</Body>
      </View>
      <Icon name="chevRight" size={13} color={C.faint2} strokeWidth={2} />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontFamily: F.mono,
    fontSize: 12,
    letterSpacing: 2,
    color: C.mono,
  },
  gradBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 16,
    borderRadius: 16,
  },
  gradBtnText: { fontFamily: F.bodyBold, color: '#fff', fontSize: 15 },
  badge: {
    position: 'absolute',
    top: -1,
    right: -1,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: C.orangeGradB,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#0c0808',
  },
  badgeText: { color: '#fff', fontSize: 11, fontFamily: F.bodyBold },
  tabSolid: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
});
