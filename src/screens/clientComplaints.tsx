/* Client complaints (3 Nov 2026): the individual page for managers, the physio HOD and admins. The server scopes the
   rows (a manager's current teams; every team for the HOD and admins); this screen adds the team chips for a manager
   on several teams, or the manager filter row for the all-teams viewers, and hands the rows to the panel.
   Plan: docs/client-complaints-plan.md. */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';
import { Body } from '../components/primitives';
import { Page, TitleBlock, HScroll } from './common';
import { useAuth } from '../auth';
import { useMyCapabilities } from '../lib/capabilities';
import { useManagerTeam } from '../lib/trainerQueries';
import { useTrainerId } from './trainer';
import { trackEvent } from '../lib/amplitude';
import { ClientComplaintsPanel } from '../components/ClientComplaintsPanel';
import { useInaccurateLogs, useSpecialistReports, useComplaintCounts } from '../lib/clientComplaintsQueries';
import { filterByTeam, managerChips, countsOf, type ComplaintKind, type ComplaintStatusFilter } from '../lib/clientComplaints';

export function ClientComplaints() {
  const { dbRole } = useAuth();
  const caps = useMyCapabilities();
  const uid = useTrainerId();
  const isAdmin = dbRole === 'admin' || dbRole === 'super_admin';
  const allTeams = isAdmin || caps.data.isPhysioHod;
  const allowed = allTeams || caps.data.isManager;
  const [kind, setKind] = React.useState<ComplaintKind>('logs');
  const [status, setStatus] = React.useState<ComplaintStatusFilter>('open');
  const [managerId, setManagerId] = React.useState<string | null>(null); // all-teams viewers: the manager chip
  const [teamId, setTeamId] = React.useState<string | null>(null);       // a manager on several teams: the team chip
  const teamsQ = useManagerTeam(allowed && !allTeams ? uid : '');
  const teams = teamsQ.data?.teams ?? [];
  const logsQ = useInaccurateLogs(status, allTeams ? managerId : null, allowed);
  const reportsQ = useSpecialistReports(status, allTeams ? managerId : null, allowed);
  const countsQ = useComplaintCounts(allowed);
  React.useEffect(() => { if (allowed) trackEvent('Client Complaints Opened', { all_teams: allTeams }); }, [allowed, allTeams]);

  const memberIds = teamId ? (teams.find((t) => t.id === teamId)?.members.map((m) => m.id) ?? null) : null;
  const logs = filterByTeam(logsQ.data ?? [], memberIds);
  const reports = filterByTeam(reportsQ.data ?? [], memberIds);
  // Chips are built from the "all" lists so a filter never hides the other chips; counts for the pills come from the server.
  const chips = allTeams ? managerChips([...(logsQ.data ?? []), ...(reportsQ.data ?? [])]) : [];
  const counts = { logsOpen: countsQ.data?.logs_open ?? countsOf(logs, reports).logsOpen, reportsOpen: countsQ.data?.reports_open ?? countsOf(logs, reports).reportsOpen };

  if (!caps.isLoading && !allowed) {
    return (
      <Page gap={16} pt={6}>
        <TitleBlock title="Client complaints" sub="Manager access required" />
        <Body style={{ fontSize: 12.5, color: C.muted3, textAlign: 'center', paddingVertical: 30 }}>This page is only available to managers, the physio HOD and admins.</Body>
      </Page>
    );
  }
  return (
    <Page gap={14} pt={6}>
      <TitleBlock title="Client complaints" sub={allTeams ? 'Inaccurate logs and reports about every team' : 'Inaccurate logs and reports about your team'} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
        <Icon name="alert" size={15} color={C.gold} strokeWidth={2.1} />
        <Body style={{ flex: 1, fontSize: 11.5, color: C.ink3, lineHeight: 16 }}>Clients review every log after a training and can report an expert who asked them to go outside Odds. Reports are never shown to the expert.</Body>
      </View>
      {allTeams && chips.length > 1 ? (
        <HScroll>
          {chips.map((c) => {
            const active = managerId === c.id;
            return (
              <Pressable key={c.id ?? 'all'} onPress={() => setManagerId(c.id)} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: active }}
                style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.35) : 'rgba(255,255,255,0.07)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.body, fontSize: 12.5, color: active ? C.orange : C.muted }}>{c.label}</Text>
              </Pressable>
            );
          })}
        </HScroll>
      ) : null}
      {!allTeams && teams.length > 1 ? (
        <HScroll>
          {[{ id: null as string | null, teamName: 'All my teams' }, ...teams.map((t) => ({ id: t.id as string | null, teamName: t.teamName }))].map((t) => {
            const active = teamId === t.id;
            return (
              <Pressable key={t.id ?? 'all'} onPress={() => setTeamId(t.id)} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: active }}
                style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: active ? hexA(C.orange, 0.14) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(C.orange, 0.35) : 'rgba(255,255,255,0.07)' }}>
                <Text style={{ fontFamily: active ? F.bodyBold : F.body, fontSize: 12.5, color: active ? C.orange : C.muted }}>{t.teamName}</Text>
              </Pressable>
            );
          })}
        </HScroll>
      ) : null}
      <ClientComplaintsPanel logs={logs} reports={reports} logsQ={logsQ} reportsQ={reportsQ} allTeams={allTeams} kind={kind} onKind={setKind} status={status} onStatus={setStatus} counts={counts} />
    </Page>
  );
}
