import React from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert, Image, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import { F } from '../theme';
import { Icon, IconName } from '../icons';
import { useAuth } from '../auth';
import { useDoctorIdentity } from '../lib/doctorQueries';
import { useSidebarProfile, useUploadAvatar } from '../lib/navQueries';
import { useDoctorConsultationSlots, useConsultantConsultations, ymdLocal, MONTHS_LONG } from '../lib/consultantQueries';
import { CX, INDIGO_GRAD, ConsultantShell, LCard, initialsOf } from '../components/consultantUi';

/* ============ CONSULTANT PROFILE (the drawer's "Dr. Name" strip, 23 Sep 2026) ============
   The shared Profile screen is the trainer page (dark, certifications, session
   and client counts). A consultant gets this light page instead: photo, name,
   role, email, and exactly two numbers, total consultations and this month,
   counted from the same rows as the Consultant Dashboard (non-cancelled
   bookings plus non-cancelled consultation requests naming the doctor).
   Plain integers, never abbreviated (user request: "exact numbers"). */

function StatTile({ label, value, sub, icon, tone, loading }: { label: string; value: number; sub: string; icon: IconName; tone: 'indigo' | 'emerald'; loading: boolean }) {
  const fg = tone === 'indigo' ? CX.indigo : CX.emerald600;
  const bg = tone === 'indigo' ? CX.indigo100 : CX.emerald100;
  return (
    <LCard style={{ flex: 1 }} pad={16}>
      <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={15} color={fg} strokeWidth={2.2} />
      </View>
      {loading ? (
        <ActivityIndicator color={CX.slate400} style={{ alignSelf: 'flex-start', marginTop: 12, height: 36 }} />
      ) : (
        <Text style={{ fontFamily: F.bodyBold, fontSize: 32, color: CX.slate900, marginTop: 10 }}>{String(value)}</Text>
      )}
      <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: CX.slate600, marginTop: 2 }}>{label}</Text>
      <Text style={{ fontFamily: F.bodyReg, fontSize: 11, color: CX.slate400, marginTop: 2 }}>{sub}</Text>
    </LCard>
  );
}

export function ConsultantProfile() {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const ident = useDoctorIdentity();
  const sideProf = useSidebarProfile();
  const uploadAvatarM = useUploadAvatar();
  const doctorName = ident.data.fullName;
  const slotsQ = useDoctorConsultationSlots(uid);
  const consultQ = useConsultantConsultations(doctorName);

  const now = new Date();
  const month = ymdLocal(now).slice(0, 7);
  const activeSlots = (slotsQ.data ?? []).filter((s) => s.status !== 'cancelled');
  const activeDiag = (consultQ.data?.consultations ?? []).filter((d) => d.status !== 'cancelled');
  const diagMonth = (d: { scheduled_at: string | null; completed_at: string | null }) => {
    const ts = d.scheduled_at ?? d.completed_at;
    if (!ts) return null;
    const dt = new Date(ts);
    return isNaN(dt.getTime()) ? null : ymdLocal(dt).slice(0, 7);
  };
  const total = activeSlots.length + activeDiag.length;
  const completedTotal = activeSlots.filter((s) => s.status === 'completed').length + activeDiag.filter((d) => d.status === 'completed').length;
  const monthSlots = activeSlots.filter((s) => s.consultation_date.slice(0, 7) === month);
  const monthDiag = activeDiag.filter((d) => diagMonth(d) === month);
  const thisMonth = monthSlots.length + monthDiag.length;
  const completedMonth = monthSlots.filter((s) => s.status === 'completed').length + monthDiag.filter((d) => d.status === 'completed').length;
  const loading = (slotsQ.isPending && !!uid) || (consultQ.isPending && doctorName.trim().length > 0);

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access to change your profile picture.'); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    try {
      await uploadAvatarM.mutateAsync({ uri: a.uri, mime: a.mimeType ?? 'image/jpeg', fileName: a.fileName ?? null });
      Alert.alert('Profile photo updated');
    } catch (e: any) { Alert.alert('Upload failed', e?.message ?? 'Unknown error'); }
  };

  const name = doctorName || sideProf.fullName || 'Doctor';
  const specialization = (ident.data.specializations || '').trim();

  return (
    <ConsultantShell active="profile">
      <LCard pad={22} style={{ alignItems: 'center' }}>
        <View style={{ padding: 4, borderRadius: 52, borderWidth: 2, borderColor: CX.indigo200 }}>
          {sideProf.avatarUrl ? (
            <Image source={{ uri: sideProf.avatarUrl }} style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: CX.slate100 }} />
          ) : (
            <View style={{ width: 88, height: 88, borderRadius: 44, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
              <LinearGradient colors={INDIGO_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill as any} />
              <Text style={{ fontFamily: F.bodyBold, fontSize: 30, color: '#fff' }}>{initialsOf(name)}</Text>
            </View>
          )}
          <Pressable onPress={pickAvatar} disabled={uploadAvatarM.isPending} hitSlop={8} accessibilityRole="button" accessibilityLabel="Change profile photo"
            style={{ position: 'absolute', right: -2, bottom: -2, width: 32, height: 32, borderRadius: 16, backgroundColor: CX.indigo, borderWidth: 3, borderColor: CX.white, alignItems: 'center', justifyContent: 'center' }}>
            {uploadAvatarM.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="plus" size={14} color="#fff" strokeWidth={2.6} />}
          </Pressable>
        </View>
        <Pressable onPress={pickAvatar} disabled={uploadAvatarM.isPending} accessibilityRole="button"
          style={{ marginTop: 10, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, backgroundColor: CX.indigo50 }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 10.5, color: CX.indigo }}>{uploadAvatarM.isPending ? 'Uploading' : sideProf.avatarUrl ? 'Change photo' : 'Add photo'}</Text>
        </Pressable>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 24, color: CX.slate900, marginTop: 14, textAlign: 'center' }}>{name}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <View style={{ paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999, backgroundColor: CX.indigo50, borderWidth: 1, borderColor: CX.indigo100 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 10.5, letterSpacing: 0.8, color: CX.indigo }}>CONSULTANT</Text>
          </View>
          {specialization ? (
            <View style={{ paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999, backgroundColor: CX.slate100 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: CX.slate600 }}>{specialization}</Text>
            </View>
          ) : null}
        </View>
        {ident.data.email ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
            <Icon name="send" size={12} color="rgba(91,108,245,0.6)" strokeWidth={2} />
            <Text style={{ fontFamily: F.bodyReg, fontSize: 12.5, color: CX.slate500 }}>{ident.data.email}</Text>
          </View>
        ) : null}
      </LCard>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <StatTile label="Total consultations" value={total} sub={`${completedTotal} completed`} icon="clipboard" tone="indigo" loading={loading} />
        <StatTile label="This month" value={thisMonth} sub={`${MONTHS_LONG[now.getMonth()]} · ${completedMonth} completed`} icon="calendar" tone="emerald" loading={loading} />
      </View>
      <Text style={{ fontFamily: F.bodyReg, fontSize: 11, lineHeight: 16, color: CX.slate400, paddingHorizontal: 4 }}>
        Consultant bookings plus consultation requests assigned to you; cancelled ones are left out.
      </Text>
    </ConsultantShell>
  );
}
