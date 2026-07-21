import { createClient } from '@supabase/supabase-js'; import fs from 'fs';
const env = fs.readFileSync('.env','utf8');
const URL=/EXPO_PUBLIC_SUPABASE_URL=(.+)/.exec(env)[1].trim();
const KEY=/EXPO_PUBLIC_SUPABASE_ANON_KEY=(.+)/.exec(env)[1].trim();
const sb=createClient(URL,KEY);
await sb.auth.signInWithPassword({ email:'coach@oddsfitness.com', password:'Coach@odds001' });

// 1. ops accounts
const { data: ops } = await sb.from('profiles').select('id, first_name, last_name, email, role').eq('role','ops');
console.log('1. ops profiles:', (ops??[]).map(p=>`${p.first_name} ${p.last_name??''} <${p.email}>`).join(' | ') || 'NONE');

// 2. table reads under coach JWT
for (const [t, sel] of [
  ['leads','id, name, stage, created_at'],
  ['lead_options','*'],
  ['escalations','id, source_type, department, current_level, status'],
  ['payment_crm_assignment_pending','*'],
  ['sales_tracker','id, status, created_at'],
]) {
  const { data, error, count } = await sb.from(t).select(sel, { count: 'exact' }).limit(2);
  console.log(`2. ${t}:`, error ? 'ERR ' + error.message.slice(0,60) : `ok (${count} rows)`, data?.[0] ? '| cols: ' + Object.keys(data[0]).join(',').slice(0,150) : '');
}

// 3. RPCs
const { data: cold, error: ce } = await sb.rpc('get_cold_lead_ids', { _days: 5 });
console.log('3. get_cold_lead_ids:', ce ? 'ERR ' + ce.message.slice(0,60) : `ok (${(cold??[]).length} ids)`);
const { data: holds, error: he } = await sb.rpc('get_qhp_holds');
console.log('   get_qhp_holds:', he ? 'ERR ' + he.message.slice(0,60) : `ok (${(holds??[]).length} rows)`, holds?.[0] ? '| cols: ' + Object.keys(holds[0]).join(',') : '');

// 4. qhp_schedule sample (for QHP stats)
const { data: qs, error: qe } = await sb.from('qhp_schedule').select('*').limit(1);
console.log('4. qhp_schedule:', qe ? 'ERR ' + qe.message.slice(0,60) : 'ok', qs?.[0] ? '| cols: ' + Object.keys(qs[0]).join(',') : '(empty)');
