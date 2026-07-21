import { C } from './theme';
import { ic, IconName } from './icons';

const { orange: O, green, red, blue, purple, gold } = C;

/* ===== Trainer dashboard ===== */
export const quickActions: { label: string; icon: IconName; color: string; badge?: string; action: string }[] = [
  { label: 'Acknowledge Sessions', icon: 'checks', color: green, action: 'sheet:ack' },
  { label: 'Emergency Leave', icon: 'alert', color: red, action: 'sheet:leave' },
];

export const stats = [
  { value: '12', label: 'Sessions Today', delta: '+8%', up: true },
  { value: '8', label: 'Acknowledged', delta: '+4%', up: true },
];

export const leaders = [
  { name: 'Karan Singh Rawat', ref: 4, sess: 86, medal: ic.crown, medalColor: gold },
  { name: 'Vivek Physio', ref: 2, sess: 81, medal: ic.award, medalColor: '#B8BCC4' },
  { name: 'Faizan Odds', ref: 5, sess: 77, medal: ic.award, medalColor: '#C08A52' },
  { name: 'Coach Kiran', ref: 1, sess: 74 },
  { name: 'Priya Nair', ref: 3, sess: 69 },
  { name: 'Aditya Rao', ref: 0, sess: 65 },
  { name: 'Tara Menon', ref: 6, sess: 61 },
  { name: 'Ishaan Gupta', ref: 2, sess: 58 },
  { name: 'Neha Joshi', ref: 1, sess: 54 },
  { name: 'Rohit Sharma', ref: 0, sess: 51 },
  { name: 'Sana Kapoor', ref: 4, sess: 47 },
  { name: 'Dev Patel', ref: 2, sess: 43 },
  { name: 'Meera Iyer', ref: 1, sess: 38 },
  { name: 'Kabir Singh', ref: 0, sess: 34 },
  { name: 'Ananya Bose', ref: 3, sess: 29 },
];

export const sessionCards = [
  { date: '13 JUN', time: '12:00', ampm: 'AM', name: 'Vashist Dev', modality: 'Yoga', window: '11:00 PM – 2:00 AM', status: 'Pending' as const },
  { date: '13 JUN', time: '10:00', ampm: 'PM', name: 'Vashist Dev', modality: 'Strength', window: '9:00 PM – 12:00 AM', status: 'Completed' as const },
  { date: '14 JUN', time: '6:00', ampm: 'AM', name: 'Test By Vashist', modality: 'Strength', window: '5:00 AM – 8:00 AM', status: 'Pending' as const },
];

/* ===== Clients ===== */
export const clientsBase = [
  { init: 'RK', name: 'Rohan Kapoor Tech', crm: 'Ritu Kashyap', phone: '9289287924', sessions: '10/12', expired: true, active: true, av: ['#9A7BEA', '#6E5BD0'] as [string, string], pct: 83 },
  { init: 'VD', name: 'Vashist Dev', crm: 'Ritu Kashyap', phone: '9289287924', sessions: '4/12', expired: true, active: true, av: ['#57C98A', '#3A9E6E'] as [string, string], pct: 33 },
  { init: 'AS', name: 'Aarav Shah', crm: 'Dev Sharma', phone: '9011223344', sessions: '8/12', expired: false, active: true, av: ['#FB8B3A', '#EE5E16'] as [string, string], pct: 67 },
  { init: 'KM', name: 'Kabir Mehra', crm: 'Dev Sharma', phone: '9876543210', sessions: '2/12', expired: true, active: false, av: ['#7C8FE8', '#5B6FD0'] as [string, string], pct: 17 },
  { init: 'TN', name: 'Tara Nanda', crm: 'Ritu Kashyap', phone: '9765432109', sessions: '0/12', expired: false, active: false, av: ['#E0A53C', '#B57F1E'] as [string, string], pct: 4 },
];

export const clientBanners: { icon: IconName; iconColor: string; title: string; short: string }[] = [
  { icon: 'calendar', iconColor: O, title: 'Weekly goals not set', short: 'Set sleep, nutrition & step targets' },
  { icon: 'shield', iconColor: gold, title: 'QHP assessment pending', short: 'Expires in 9 days · last May 22' },
  { icon: 'alert', iconColor: red, title: 'No approved plan', short: 'Create a program & get coach approval' },
];

export const clientInfo: { icon: IconName; label: string; value: string; tone: 'na' | 'red' | 'w' }[] = [
  { icon: 'userCircle', label: 'AGE', value: 'N/A', tone: 'na' },
  { icon: 'users', label: 'GENDER', value: 'N/A', tone: 'na' },
  { icon: 'ruler', label: 'HEIGHT', value: 'N/A', tone: 'na' },
  { icon: 'scale', label: 'WEIGHT', value: 'N/A', tone: 'na' },
  { icon: 'activity', label: 'WAIST SIZE', value: 'N/A', tone: 'na' },
  { icon: 'heart', label: 'VO2 MAX', value: 'N/A', tone: 'na' },
  { icon: 'pin', label: 'LOCATION', value: 'N/A', tone: 'na' },
  { icon: 'swap', label: 'TRAINING MODE', value: 'Non-Hybrid', tone: 'w' },
  { icon: 'target', label: 'CURRENT CYCLE', value: 'Renewal Pending', tone: 'red' },
];

export const clientTabs = ['Sessions', 'Goals', 'Health Report', 'QHP Overview'];

/* ===== Workout ===== */
export const modalities = ['strength', 'yoga', 'boxing', 'pilates', 'aerobics', 'aqua aerobics'];

/* ===== QHP (trainer) ===== */
export const qhpTabDefs = [
  { id: 'upcoming', label: 'Upcoming', count: 5, tone: 'blue' },
  { id: 'my', label: 'My QHPs', count: 12, tone: 'gold' },
  { id: 'without', label: 'Without Report', count: 7, tone: 'amber' },
  { id: 'missing', label: 'Data Missing', count: 3, tone: 'red' },
  { id: 'review', label: 'Pending Review', count: 4, tone: 'amber' },
  { id: 'held', label: 'Held Reports', count: 2, tone: 'red' },
];
type Qli = { name: string; meta: string; right: string; badge: string; tone: string };
const qli = (name: string, meta: string, right: string, badge: string, tone: string): Qli => ({ name, meta, right, badge, tone });
export const qhpData: Record<string, Qli[]> = {
  upcoming: [qli('Sana Kapoor', 'Today · 5:30 PM · Full QHP', 'Coral Gym, Indiranagar', 'Scheduled', 'blue'), qli('Vikram Reddy', 'Tomorrow · 9:00 AM · Re-assess', 'HSR Layout Studio', 'Scheduled', 'blue'), qli('Ananya Bose', 'Wed · 11:00 AM · Full QHP', 'Coral Gym, Indiranagar', 'Scheduled', 'blue')],
  my: [qli('Rohit Sharma', 'Completed 24 Jun · Score 81', 'Whitefield Studio', 'Done', 'green'), qli('Neha Joshi', 'Completed 22 Jun · Score 74', 'Coral Gym', 'Done', 'green')],
  without: [qli('Dev Patel', 'Assessed 20 Jun · report pending', 'HSR Layout Studio', 'No Report', 'amber'), qli('Riya Shah', 'Assessed 19 Jun · report pending', 'Whitefield Studio', 'No Report', 'amber')],
  missing: [qli('Karan Malhotra', 'HRV data not synced', 'Coral Gym', 'Data Missing', 'red'), qli('Pooja Nair', 'Postural images missing', 'HSR Layout Studio', 'Data Missing', 'red')],
  review: [qli('Sahil Khanna', 'AI analysis ready · sign-off', 'Coral Gym', 'Review', 'amber'), qli('Tanvi Rao', 'AI analysis ready · sign-off', 'Whitefield Studio', 'Review', 'amber')],
  held: [qli('Manish Gupta', 'PDF held · regenerate needed', 'HSR Layout Studio', 'Held', 'red'), qli('Divya Menon', 'PDF held · regenerate needed', 'Coral Gym', 'Held', 'red')],
};

/* ===== Managers overview ===== */
export const mgrTabDefs = [
  { id: 'sessions', label: 'Sessions', count: 0, tone: 'green' },
  { id: 'referrals', label: 'Referrals', count: 0, tone: 'gold' },
  { id: 'leaves', label: 'Leaves', count: 2, tone: 'amber' },
  { id: 'incidents', label: 'Incidents', count: 5, tone: 'red' },
  { id: 'retention', label: 'Retention', count: 0, tone: 'green' },
  { id: 'latelogs', label: 'Late Logs', count: 3, tone: 'amber' },
  { id: 'roster', label: 'Roster', count: 0, tone: 'blue' },
  { id: 'plans', label: 'Plan Overview', count: 0, tone: 'blue' },
  { id: 'ack', label: 'Acknowledgments', count: 4, tone: 'amber' },
  { id: 'compliance', label: 'App Compliance', count: 0, tone: 'green' },
];
type Mli = { name: string; meta: string; value: string; badge: string; tone: string };
const mli = (name: string, meta: string, value: string, badge: string, tone: string): Mli => ({ name, meta, value, badge, tone });
export const mgrData: Record<string, Mli[]> = {
  sessions: [mli('Verma · Team A', '8 trainers · this month', '1.1k', 'On track', 'green'), mli('Reddy · Team B', '6 trainers · this month', '842', 'On track', 'green'), mli('Iyer · Team C', '5 trainers · this month', '610', 'Behind', 'amber')],
  referrals: [mli('Verma · Team A', '12 converted', '38', '+6', 'gold'), mli('Reddy · Team B', '7 converted', '21', '+3', 'gold')],
  leaves: [mli('Priya Nair', 'Sick leave · 2 days', '2d', 'Approved', 'green'), mli('Kabir Singh', 'Casual · pending', '1d', 'Pending', 'amber')],
  incidents: [mli('Floor 2 · Rack B', 'Equipment fault · 28 Jun', '!', 'Open', 'red'), mli('Reception', 'Client complaint · 26 Jun', '!', 'Open', 'red')],
  retention: [mli('Verma · Team A', '92% retained', '92%', 'Good', 'green'), mli('Iyer · Team C', '78% retained', '78%', 'At risk', 'amber')],
  latelogs: [mli('Tara Menon', '3 late logs this week', '3', 'Flagged', 'amber'), mli('Ishaan Gupta', '2 late logs this week', '2', 'Flagged', 'amber')],
  roster: [mli('Verma · Team A', '42 slots booked', '42', 'Full', 'blue'), mli('Reddy · Team B', '31 slots booked', '31', 'Open', 'blue')],
  plans: [mli('Team A', '6 plans expiring soon', '6', 'Review', 'amber'), mli('Team B', 'All plans active', '0', 'Clear', 'green')],
  ack: [mli('Safety policy v3', '4 trainers pending', '4', 'Pending', 'amber'), mli('Code of conduct', 'All acknowledged', '0', 'Done', 'green')],
  compliance: [mli('Verma · Team A', '96% app usage', '96%', 'Good', 'green'), mli('Iyer · Team C', '81% app usage', '81%', 'Watch', 'amber')],
};

/* ===== Messenger / Events ===== */
export const convos = [
  { init: 'RK', name: 'Rohan Kapoor', last: 'Thanks coach, felt great today 💪', time: '2m', unread: '3', av: ['#9A7BEA', '#6E5BD0'] as [string, string] },
  { init: 'VD', name: 'Vashist Dev', last: 'Can we reschedule tomorrow?', time: '1h', unread: '1', av: ['#57C98A', '#3A9E6E'] as [string, string] },
  { init: 'AS', name: 'Aarav Shah', last: 'Sent the meal log 📋', time: '3h', unread: '', av: ['#FB8B3A', '#EE5E16'] as [string, string] },
  { init: 'MI', name: 'Meera Iyer', last: 'See you at 7am yoga', time: '1d', unread: '', av: ['#7C8FE8', '#5B6FD0'] as [string, string] },
];

export const events = [
  { tag: 'Class', color: O, date: 'SAT 4 JUL · 7:00 AM', title: 'Sunrise Strength Bootcamp', meta: 'Indiranagar Studio · 18 registered' },
  { tag: 'Meeting', color: blue, date: 'MON 6 JUL · 6:00 PM', title: 'Coach Sync — Q3 Targets', meta: 'Team A · Conference Room' },
];

/* ===== CRM dashboard ===== */
export const crmQuick: { label: string; icon: IconName; color: string; badge?: string; action: string }[] = [
  { label: 'New Client', icon: 'userPlus', color: O, action: 'route:crm-dashboard' },
  { label: 'Create Task', icon: 'clipboard', color: purple, action: 'route:crm-tasks' },
  { label: 'Call Log', icon: 'phone', color: green, action: 'route:crm-comms' },
  { label: 'Approvals', icon: 'checks', color: blue, badge: '6', action: 'route:crm-approvals' },
  { label: 'Escalations', icon: 'alert', color: red, badge: '3', action: 'route:crm-esc' },
  { label: 'Messenger', icon: 'chat', color: gold, badge: '31', action: 'route:messenger' },
];
export const crmStats = [
  { value: '128', label: 'Total Clients', delta: '+6', up: true },
  { value: '91%', label: 'Retention Rate', delta: '+2%', up: true },
  { value: '17', label: 'Tickets Raised', delta: '5 open', up: false },
  { value: '84%', label: 'QHP Done', delta: '+4%', up: true },
];
export const crmBanners: { icon: IconName; iconColor: string; title: string; short: string }[] = [
  { icon: 'rupee', iconColor: O, title: '5 renewals due', short: '₹2,40,000 at risk this week' },
  { icon: 'phone', iconColor: gold, title: '8 stale communications', short: 'No follow-up in 7+ days' },
  { icon: 'users', iconColor: red, title: '2 trainers on leave', short: '12 sessions need reassignment' },
];
export const crmRenewals = [
  { init: 'RK', name: 'Rohan Kapoor', meta: 'Elite · expires in 3 days', value: '₹48,000', badge: 'Urgent', av: ['#9A7BEA', '#6E5BD0'] as [string, string], badgeColor: red },
  { init: 'SF', name: 'Sara Fernandes', meta: 'Pro · expires in 6 days', value: '₹32,000', badge: 'Soon', av: ['#57C98A', '#3A9E6E'] as [string, string], badgeColor: gold },
  { init: 'VR', name: 'Vikram Reddy', meta: 'Elite · expires in 9 days', value: '₹48,000', badge: 'Soon', av: ['#FB8B3A', '#EE5E16'] as [string, string], badgeColor: gold },
];

/* ===== CRM: roadmap / journey / onboard ===== */
export const roadmapDef = [
  { title: 'Onboarding Basics', steps: ['Welcome call', 'App installed', 'Profile complete', 'Consent signed'] },
  { title: 'Medical Assessment', steps: ['QHP scheduled', 'QHP completed', 'Blood report uploaded'] },
  { title: 'Training Setup', steps: ['Trainer assigned', 'First session', 'Plan created'] },
  { title: 'Engagement', steps: ['1-week check-in', 'Feedback collected'] },
];
export const roadmapInit: Record<number, boolean[]> = { 0: [true, true, true, true], 1: [true, true, false], 2: [true, false, false], 3: [false, false] };

export const stageDefs = ['Signup', 'QHP Scheduled', 'QHP Done', 'Report', 'Trainer', 'First Session'];
export const onboardCards = [
  { id: 'aarav', name: 'Aarav Kapoor', email: 'aarav.k@gmail.com', pct: 66, stage: 'Report', urgency: green, elapsed: '12h elapsed · 24h remaining', done: 3, trainer: '🏋️ Anil', noTrainer: false },
  { id: 'vikram', name: 'Vikram Sethi', email: 'vikram.s@gmail.com', pct: 40, stage: 'Trainer', urgency: gold, elapsed: '26h elapsed · 10h remaining', done: 2, trainer: null, noTrainer: true },
  { id: 'neha', name: 'Neha Verma', email: 'neha.v@gmail.com', pct: 20, stage: 'QHP Done', urgency: red, elapsed: '32h elapsed · overdue', done: 1, trainer: '🏋️ Pooja', noTrainer: false },
];

export const journeyCards = [
  { init: 'AK', name: 'Aarav Kapoor', tier: 'Elite', pct: 100, complete: true, av: ['#FB8B3A', '#EE5E16'] as [string, string] },
  { init: 'MS', name: 'Meera Shah', tier: 'Pro', pct: 60, complete: false, av: ['#9A7BEA', '#6E5BD0'] as [string, string] },
  { init: 'RT', name: 'Rohan Tiwari', tier: 'Basic', pct: 30, complete: false, av: ['#57C98A', '#3A9E6E'] as [string, string] },
  { init: 'SP', name: 'Sneha Patel', tier: 'Elite', pct: 10, complete: false, av: ['#7C8FE8', '#5B6FD0'] as [string, string] },
];

/* ===== CRM: sales ===== */
export const salesRows = [
  { name: 'Aarav Kapoor', pkg: 'Elite · Monthly', pct: 60, open: '3', last: '2d ago', won: false, overdue: false },
  { name: 'Meera Shah', pkg: 'Pro · 36 sess.', pct: 25, open: '5', last: '5d ago', won: false, overdue: true },
  { name: 'Rohan Tiwari', pkg: 'Basic · Monthly', pct: 90, open: '1', last: '1d ago', won: false, overdue: false },
  { name: 'Sneha Patel', pkg: 'Elite · 48 sess.', pct: 100, open: '0', last: 'today', won: true, overdue: false },
];
export const salesCtas = [
  { type: 'Upsell to Elite', meta: 'Open · due 5 Jul (overdue)', status: 'Open', color: gold },
  { type: 'Renew package', meta: 'Open · due 11 Jul', status: 'Open', color: O },
  { type: 'Add nutrition add-on', meta: 'Lost · reason: budget', status: 'Lost', color: red },
];

/* ===== CRM: approvals ===== */
export const apprTabDefs = [
  { id: 'reschedule', label: 'Rescheduling', count: 4 },
  { id: 'roster', label: 'Roster Request', count: 2 },
  { id: 'sessions', label: 'Sessions', count: 6 },
  { id: 'late', label: 'Late Workout', count: 3 },
];
export const apprItems = [
  { id: 's1', name: 'Rohan Tiwari', trainer: 'Anil', when: '2 Jul 2026, 6:00 PM', type: 'Strength', loc: 'Indiranagar', reason: 'Client requested evening slot' },
  { id: 's2', name: 'Sneha Patel', trainer: 'Pooja', when: '3 Jul 2026, 7:30 AM', type: 'Yoga', loc: 'HSR Layout', reason: 'Trainer double-booked' },
  { id: 's3', name: 'Kabir Mehra', trainer: 'Anil', when: '3 Jul 2026, 5:00 PM', type: 'Boxing', loc: 'Indiranagar', reason: 'Late log — power outage' },
];

/* ===== CRM: blood ===== */
export const bloodTabDefs = [
  { id: 'all', label: 'All', tone: 'blue' },
  { id: 'has', label: 'Has Reports', tone: 'green' },
  { id: 'missing', label: 'Missing', tone: 'amber' },
];
export const bloodRows = [
  { name: 'Aarav Kapoor', phone: '92892 87924', last: '20-Jun-2026', count: 2, markers: [{ m: 'LDL Cholesterol', sev: 'High', c: red, val: '165 mg/dL', ref: '< 100' }, { m: 'Vitamin D', sev: 'Low', c: gold, val: '18 ng/mL', ref: '30–100' }] },
  { name: 'Meera Shah', phone: '98801 22114', last: '12-Jun-2026', count: 1, markers: [] as { m: string; sev: string; c: string; val: string; ref: string }[] },
  { name: 'Rohan Tiwari', phone: '90011 22334', last: '—', count: 0, markers: [] as { m: string; sev: string; c: string; val: string; ref: string }[] },
];

/* ===== CRM: consume / comms / service / roster / qhp / esc / tasks ===== */
export const consumeList = [
  { name: 'Kabir Mehra', days: '12', last: '12d ago', trainer: 'Anil', left: '6/12', c: red },
  { name: 'Anaya Rao', days: '9', last: '9d ago', trainer: 'Pooja', left: '2/12', c: red },
  { name: 'Dev Sharma', days: '8', last: '8d ago', trainer: 'Anil', left: '11/12', c: gold },
];
export const commsRows = [
  { name: 'Aarav Kapoor', outcome: 'Counselling Done', c: green, last: '20 Jun 2026', follow: '—', emoji: '📞' },
  { name: 'Meera Shah', outcome: 'Follow-up Required', c: gold, last: '19 Jun 2026', follow: '2 Jul', emoji: '📞' },
  { name: 'Rohan Tiwari', outcome: 'Not Responding', c: '#E08A52', last: '18 Jun 2026', follow: '1 Jul (Overdue)', emoji: '📵' },
];
export const serviceRows = [
  { name: 'Aarav Kapoor', svc: 'Physio · 45 min', when: '2 Jul · 11:00', status: 'Pending', c: gold, type: 'Self', pending: true },
  { name: 'Meera Shah', svc: 'Diet consult · 30 min', when: '3 Jul · 16:00', status: 'Confirmed', c: green, type: 'CRM', pending: false },
  { name: 'Rohan Tiwari', svc: 'Doctor · 20 min', when: '4 Jul · 10:00', status: 'Pending', c: gold, type: 'Self', pending: true },
];
export const rosterList = [
  { date: 'Wed 1 Jul', time: '9:00 AM', name: 'Aarav Kapoor', trainer: 'Anil', modality: 'Strength', c: O, status: 'Scheduled', sc: blue },
  { date: 'Wed 1 Jul', time: '10:30 AM', name: 'Meera Shah', trainer: 'Pooja', modality: 'Yoga', c: green, status: 'Confirmed', sc: green },
  { date: 'Thu 2 Jul', time: '5:00 PM', name: 'Rohan Tiwari', trainer: 'Anil', modality: 'Boxing', c: red, status: 'Scheduled', sc: blue },
];
export const qhpCrmList = [
  { name: 'Aarav Kapoor', status: 'On time', c: green, stage: 4 },
  { name: 'Meera Shah', status: 'Pending', c: red, stage: 2 },
  { name: 'Rohan Tiwari', status: 'Pending', c: red, stage: 1 },
];
export const qhpSteps = ['Assigned', 'Assessed', 'Report', 'Explained'];
export const escTabDefs = [
  { id: 'all', label: 'All', count: 9, tone: 'red' },
  { id: 'qhp', label: 'QHP T1', count: 3, tone: 'red' },
  { id: 'comms', label: 'Comms', count: 2, tone: 'amber' },
  { id: 'sessions', label: 'Sessions', count: 2, tone: 'amber' },
  { id: 'renewals', label: 'Renewals', count: 2, tone: 'amber' },
];
export const escRows = [
  { cat: 'QHP', title: 'QHP pending 3h+ after schedule', owner: 'Anil', due: '1 Jul', over: 'Overdue by 3h 20m', remark: 'Assessor unreachable — reassigning' },
  { cat: 'Comms', title: 'No communication logged 10 days', owner: 'Riya', due: '28 Jun', over: 'Overdue by 2d', remark: 'Client travelling, retry Monday' },
  { cat: 'Renewals', title: 'Renewal pending · 0 sessions left', owner: 'Riya', due: '30 Jun', over: 'Overdue by 1d', remark: 'Awaiting payment confirmation' },
];
export const tasksCols = [
  { name: 'Pending', c: blue, tasks: [{ t: 'Call Aarav re renewal', pr: 'High', prc: '#E08A52', due: 'Today' }, { t: 'Collect QHP consent – Sneha', pr: 'Low', prc: blue, due: '4 Jul' }] },
  { name: 'In Progress', c: gold, tasks: [{ t: 'Send diet plan – Meera', pr: 'Medium', prc: gold, due: 'Tomorrow' }] },
  { name: 'Done', c: green, tasks: [{ t: 'Welcome call – Rohan', pr: 'High', prc: '#E08A52', due: 'Done' }] },
];

/* ===== CRM: calendar ===== */
export const chipDays: Record<number, { t: string; c: string }[]> = {
  1: [{ t: '9a', c: O }], 3: [{ t: '10:30a', c: green }], 8: [{ t: '5p', c: red }], 12: [{ t: '7a', c: blue }],
  15: [{ t: '6p', c: purple }], 18: [{ t: '9a', c: O }], 22: [{ t: '11a', c: green }], 25: [{ t: '4p', c: gold }], 29: [{ t: '8a', c: blue }],
};

/* ===== Acknowledge sheet ===== */
export const ackData = [
  { name: 'Vashist Dev', ack: 2, total: 9 },
  { name: 'Meera Iyer', ack: 5, total: 6 },
  { name: 'Kabir Singh', ack: 3, total: 4 },
  { name: 'Rohan Kapoor Tech', ack: 0, total: 3 },
  { name: 'Aditya Rao', ack: 1, total: 8 },
  { name: 'Tara Menon', ack: 0, total: 5 },
  { name: 'Ishaan Gupta', ack: 4, total: 7 },
];

/* ===== Managers dashboard leaderboard ===== */
export const crownP = 'M5 18h14l1-9-5 4-3-7-3 7-5-4z';
export const awardP = 'M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM9 12l-2 8 5-3 5 3-2-8';
export const starP = 'M12 3l2.6 6.3 6.4.5-5 4.2 1.6 6.4L12 16.9l-5.2 3.5 1.6-6.4-5-4.2 6.4-.5z';
export const mgrDefs = [
  { rank: 1, name: 'Sagar', sub: 'Sagar Sharma', team: 10, sess: 804, qhp: 18, refs: 0, medal: crownP, mc: '#E0A53C' },
  { rank: 2, name: 'Astha, Priyanshu', sub: 'Priyanshu Arya', team: 10, sess: 662, qhp: 3, refs: 0, medal: awardP, mc: '#B8BCC4' },
  { rank: 3, name: 'Praveen', sub: 'Praveen chauhan odds', team: 10, sess: 569, qhp: 27, refs: 0, medal: starP, mc: O },
  { rank: 4, name: 'Khalid', sub: 'Khalid Ahmad', team: 10, sess: 507, qhp: 11, refs: 1, medal: null, mc: null },
  { rank: 5, name: 'Ritu', sub: 'Ritu Kashyap', team: 9, sess: 441, qhp: 6, refs: 2, medal: null, mc: null },
];
export const mgrMonthTabs = [
  { id: 'overall', label: 'Overall' }, { id: 'may', label: 'May' }, { id: 'jun', label: 'Jun' }, { id: 'jul', label: 'Jul' },
];

/* ===== Navigation groups ===== */
export type NavItem = { label: string; icon: IconName; route: string; badge?: string };
export type NavGroup = { label: string; items: NavItem[] };
export const trainerNav: NavGroup[] = [
  { label: 'My Work', items: [
    { label: 'Dashboard', icon: 'grid', route: 'dashboard' },
    { label: 'Messenger', icon: 'chat', route: 'messenger', badge: '31' },
    { label: 'Client Threads', icon: 'atSign', route: 'client-threads' },
    { label: 'My Profile', icon: 'userCircle', route: 'profile' },
    { label: 'My Clients', icon: 'users', route: 'clients' },
    { label: 'Workout Templates', icon: 'file', route: 'workout-templates' },
    { label: 'Sessions', icon: 'dumbbell', route: 'sessions' },
    { label: 'Payouts', icon: 'rupee', route: 'payouts' },
  ] },
  { label: 'QHP', items: [
    { label: 'QHP', icon: 'heart', route: 'qhp', badge: '8' },
    { label: 'QHP Report Review', icon: 'checks', route: 'qhp-review' },
    { label: 'B2C Reports', icon: 'file', route: 'b2c-reports' },
    { label: 'QHP Manager', icon: 'clipboard', route: 'qhp-manager', badge: '9' },
    { label: 'QHP Stats', icon: 'chart', route: 'qhp-stats' },
  ] },
  { label: 'Team & Analytics', items: [
    { label: 'Managers Dashboard', icon: 'crown', route: 'mgr-dash' },
    { label: 'Managers Overview', icon: 'grid', route: 'managers', badge: '3' },
    { label: 'QHP Overview', icon: 'heart', route: 'managers' },
    { label: 'Trainers Tracker', icon: 'users', route: 'managers' },
    { label: 'Workout Analyst', icon: 'activity', route: 'workout-analyst' },
    { label: 'Trainer Roster', icon: 'map', route: 'managers' },
  ] },
];
export const crmNav: NavGroup[] = [
  { label: 'Workspace', items: [
    { label: 'Dashboard', icon: 'grid', route: 'crm-dashboard' },
    { label: 'My Clients', icon: 'users', route: 'crm-clients' },
    { label: 'Messenger', icon: 'chat', route: 'messenger' },
    { label: 'Client Threads', icon: 'atSign', route: 'client-threads' },
  ] },
  { label: 'Client Insights', items: [
    { label: 'Client Distribution', icon: 'layers', route: 'crm-distribution' },
    { label: 'Session Consumption', icon: 'activity', route: 'crm-consume' },
    { label: 'Communications', icon: 'phone', route: 'crm-comms' },
  ] },
  { label: 'Operations', items: [
    { label: 'Roster Management', icon: 'map', route: 'crm-roster' },
    { label: 'QHP', icon: 'heart', route: 'crm-qhp' },
    { label: 'Escalations', icon: 'alert', route: 'crm-esc' },
    { label: 'Tasks', icon: 'clipboard', route: 'crm-tasks' },
    { label: 'Tools', icon: 'grid', route: 'crm-tools' },
  ] },
];

/* Coach = head-of-trainers. Scope everywhere: coach_trainers → trainer_clients
   (actively_training) → clients. Routes map to screens in Router.tsx. */
export const coachNav: NavGroup[] = [
  { label: 'Overview', items: [
    { label: 'Dashboard', icon: 'grid', route: 'coach-dashboard' },
    { label: 'Trainers', icon: 'crown', route: 'coach-trainers' },
    { label: 'Assessments', icon: 'heart', route: 'coach-assessments' },
  ] },
  { label: 'Clients', items: [
    { label: 'My Clients', icon: 'users', route: 'coach-clients' },
    { label: 'Client Threads', icon: 'atSign', route: 'client-threads' },
    { label: 'Clients Overview', icon: 'layers', route: 'coach-clients-overview' },
    { label: 'Progression', icon: 'trend', route: 'coach-progression' },
  ] },
  { label: 'Plans', items: [
    { label: 'Programs', icon: 'clipboard', route: 'coach-programs' },
    { label: 'Client Plans', icon: 'list', route: 'coach-plans-overview' },
    { label: 'Approved Plans', icon: 'checks', route: 'coach-approved-plans' },
  ] },
  /* Capability-gated (chrome.itemVisible): workout_analysist / workout_compliances_analyst */
  { label: 'Analytics', items: [
    { label: 'Workout Analyst', icon: 'dumbbell', route: 'workout-analyst' },
    { label: 'Plans Analyst', icon: 'activity', route: 'plans-analyst' },
  ] },
];

/* Ops = sales/operations desk. Web /ops/* pages; routes map to screens in ops.tsx,
   opsLeads.tsx and opsEscalations.tsx. QHP Stats is shared with the trainer workspace. */
export const opsNav: NavGroup[] = [
  { label: 'Workspace', items: [
    { label: 'Dashboard', icon: 'grid', route: 'ops-dashboard' },
    { label: 'Leads', icon: 'users', route: 'ops-leads' },
    { label: 'Clients', icon: 'layers', route: 'ops-clients' },
    { label: 'Messenger', icon: 'chat', route: 'messenger' },
  ] },
  { label: 'Sales', items: [
    { label: 'Sales Targets', icon: 'trend', route: 'ops-targets' },
    { label: 'CRM Activity', icon: 'activity', route: 'ops-activity' },
    { label: 'CRM Pending', icon: 'clipboard', route: 'ops-crm-pending' },
  ] },
  { label: 'Operations', items: [
    { label: 'QHP Hold', icon: 'heart', route: 'ops-qhp-hold' },
    { label: 'QHP Stats', icon: 'chart', route: 'qhp-stats' },
    { label: 'Escalations', icon: 'alert', route: 'ops-escalations' },
  ] },
];

/* Admin workspace — Dashboard + Renewals live; more tabs (New Leads, …) come next. */
export const adminNav: NavGroup[] = [
  { label: 'Workspace', items: [
    { label: 'Dashboard', icon: 'grid', route: 'admin-dashboard' },
    { label: 'Clients', icon: 'users', route: 'admin-clients' },
    { label: 'Renewals', icon: 'swap', route: 'admin-renewals' },
    { label: 'Requests', icon: 'inbox', route: 'admin-requests' },
    { label: 'Incidents', icon: 'alert', route: 'admin-incidents' },
    { label: 'Users', icon: 'userCircle', route: 'admin-users' },
    { label: 'Performance', icon: 'trend', route: 'admin-performance' },
    { label: 'Certifications', icon: 'award', route: 'admin-certifications' },
    { label: 'Tools', icon: 'grid', route: 'admin-tools' },
    { label: 'Messenger', icon: 'chat', route: 'messenger' },
    { label: 'Client Threads', icon: 'atSign', route: 'client-threads' },
  ] },
];

/* Doctor workspace (physios + nutritionists). HOD-only items (All Clients, Roster,
   Approvals) are gated in chrome.itemVisible by the HEAD_DOCTOR profile id. */
export const marketingNav: NavGroup[] = [
  { label: 'Workspace', items: [
    { label: 'Dashboard', icon: 'grid', route: 'marketing-dashboard' },
    { label: 'Influencer Clients', icon: 'users', route: 'marketing-clients' },
    { label: 'Leads', icon: 'userPlus', route: 'marketing-leads' },
    { label: 'Lead Analytics', icon: 'chart', route: 'marketing-lead-analytics' },
    { label: 'Messenger', icon: 'chat', route: 'messenger' },
  ] },
];

export const doctorNav: NavGroup[] = [
  { label: 'Workspace', items: [
    { label: 'Dashboard', icon: 'grid', route: 'doctor-dashboard' },
    { label: 'Sessions', icon: 'activity', route: 'doctor-sessions' },
    { label: 'My Clients', icon: 'users', route: 'doctor-clients' },
    { label: 'Messenger', icon: 'chat', route: 'messenger' },
    { label: 'Client Threads', icon: 'atSign', route: 'client-threads' },
  ] },
  { label: 'Head Doctor', items: [
    { label: 'All Clients', icon: 'layers', route: 'doctor-all-clients' },
    { label: 'Roster', icon: 'calendar', route: 'doctor-roster' },
    { label: 'Protocol Approvals', icon: 'checks', route: 'doctor-protocol-approvals' },
  ] },
];

/* ===== Bottom tabs ===== */
export const bottomTabs: { id: string; label: string; icon: IconName; route: string; badge?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid', route: 'dashboard' },
  { id: 'messenger', label: 'Messenger', icon: 'chat', route: 'messenger', badge: '31' },
  { id: 'profile', label: 'My Profile', icon: 'userCircle', route: 'profile' },
  { id: 'clients', label: 'My Clients', icon: 'users', route: 'clients' },
  { id: 'sessions', label: 'Sessions', icon: 'dumbbell', route: 'sessions' },
];
export const tabMap: Record<string, string> = {
  dashboard: 'dashboard', clients: 'clients', client: 'clients', sessions: 'sessions', workout: 'sessions',
  messenger: 'messenger', profile: 'profile', qhp: 'dashboard', managers: 'dashboard',
};
