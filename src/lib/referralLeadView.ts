/**
 * What the leads team reads about a staff referral in the app (24 Nov 2026): the hot leads list, the words on
 * the flash card, and the lines of one submission in the lead's sheet.
 *
 * The rules themselves (what a duplicate is, when a lead is hot) are in staffReferral.ts, the same file as the
 * web. This file only arranges them for the app's screens. Pure functions only, node-tested in
 * tests/rules/referral_lead_view_test.js.
 */
import {
  HOT_REFERRAL_DAYS, hotReferralLine, leadHotReferral, leadReferralInfo, referralDay,
  type LeadReferralEntry, type LeadReferralInfo,
} from './staffReferral';

/** YYYY-MM-DD, `days` days before `today` (also YYYY-MM-DD). */
export function daysAgoYmd(today: string, days: number): string {
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - days * 86400000).toISOString().slice(0, 10);
}

/** The first lead date the hot list has to read: a hot lead was moved to the day of its referral. */
export const hotLeadsSince = (today: string): string => daysAgoYmd(today, HOT_REFERRAL_DAYS);

export interface HotReferralLead {
  id: string;
  name: string;
  phone: string | null;
  stage: string;
  /** "Referred again today by Raj Thakur (Trainer), referral of Asha Verma (Friend). First came on 3 Oct 2026, source Instagram." */
  line: string;
  /** The day of the referral, YYYY-MM-DD. */
  on: string;
  /** "today", "yesterday" or "on 21 Nov 2026". */
  when: string;
}

/** The hot leads among rows of the leads table (id, name, contact_no, stage, remarks), newest referral first. */
export function hotLeadsFrom(rows: unknown, today: string): HotReferralLead[] {
  if (!Array.isArray(rows)) return [];
  const out: HotReferralLead[] = [];
  const seen = new Set<string>();
  for (const x of rows) {
    if (!x || typeof x !== 'object') continue;
    const l = x as Record<string, unknown>;
    const id = typeof l.id === 'string' ? l.id : '';
    if (!id || seen.has(id)) continue;
    const h = leadHotReferral(l.remarks, typeof l.stage === 'string' ? l.stage : null, today);
    if (!h.hot || !h.latest?.on) continue;
    seen.add(id);
    out.push({
      id,
      name: String(l.name ?? 'A lead'),
      phone: typeof l.contact_no === 'string' && l.contact_no.trim() ? l.contact_no.trim() : null,
      stage: String(l.stage ?? ''),
      line: hotReferralLine(h),
      on: h.latest.on,
      when: h.when,
    });
  }
  return out.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : a.name.localeCompare(b.name)));
}

/** "1 hot lead: referred again by the team" */
export function hotFlashTitle(n: number): string {
  return `${n} hot ${n === 1 ? 'lead' : 'leads'}: referred again by the team`;
}

/** The line under the title. */
export function hotFlashSub(n: number): string {
  return `We had ${n === 1 ? 'this person' : 'these people'} as a lead before and they did not convert. Call first.`;
}

/** The one line shown while the list is narrowed to the hot leads. */
export function hotActiveLine(n: number): string {
  return `Showing ${n} hot ${n === 1 ? 'lead' : 'leads'}, referred again in the last ${HOT_REFERRAL_DAYS} days`;
}

/** The short words beside a lead's name on the dashboard banner: "TODAY", "YESTERDAY", "21 NOV 2026". */
export function hotWhenShort(l: Pick<HotReferralLead, 'when' | 'on'>): string {
  return (l.when === 'today' || l.when === 'yesterday' ? l.when : referralDay(l.on)).toUpperCase();
}

/** The heading of the referral part of a lead's sheet. */
export function referralSheetHead(info: LeadReferralInfo): { title: string; sub: string } {
  if (info.times <= 0) return { title: '', sub: '' };
  if (info.times > 1) return { title: 'Duplicate referral', sub: `This number was submitted ${info.times} times. Every submission is listed.` };
  if (info.duplicate) return { title: 'Duplicate referral', sub: 'This number was already a lead when it was referred.' };
  return { title: 'Referral', sub: 'Submitted by a team member.' };
}

/** The lines of one submission: who referred, the relation, the name as given, the note, and what the lead was before. */
export function referralEntryLines(e: LeadReferralEntry): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = [];
  if (e.client) out.push({ label: 'Client who referred', value: e.client });
  if (e.relation) out.push({ label: 'Relation', value: e.relation });
  if (e.referredName) out.push({ label: 'Name given', value: e.referredName });
  if (e.note) out.push({ label: 'Note', value: e.note });
  if (e.duplicate) {
    const before = [
      e.previousLeadDate ? `lead date ${referralDay(e.previousLeadDate)}` : '',
      e.previousStage ? `stage ${e.previousStage}` : '',
      e.previousSource ? `source ${e.previousSource}` : '',
    ].filter(Boolean);
    if (before.length) out.push({ label: 'Before this referral', value: before.join(', ') });
    if (e.firstLeadDate && e.firstLeadDate !== e.previousLeadDate) out.push({ label: 'First came on', value: referralDay(e.firstLeadDate) });
  }
  if (!out.length) out.push({ label: '', value: 'No other details were given.' });
  return out;
}

/** Everything the lead's sheet draws for the referral part, or null when no member referred the lead. */
export function leadReferralView(remarks: unknown): { info: LeadReferralInfo; title: string; sub: string } | null {
  const info = leadReferralInfo(remarks);
  if (info.times <= 0) return null;
  return { info, ...referralSheetHead(info) };
}

/** The day in India ("24 Nov 2026") of a moment, for the Ops decision card; "" when it cannot be read. */
export function creditDay(iso: string | null | undefined): string {
  const ms = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(ms)) return '';
  return referralDay(new Date(ms + 330 * 60 * 1000).toISOString().slice(0, 10));
}

/** "1 converted lead needs a referral decision" */
export function creditQueueTitle(n: number): string {
  return n === 1 ? '1 converted lead needs a referral decision' : `${n} converted leads need a referral decision`;
}
