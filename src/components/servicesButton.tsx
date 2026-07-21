import React from 'react';
import { View, Text, Pressable, Modal, ScrollView } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Serif, Body } from './primitives';

/* ============================================================================
   Services button + dialog — ported from the web app's
   ClientSubscriptionServicesDrawer. Pure client-side tier lookup on
   clients.subscription_type (no DB call). Whitelist per service, NOT a tier
   ceiling — e.g. Odds Pro does NOT get "45-Day Review" or "Blood Marker Tests".
   Legacy tiers (Staff, Trial, Influencer, …) fall through to the empty state.
   ========================================================================== */

type ServiceRule = { name: string; availableFor: string[] };

const SERVICE_RULES: ServiceRule[] = [
  { name: 'Personal Trainer', availableFor: ['Odds Basic', 'Odds Plus', 'Odds Pro', 'Odds Lux'] },
  { name: 'Odds Rehab', availableFor: ['Odds Plus', 'Odds Pro', 'Odds Lux', 'Odds Prive', 'Odds APEX'] },
  { name: 'Health & Fitness Manager / CRM', availableFor: ['Odds Plus', 'Odds Pro', 'Odds Lux', 'Odds Prive', 'Odds APEX'] },
  { name: 'Nutrition Counselling', availableFor: ['Odds Pro', 'Odds Lux', 'Odds Prive', 'Odds APEX'] },
  { name: 'Blood Marker Tests (Expert Recommended)', availableFor: ['Odds Lux', 'Odds Prive', 'Odds APEX'] },
  { name: 'Red Light Therapy', availableFor: ['Odds Lux', 'Odds Prive', 'Odds APEX'] },
  { name: 'Doctor / Medical Expert Consultation', availableFor: ['Odds Prive', 'Odds APEX'] },
  { name: '45-Day Review + Quarterly Review', availableFor: ['Odds Basic', 'Odds Plus', 'Odds Lux', 'Odds Prive', 'Odds APEX'] },
  { name: 'Odds Signature Coach', availableFor: ['Odds Prive', 'Odds APEX'] },
];

const CHECK_PATH = 'M20 6 9 17l-5-5';

export function ServicesButton({ subscriptionType }: { subscriptionType?: string | null }) {
  const [open, setOpen] = React.useState(false);
  const normalized = (subscriptionType ?? '').trim();
  const lower = normalized.toLowerCase();
  const isPrive = lower === 'odds prive';
  const available = SERVICE_RULES.filter((svc) => svc.availableFor.some((t) => t.toLowerCase() === lower));
  const col = isPrive ? C.gold : C.blue;

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: hexA(col, 0.12), borderWidth: 1, borderColor: hexA(col, 0.35) }}
      >
        <Icon name={isPrive ? 'crown' : 'sparkle'} size={13} color={col} strokeWidth={2} />
        <Text style={{ fontFamily: F.bodyBold, fontSize: 11.5, color: col }}>Services</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 380, maxHeight: '78%', backgroundColor: '#12100E', borderWidth: 1, borderColor: hexA(col, 0.22), borderRadius: 22, overflow: 'hidden' }}>
            <View style={{ height: 3, backgroundColor: hexA(col, 0.5) }} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 18, paddingBottom: 12 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: hexA(col, 0.13), borderWidth: 1, borderColor: hexA(col, 0.3), alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={isPrive ? 'crown' : 'sparkle'} size={17} color={col} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <Serif style={{ fontSize: 19 }}>Available Services</Serif>
                <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2 }}>
                  {available.length} of {SERVICE_RULES.length} services included
                </Body>
              </View>
              <Pressable onPress={() => setOpen(false)} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="close" size={14} color={C.muted} strokeWidth={2.3} />
              </Pressable>
            </View>
            {normalized ? (
              <View style={{ alignSelf: 'flex-start', marginLeft: 18, marginBottom: 10, paddingVertical: 4, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(col, 0.1), borderWidth: 1, borderColor: hexA(col, 0.28) }}>
                <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: col }}>{normalized}</Text>
              </View>
            ) : null}
            <ScrollView contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 20, gap: 8 }} showsVerticalScrollIndicator={false}>
              {available.length > 0 ? (
                available.map((svc, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 13, backgroundColor: hexA(C.green, 0.07), borderWidth: 1, borderColor: hexA(C.green, 0.22) }}>
                    <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon path={CHECK_PATH} size={13} color="#0B0908" strokeWidth={3} />
                    </View>
                    <Body style={{ flex: 1, fontSize: 13.5, color: '#B9E4C6', fontFamily: F.bodySemi, lineHeight: 18 }}>{svc.name}</Body>
                  </View>
                ))
              ) : (
                <View style={{ flexDirection: 'row', gap: 10, padding: 13, borderRadius: 13, backgroundColor: hexA(C.orange, 0.07), borderWidth: 1, borderColor: hexA(C.orange, 0.25) }}>
                  <Icon name="alert" size={16} color={C.orange} strokeWidth={2} />
                  <Body style={{ flex: 1, fontSize: 12.5, color: '#F0C89C', lineHeight: 18 }}>
                    {normalized
                      ? 'No services are available for this subscription plan.'
                      : 'This client does not have a subscription plan assigned. Please update their profile to assign a plan.'}
                  </Body>
                </View>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
