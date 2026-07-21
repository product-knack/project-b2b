import React from 'react';
import { View, Text, Pressable, ScrollView, Image, StyleSheet, Modal, Animated, Easing } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, F, hexA, ORANGE_GRAD } from '../theme';
import { Icon, MenuIcon, IconName } from '../icons';
import { useStore } from '../store';
import { trainerNav, crmNav, coachNav, opsNav, adminNav, doctorNav, marketingNav, bottomTabs, tabMap } from '../data';
import { OddsWordmark } from './oddsAi';
import { useAuth } from '../auth';
import { useSidebarProfile, useNavBadges } from '../lib/navQueries';
import { useMyCapabilities } from '../lib/capabilities';

/* ---------- Top header (logo + hamburger) ---------- */
export function Header() {
  const { openDrawer, go } = useStore();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 8, paddingBottom: 12, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      {/* left: menu */}
      <Pressable
        onPress={openDrawer}
        style={{ width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(242,107,26,0.32)', backgroundColor: 'rgba(242,107,26,0.10)' }}
      >
        <MenuIcon />
      </Pressable>

      {/* center: brand logo */}
      <OddsWordmark height={28} />

      {/* right: spacer keeps the logo centered */}
      <View style={{ width: 42, height: 42 }} />
    </View>
  );
}

/* ---------- Bottom tab bar ---------- */
export function BottomNav() {
  const { route, go, role } = useStore();
  const insets = useSafeAreaInsets();
  const badges = useNavBadges();
  const activeTab = tabMap[route] ?? (route === 'crm-clients' || route === 'crm-client' ? 'clients' : undefined);
  // CRMs get their own client list/detail screens.
  const routeFor = (t: { route: string }) => (role === 'crm' && t.route === 'clients' ? 'crm-clients' : t.route);
  return (
    <View style={{ paddingBottom: insets.bottom + 6, paddingTop: 8, paddingHorizontal: 6, flexDirection: 'row', backgroundColor: '#0A0706', borderTopWidth: 1, borderTopColor: 'rgba(255,150,90,0.08)' }}>
      {bottomTabs.map((t) => {
        const active = t.id === activeTab;
        const count = badges[t.route] ?? 0;
        const badgeText = count > 0 ? (count > 99 ? '99+' : String(count)) : null;
        return (
          <Pressable key={t.id} onPress={() => go(routeFor(t))} style={{ flex: 1, alignItems: 'center' }}>
            <View>
              <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}>
                {active ? (
                  <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill as any} />
                ) : null}
                <Icon name={t.icon} size={19} color={active ? '#fff' : C.muted2} />
              </View>
              {badgeText ? (
                <View style={styles.tabBadge}>
                  <Text style={{ color: '#fff', fontSize: 9, fontFamily: F.bodyBold }}>{badgeText}</Text>
                </View>
              ) : null}
            </View>
            <Text style={{ fontSize: 10.5, marginTop: 3, color: active ? C.orange : C.muted2, fontFamily: active ? F.bodySemi : F.body }}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------- Animated drawer nav row — press-shrink + smooth active highlight
   (ember background + sliding left accent bar) that eases in on selection. ---------- */
/* Breathing green NEW pill — marks freshly-launched features in the drawer. */
function NewBadge() {
  const v = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [1, 0.78] });
  return (
    <Animated.View style={{ transform: [{ scale }], opacity, paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999, backgroundColor: hexA(C.green, 0.16), borderWidth: 1, borderColor: hexA(C.green, 0.45) }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 8, letterSpacing: 0.6, color: C.green }}>NEW</Text>
    </Animated.View>
  );
}

function NavRow({ label, icon, active, badgeText, onPress, isNew }: { label: string; icon: IconName; active: boolean; badgeText: string | null; onPress: () => void; isNew?: boolean }) {
  const press = React.useRef(new Animated.Value(0)).current;
  const act = React.useRef(new Animated.Value(active ? 1 : 0)).current;
  React.useEffect(() => {
    Animated.timing(act, { toValue: active ? 1 : 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [active]);
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.965] });
  const bg = act.interpolate({ inputRange: [0, 1], outputRange: ['rgba(255,255,255,0)', hexA(C.orange, 0.12)] });
  const bd = act.interpolate({ inputRange: [0, 1], outputRange: ['rgba(255,255,255,0)', hexA(C.orange, 0.25)] });
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => Animated.spring(press, { toValue: 1, useNativeDriver: false, speed: 40, bounciness: 0 }).start()}
      onPressOut={() => Animated.spring(press, { toValue: 0, useNativeDriver: false, speed: 26, bounciness: 6 }).start()}
    >
      <Animated.View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 12, backgroundColor: bg, borderWidth: 1, borderColor: bd, transform: [{ scale }] }}>
        {/* sliding left accent bar */}
        <Animated.View style={{ position: 'absolute', left: 0, top: 9, bottom: 9, width: 3, borderRadius: 2, backgroundColor: C.orange, opacity: act, transform: [{ scaleY: act }] }} />
        <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? hexA(C.orange, 0.16) : 'rgba(255,255,255,0.04)' }}>
          <Icon name={icon} size={15} color={active ? C.orange : '#B8B2AC'} strokeWidth={1.9} />
        </View>
        <Text style={{ flex: 1, fontSize: 13.5, fontFamily: active ? F.bodySemi : F.body, color: active ? C.orange : '#C8C2BC' }}>{label}</Text>
        {isNew ? <NewBadge /> : null}
        {badgeText ? (
          <View style={styles.navBadge}>
            <Text style={{ color: C.orange, fontSize: 10.5, fontFamily: F.bodyBold }}>{badgeText}</Text>
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

/* ---------- Side drawer ("More") ---------- */
export function Drawer() {
  const { drawerOpen, closeDrawer, role, route, go, set } = useStore();
  const { signOut, session } = useAuth();
  const insets = useSafeAreaInsets();
  const groups = role === 'crm' ? crmNav : role === 'coach' ? coachNav : role === 'ops' ? opsNav : role === 'admin' ? adminNav : role === 'doctor' ? doctorNav : role === 'marketing' ? marketingNav : trainerNav;
  const profile = useSidebarProfile();
  const badges = useNavBadges();
  const caps = useMyCapabilities();
  // Trainer sub-role gating — mirrors the web sidebar:
  //  QHP Manager & Stats → can_schedule_assessments_for_others; QHP → assessor/view-all;
  //  Managers Dashboard/Overview & QHP Overview → profile.managers;
  //  Trainers Tracker → role_specialization 'trainer-manager';
  //  Trainer Roster → can_view_all_trainers; Workout Analyst → workout_analysist.
  const itemVisible = (it: { route: string; label: string }) => {
    if (it.route === 'qhp-manager') return caps.data.isQhpManager;
    if (it.route === 'qhp-stats') return role === 'ops' || caps.data.isQhpManager; // ops sees QHP Stats by role (web parity)
    if (it.route === 'qhp') return caps.data.isQhpManager || caps.data.canConductAssessments || caps.data.canViewAllAssessments || caps.data.qhpReportCreator;
    if (it.route === 'qhp-review') return caps.data.juniorResearcher || caps.data.isHod;
    // B2C Reports — web hardcodes this to one profile (Rajat Sharma); mirror it.
    if (it.route === 'b2c-reports') return session?.user?.id === '196ec824-a093-4944-ae3d-3c4919ebf0df';
    if (it.route === 'mgr-dash' || it.label === 'Managers Overview' || it.label === 'QHP Overview') return caps.data.isManager;
    if (it.label === 'Trainers Tracker') return caps.data.isTrainerManager;
    if (it.label === 'Trainer Roster') return caps.data.canViewAllTrainers;
    if (it.route === 'workout-analyst') return caps.data.workoutAnalyst;
    if (it.route === 'plans-analyst') return caps.data.workoutComplianceAnalyst;
    // Doctor HOD-only surfaces — the web hardcodes the Head Doctor uuid (doc §0).
    if (it.route === 'doctor-all-clients' || it.route === 'doctor-roster' || it.route === 'doctor-protocol-approvals') {
      return session?.user?.id === '30df5c2b-0f40-4736-9f41-7cbc830a191a';
    }
    return true;
  };
  return (
    <Modal visible={drawerOpen} transparent animationType="fade" onRequestClose={closeDrawer}>
      <Pressable onPress={closeDrawer} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' }}>
        <Pressable onPress={() => {}} style={[styles.drawerPanel, { paddingTop: insets.top + 14 }]}>
          {/* Header: brand + close */}
          <View style={styles.drawerHead}>
            <OddsWordmark height={24} />
            <Pressable onPress={closeDrawer} style={styles.closeBtn}>
              <Icon name="close" size={15} color="#B8B2AC" strokeWidth={2.3} />
            </Pressable>
          </View>

          {/* Profile strip */}
          <Pressable onPress={() => go('profile')} style={styles.profileStrip}>
            {profile.avatarUrl ? (
              <Image source={{ uri: profile.avatarUrl }} style={styles.profileAvatar} />
            ) : (
            <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.profileAvatar}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>{profile.initial}</Text>
            </LinearGradient>
            )}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 14.5, color: '#fff' }}>{profile.fullName}</Text>
              <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 11.5, color: C.muted2, marginTop: 1 }}>{profile.roleLabel}</Text>
            </View>
            <Icon name="chevRight" size={15} color={C.muted3} strokeWidth={2.2} />
          </Pressable>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
            {groups.map((group) => {
              const items = group.items.filter((it) => itemVisible(it));
              if (!items.length) return null;
              return (
              <View key={group.label} style={{ marginTop: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, marginBottom: 7 }}>
                  <Text style={styles.groupLabel}>{group.label}</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' }} />
                </View>
                <View style={styles.groupCard}>
                  {items.map((item, i) => {
                    const active = route === item.route;
                    const count = badges[item.route] ?? 0;
                    const badgeText = count > 0 ? (count > 99 ? '99+' : String(count)) : null;
                    return (
                      <NavRow
                        key={item.label + i}
                        label={item.label}
                        icon={item.icon}
                        active={active}
                        badgeText={badgeText}
                        isNew={item.route === 'client-threads'}
                        onPress={() => {
                          // Workout Templates lives as a sheet on the trainer dashboard, not a route.
                          if (item.route === 'workout-templates') { set({ workoutTemplatesOpen: true }); go('dashboard'); closeDrawer(); return; }
                          go(item.route);
                        }}
                      />
                    );
                  })}
                </View>
              </View>
              );
            })}
          </ScrollView>

          {/* Logout footer */}
          <Pressable onPress={() => { signOut(); go('signin', true); }} style={[styles.logoutRow, { paddingBottom: insets.bottom + 14 }]}>
            <Icon name="logout" size={17} color={C.red} strokeWidth={2} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: C.red }}>Log out</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  tabBadge: {
    position: 'absolute',
    top: -3,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: C.orangeGradB,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#0A0706',
  },
  drawerPanel: {
    width: 300,
    height: '100%',
    backgroundColor: C.drawerBg,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,150,90,0.12)',
  },
  drawerHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 18,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  closeBtn: { marginLeft: 'auto', width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  groupLabel: { fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: '#8A6A4E' },
  groupCard: { backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 15, borderWidth: 1, borderColor: 'rgba(255,150,90,0.07)', padding: 5, gap: 2 },
  navBadge: { minWidth: 19, height: 19, paddingHorizontal: 6, borderRadius: 10, backgroundColor: hexA(C.orange, 0.16), alignItems: 'center', justifyContent: 'center' },
  profileStrip: { flexDirection: 'row', alignItems: 'center', gap: 11, marginHorizontal: 12, marginTop: 12, padding: 11, borderRadius: 15, backgroundColor: hexA(C.orange, 0.06), borderWidth: 1, borderColor: hexA(C.orange, 0.18) },
  profileAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  logoutRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 13, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
});
