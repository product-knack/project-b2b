// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/whatsapp_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// WhatsApp inbox (Ops) pure rules (19 Nov 2026), ported from the web: access, names, search, IST dates, media
// words, ticks, reactions, unread line, thread items, the reply window and bar modes, local bubbles, retry,
// templates, new chat numbers, the chat key.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/whatsapp.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require);
const W = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// access
eq('ops may see', W.canSeeWhatsApp('ops'), true);
eq('admin may see', W.canSeeWhatsApp('admin'), true);
eq('trainer may not', W.canSeeWhatsApp('trainer'), false);
eq('crm may not', W.canSeeWhatsApp('crm'), false);
eq('nothing may not', W.canSeeWhatsApp(null), false);

// names
eq('indian number', W.formatWaNumber('919466855655'), '+91 94668 55655');
eq('other number', W.formatWaNumber('13323458424'), '+13323458424');
eq('title from name', W.chatTitle({ contact_name: ' Asha Rao ', contact_wa_id: '919466855655' }), 'Asha Rao');
eq('title from number', W.chatTitle({ contact_name: '', contact_wa_id: '919466855655' }), '+91 94668 55655');
eq('initials', W.chatInitials({ contact_name: 'asha rao kumar' }), 'AR');
eq('initials skip a leading mark', W.chatInitials({ contact_name: '~ Asha' }), 'A');
eq('initials of Hindi name', W.chatInitials({ contact_name: 'प्रीति चौधरी' }).length > 0, true);
eq('initials empty', W.chatInitials({ contact_name: null }), '');

// search
const c = { contact_name: 'Asha Rao', contact_wa_id: '919466855655' };
eq('search name', W.chatMatches(c, 'rao'), true);
eq('search digits with spaces', W.chatMatches(c, '94668 55'), true);
eq('search two digits do not count', W.chatMatches(c, '94'), false);
eq('search empty', W.chatMatches(c, '  '), true);
eq('total unread', W.totalUnread([{ unread_count: 2 }, { unread_count: 0 }, { unread_count: 3 }]), 5);

// dates in IST. now = 19 Nov 2026 20:00 IST (14:30 UTC)
const now = new Date('2026-11-19T14:30:00Z');
eq('list time today', W.listTime('2026-11-19T04:00:00Z', now), '9:30 AM');
eq('list time just after IST midnight is today', W.listTime('2026-11-18T18:40:00Z', now), '12:10 AM');
eq('list time yesterday', W.listTime('2026-11-18T10:00:00Z', now), 'Yesterday');
eq('list time this week', W.listTime('2026-11-16T10:00:00Z', now), 'Mon');
eq('list time older', W.listTime('2026-11-05T10:00:00Z', now), '05/11/26');
eq('list time nothing', W.listTime(null, now), '');
eq('day label today', W.dayLabel('2026-11-19T01:00:00Z', now), 'Today');
eq('day label yesterday', W.dayLabel('2026-11-18T01:00:00Z', now), 'Yesterday');
eq('day label older', W.dayLabel('2026-11-17T01:00:00Z', now), '17 Nov 2026');
eq('bubble time noon', W.bubbleTime('2026-11-19T06:30:00Z'), '12:00 PM');

// media words
eq('voice', W.mediaOf({ type: 'audio', media_voice: true, payload: null }).label, 'Voice message');
eq('document name', W.mediaOf({ type: 'document', media_voice: null, payload: { document: { filename: 'report.pdf' } } }).label, 'report.pdf');
eq('text is no media', W.mediaOf({ type: 'text', media_voice: null, payload: null }), null);
eq('template is no media', W.mediaOf({ type: 'template', media_voice: null, payload: null }), null);
eq('album not shared', W.mediaOf({ type: 'unsupported', media_voice: null, payload: { unsupported: { type: 'album' } } }).label, 'Photo album');
eq('unknown not shared', W.mediaOf({ type: 'weird', media_voice: null, payload: null }).label, 'Message not shared by WhatsApp');
eq('preview of photo', W.messagePreview({ type: 'image', body: '', media_voice: null, payload: null }), 'Photo');
eq('edited', W.isEdited({ payload: { edited_at: 'x' } }), true);

// sent from
eq('from phone', W.sentFromLabel({ direction: 'out', source: 'phone_app', payload: null }), 'From the phone');
eq('from dashboard with name', W.sentFromLabel({ direction: 'out', source: 'dashboard', payload: { sent_by_name: 'Preeti Choudhury' } }), 'From the dashboard · Preeti');
eq('from dashboard template', W.sentFromLabel({ direction: 'out', source: 'dashboard', payload: { template: { name: 'hey_there' } } }), 'From the dashboard · Template');
eq('customer has no label', W.sentFromLabel({ direction: 'in', source: 'customer', payload: null }), '');

// ticks
eq('tick read', W.tickOf({ direction: 'out', status: 'played' }), 'read');
eq('tick none for inbound', W.tickOf({ direction: 'in', status: 'received' }), null);
eq('last tick of chat', W.lastTickOf({ last_message_direction: 'out', last_message_status: 'delivered' }), 'delivered');
eq('last tick inbound', W.lastTickOf({ last_message_direction: 'in', last_message_status: 'received' }), null);

// reactions, unread, thread
const msg = (o) => ({ id: o.id, wamid: o.wamid ?? null, phone_number_id: 'P', contact_wa_id: 'C', contact_name: null, direction: o.direction ?? 'in', source: o.direction === 'out' ? 'dashboard' : 'customer', type: o.type ?? 'text', body: o.body ?? 'hi', reply_to_wamid: o.reply ?? null, reaction_emoji: o.emoji ?? null, reaction_target_wamid: o.target ?? null, media_id: null, media_mime: null, media_voice: null, media_state: 'none', media_path: null, payload: null, wa_timestamp: o.at, status: o.status ?? 'received', status_at: null, error_text: null, seen_at: o.seen ?? null, client_ref: o.ref ?? null });
const reacts = [
  msg({ id: 'r1', type: 'reaction', emoji: '👍', target: 'w1', at: '2026-11-19T05:00:00Z' }),
  msg({ id: 'r2', type: 'reaction', emoji: '❤️', target: 'w1', at: '2026-11-19T05:01:00Z' }),
  msg({ id: 'r3', type: 'reaction', emoji: '', target: 'w2', direction: 'out', at: '2026-11-19T05:02:00Z' }),
  msg({ id: 'r4', type: 'reaction', emoji: '🙏', target: 'w1', direction: 'out', at: '2026-11-19T05:03:00Z' }),
];
eq('latest reaction per side, theirs first', W.reactionsByTarget(reacts).w1, [{ emoji: '❤️', direction: 'in' }, { emoji: '🙏', direction: 'out' }]);
eq('a removed reaction shows nothing', W.reactionsByTarget(reacts).w2, undefined);

const bubbles = [
  msg({ id: 'a', wamid: 'w1', at: '2026-11-18T05:00:00Z', seen: 'x' }),
  msg({ id: 'b', wamid: 'w2', direction: 'out', status: 'read', at: '2026-11-18T06:00:00Z' }),
  msg({ id: 'c', wamid: 'w3', at: '2026-11-19T05:00:00Z' }),
  msg({ id: 'd', wamid: 'w4', at: '2026-11-19T05:05:00Z', reply: 'w1' }),
  msg({ id: 'e', wamid: 'w5', at: '2026-11-19T05:06:00Z', reply: 'w0' }),
];
eq('first unread after our reply', W.firstUnread(bubbles), { id: 'c', count: 3 });
eq('nothing unread when seen', W.firstUnread(bubbles.map((b) => ({ ...b, seen_at: 'x' }))), null);
const items = W.buildThread({ messages: bubbles, reactions: reacts, unread: { id: 'c', count: 3 }, now });
eq('thread order', items.map((i) => i.kind === 'message' ? i.message.id : i.kind === 'day' ? `[${i.label}]` : `(${i.count})`), ['[Yesterday]', 'a', 'b', '[Today]', '(3)', 'c', 'd', 'e']);
eq('quoted found', items.find((i) => i.key === 'd').quoted.id, 'a');
eq('quoted missing', items.find((i) => i.key === 'e').quotedMissing, true);
eq('reactions on bubble', items.find((i) => i.key === 'a').reactions.length, 2);
eq('missing quoted wamids', W.missingQuoted(bubbles), ['w0']);

// reply window and the bar
eq('window open', W.replyWindow('2026-11-19T10:00:00Z', now).open, true);
eq('window closed', W.replyWindow('2026-11-18T10:00:00Z', now).open, false);
eq('window none', W.replyWindow(null, now), { open: false, msLeft: 0 });
eq('window text', W.windowLeftText((23 * 60 + 10) * 60000), '23 h 10 min');
eq('window text short', W.windowLeftText(30000), 'less than a minute');
const ok = { mode: 'on', allowed: true, message: null };
eq('bar checking', W.composerMode({ last_inbound_at: '2026-11-19T10:00:00Z' }, null, now), { kind: 'checking' });
eq('bar locked in test', W.composerMode({ last_inbound_at: '2026-11-19T10:00:00Z' }, { mode: 'test', allowed: false, message: null }, now), { kind: 'locked', message: W.WA_SEND_TESTING });
eq('bar open', W.composerMode({ last_inbound_at: '2026-11-19T10:00:00Z' }, ok, now), { kind: 'open' });
eq('bar template only', W.composerMode({ last_inbound_at: '2026-11-17T10:00:00Z' }, ok, now).kind, 'template_only');
eq('bar template only, never wrote', W.composerMode({ last_inbound_at: null }, ok, now), { kind: 'template_only', message: W.WA_TEMPLATE_ONLY_NEW });
eq('empty text', W.composerProblem('  '), 'Type a message first.');
eq('long text', W.composerProblem('x'.repeat(4097)) !== null, true);

// local bubbles and retry
const sends = [{ clientRef: 'k1', phoneNumberId: 'P', contactWaId: 'C', text: 'hello', at: '2026-11-19T06:00:00Z', state: 'sending' }, { clientRef: 'k2', phoneNumberId: 'P', contactWaId: 'C', text: 'gone', at: '2026-11-19T06:01:00Z', state: 'failed', error: 'no' }, { clientRef: 'k3', phoneNumberId: 'P', contactWaId: 'X', text: 'other chat', at: '2026-11-19T06:01:00Z', state: 'sending' }];
const local = W.localSendBubbles(sends, [{ client_ref: 'k1' }], { phone_number_id: 'P', contact_wa_id: 'C' });
eq('stored send hidden, other chat hidden', local.map((b) => b.client_ref), ['k2']);
eq('failed local bubble', [local[0].status, local[0].error_text], ['failed', 'no']);
eq('retry a failed dashboard reply', W.canRetrySend({ direction: 'out', source: 'dashboard', status: 'failed', wamid: null, client_ref: 'k2', body: 'gone' }), true);
eq('no retry once WhatsApp took it', W.canRetrySend({ direction: 'out', source: 'dashboard', status: 'failed', wamid: 'w', client_ref: 'k2', body: 'gone' }), false);
eq('failed label', W.failedLabel({ wamid: null, error_text: 'Number not on WhatsApp' }), 'Not sent: Number not on WhatsApp');
let seq = 0; const fake = () => ((seq++ % 16) + 0.5) / 16;
eq('client ref is a uuid v4 shape', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(W.newClientRef(fake)), true);

// templates
const tpl = { name: 'session_reminder', language: 'en', category: 'UTILITY', header: { format: 'TEXT', text: 'Hi {{1}}' }, body: 'Your session is at {{1}} with {{2}}.', footer: 'Odds', buttons: [{ type: 'QUICK_REPLY', text: 'OK' }], variables: { header: ['1'], body: ['1', '2'] }, named: false, sendable: true, reason: null };
const vals = { header: { 1: 'Asha' }, body: { 1: '6 PM', 2: '  Sagar  ' } };
eq('preview filled', W.templatePreview(tpl, vals), { header: 'Hi Asha', body: 'Your session is at 6 PM with Sagar.', footer: 'Odds', buttons: ['OK'] });
eq('blank stays visible', W.fillTemplateText('Hi {{1}}', {}), 'Hi {{1}}');
eq('sent text', W.templateSentText(tpl, vals), 'Hi Asha\nYour session is at 6 PM with Sagar.');
eq('blanks missing', W.templateProblem(tpl, { header: { 1: 'Asha' }, body: { 1: '6 PM' } }), W.WA_TEMPLATE_BLANKS);
eq('ready to send', W.templateProblem(tpl, vals), null);
eq('not sendable reason', W.templateProblem({ ...tpl, sendable: false, reason: 'Has a media header.' }, vals), 'Has a media header.');
eq('category label', W.templateCategoryLabel('MARKETING'), 'Marketing');
eq('blank label', [W.blankLabel('1'), W.blankLabel('first_name')], ['Blank 1', 'first name']);
eq('template search', W.templateMatches(tpl, 'session reminder'), true);
eq('template name of bubble', W.templateNameOf({ payload: { request: { type: 'template', template: { name: 'x' } } } }), 'x');

// new chat and keys
eq('10 digits = India', W.parseNewChatNumber('99999 99988'), { ok: true, waId: '919999999988' });
eq('leading 0', W.parseNewChatNumber('09999999988'), { ok: true, waId: '919999999988' });
eq('+1 number', W.parseNewChatNumber('+1 (332) 345-8424'), { ok: true, waId: '13323458424' });
eq('too short', W.parseNewChatNumber('12345').ok, false);
eq('chat key parse', W.parseChatKey('1255780014281666:919466855655'), { phoneNumberId: '1255780014281666', contactWaId: '919466855655' });
eq('chat for key: new number once loaded', W.chatForKey([], '1255780014281666:919466855655', true).message_count, 0);
eq('chat for key: not while loading', W.chatForKey([], '1255780014281666:919466855655', false), null);

// copy
const copy = [W.WA_WINDOW_CLOSED, W.WA_SEND_TESTING, W.WA_SEND_OFF, W.WA_SEND_UNKNOWN, W.WA_SEND_FAILED, W.WA_TEMPLATE_ONLY, W.WA_TEMPLATE_ONLY_NEW, W.WA_NEW_CHAT_HINT, W.WA_BAD_NUMBER, W.WA_NOT_SHARED_DETAIL, W.WA_TEMPLATE_BLANKS].join(' ');
eq('no dashes in the copy', /[–—]/.test(copy), false);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
