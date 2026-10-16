/* Essentials "make a workout plan" alert on the trainer home (16 Oct 2026, owner: "if a trainer wins an
   Essentials client's session in the auction and that client has no valid plan, show an alert on the
   home screen: please make <client>'s workout plan with the help of the AI assistant").
   One row per client from get_my_essentials_plan_gaps: red "Make Preeti's workout plan" (opens Create
   Plan, where the Odds AI assistant waits), amber "waiting for approval" once a plan is submitted, red
   "needs changes" when the reviewer sent it back (opens the client's Plan tab). Gone once an approved
   Strength Training plan from the last 42 days exists. Renders nothing otherwise. */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body, Mono } from './primitives';
import { useStore } from '../store';
import { trackEvent } from '../lib/amplitude';
import { useEssentialsPlanGaps } from '../lib/aiPlanQueries';
import { gapCopy, type EssentialsPlanGap } from '../lib/aiPlanDraft';

const AI = '#A78BFA';

export function EssentialsPlanAlertCard() {
  const q = useEssentialsPlanGaps();
  const { set, go, openClient } = useStore();
  const rows = q.data ?? [];
  if (!rows.length) return null;

  const open = (g: EssentialsPlanGap) => {
    trackEvent('Essentials Plan Alert Tapped', { client_id: g.client_id, state: g.plan_state });
    if (g.plan_state === 'needs_revision') { openClient(g.client_id, g.client_name, 'plan'); return; }
    set({ selectedClientId: g.client_id, selectedClientName: g.client_name, editingPlan: null });
    go('create-plan');
  };

  return (
    <View style={{ gap: 8 }}>
      {rows.map((g) => {
        const c = gapCopy(g);
        const col = c.tone === 'amber' ? C.gold : C.red;
        const tappable = c.action != null;
        return (
          <Pressable key={g.client_id} onPress={tappable ? () => open(g) : undefined} disabled={!tappable} accessibilityRole={tappable ? 'button' : 'text'}
            accessibilityLabel={`${c.title}. ${c.line}`}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 16, backgroundColor: hexA(col, pressed && tappable ? 0.14 : 0.08), borderWidth: 1, borderColor: hexA(col, 0.4) })}>
            <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: hexA(col, 0.15), borderWidth: 1, borderColor: hexA(col, 0.45), alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={c.tone === 'amber' ? 'clock' : 'file'} size={18} color={col} strokeWidth={2.1} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: col }}>ESSENTIALS · WORKOUT PLAN</Mono>
              </View>
              <Text numberOfLines={2} style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>{c.title}</Text>
              <Body numberOfLines={3} style={{ fontSize: 11, color: C.ink3, lineHeight: 15 }}>{c.line}</Body>
              {c.action ? (
                <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: hexA(g.plan_state === 'none' ? AI : col, 0.16), borderWidth: 1, borderColor: hexA(g.plan_state === 'none' ? AI : col, 0.5) }}>
                  <Icon name={g.plan_state === 'none' ? 'sparkle' : 'arrowRight'} size={11} color={g.plan_state === 'none' ? AI : col} strokeWidth={2.3} />
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 11, color: g.plan_state === 'none' ? AI : col }}>{c.action}</Text>
                </View>
              ) : null}
            </View>
            {tappable ? <Icon name="chevRight" size={15} color={col} strokeWidth={2.4} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
