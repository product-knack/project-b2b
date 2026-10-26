// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/nucleus_rules_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/nucleus.ts (pure rules): links, body parser, order, hero, courses, filters, durations, labels.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/nucleus.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
const N = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

/* links */
eq('youtube watch', N.youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
eq('youtube watch with extra params', N.youtubeId('https://www.youtube.com/watch?t=10&v=dQw4w9WgXcQ&x=1'), 'dQw4w9WgXcQ');
eq('youtu.be', N.youtubeId('https://youtu.be/dQw4w9WgXcQ?si=abc'), 'dQw4w9WgXcQ');
eq('shorts', N.youtubeId('https://youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
eq('live', N.youtubeId('https://www.youtube.com/live/abcdefghijk'), 'abcdefghijk');
eq('vimeo plain', N.vimeoId('https://vimeo.com/123456789'), { id: '123456789', hash: undefined });
eq('vimeo unlisted path hash', N.vimeoId('https://vimeo.com/123456789/abcdef0123'), { id: '123456789', hash: 'abcdef0123' });
eq('vimeo unlisted query hash', N.vimeoId('https://vimeo.com/video/123456789?h=deadbeef'), { id: '123456789', hash: 'deadbeef' });
eq('direct mp4', N.isDirectVideo('https://cdn.example.com/a/b.mp4?x=1'), true);
eq('direct m3u8', N.isDirectVideo('https://cdn.example.com/a/b.m3u8'), true);
eq('http mp4 refused', N.isDirectVideo('http://cdn.example.com/a/b.mp4'), false);
eq('direct audio', N.isDirectAudio('https://x.y/z.m4a'), true);
eq('host youtube', N.videoHost('https://youtu.be/dQw4w9WgXcQ'), 'youtube');
eq('host vimeo', N.videoHost('https://vimeo.com/123456789'), 'vimeo');
eq('host file', N.videoHost('https://cdn/x.mp4'), 'file');
eq('host unknown', N.videoHost('https://example.com/watch'), null);
eq('embed youtube no-cookie inline', N.videoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&rel=0');
eq('embed vimeo with hash', N.videoEmbedUrl('https://vimeo.com/123456789/abcdef0123'), 'https://player.vimeo.com/video/123456789?h=abcdef0123');
eq('embed file is null', N.videoEmbedUrl('https://cdn/x.mp4'), null);
eq('youtube thumb', N.youtubeThumb('https://youtu.be/dQw4w9WgXcQ'), 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
eq('isHttp allows http', N.isHttp('http://a.b/c'), true);
eq('isHttps refuses http', N.isHttps('http://a.b/c'), false);

/* body */
eq('body blocks', N.parseBody('## Why sleep\r\nFirst line\nsecond line\n\n- one\n- two\n\n> a quote\n> continues\n\nPlain para.'), [
  { type: 'h2', text: 'Why sleep' }, { type: 'p', text: 'First line second line' }, { type: 'bullets', items: ['one', 'two'] }, { type: 'quote', text: 'a quote continues' }, { type: 'p', text: 'Plain para.' },
]);
eq('empty body', N.parseBody(null), []);
// 26 Oct 2026: **bold** runs from the web editor's Bold button
eq('inline bold run', N.inlineRuns('Most adults need **seven to nine** hours.'), [{ text: 'Most adults need ', bold: false }, { text: 'seven to nine', bold: true }, { text: ' hours.', bold: false }]);
eq('unmatched ** prints as typed', N.inlineRuns('2 ** 3 is eight'), [{ text: '2 ** 3 is eight', bold: false }]);
eq('two bold runs, plain text in between', N.inlineRuns('**a** and **b**').map((r) => (r.bold ? 'B:' : 'P:') + r.text), ['B:a', 'P: and ', 'B:b']);
eq('stripInline', N.stripInline('Keep **this** plain'), 'Keep this plain');
eq('heading loses the markers, paragraph keeps them', N.parseBody('## Why **it** matters\nMost need **nine** hours.'), [{ type: 'h2', text: 'Why it matters' }, { type: 'p', text: 'Most need **nine** hours.' }]);
eq('mixed dash block is a paragraph', N.parseBody('- one\nnot a bullet'), [{ type: 'p', text: '- one not a bullet' }]);

/* rows, order, hero, courses */
const row = (o) => ({ id: o.id, kind: o.kind ?? 'article', title: o.title ?? o.id, topic: o.topic ?? 'sleep', sort: o.sort ?? 0, published_at: o.published_at ?? '2026-10-01T00:00:00Z', featured: o.featured ?? false, series: o.series ?? null, series_order: o.series_order ?? null, evidence: o.evidence, minutes: o.minutes, audio_seconds: o.audio_seconds, duration_seconds: o.duration_seconds, video_url: o.video_url, author_name: o.author_name });
const pieces = N.sortPieces([
  row({ id: 'b', sort: 1, published_at: '2026-10-02T00:00:00Z' }),
  row({ id: 'a', sort: 0, published_at: '2026-10-01T00:00:00Z' }),
  row({ id: 'c', sort: 1, published_at: '2026-10-03T00:00:00Z', featured: true, topic: 'nutrition', series: 'Sleep 101', series_order: 2 }),
  row({ id: 'd', sort: 2, series: 'Sleep 101', series_order: 1, kind: 'video', video_url: 'https://youtu.be/dQw4w9WgXcQ', duration_seconds: 725 }),
  row({ id: 'e', sort: 2, series: 'Sleep 101' }),
].map(N.toPiece));
eq('library order', pieces.map((p) => p.id), ['a', 'c', 'b', 'd', 'e']);
eq('hero = first featured', N.heroPiece(pieces).id, 'c');
eq('hero = first piece when none featured', N.heroPiece(pieces.map((p) => ({ ...p, featured: false }))).id, 'a');
eq('hero null when empty', N.heroPiece([]), null);
const cs = N.courses(pieces);
eq('one course, ordered by series_order then library, nulls last', cs.map((c) => [c.name, c.pieces.map((p) => p.id)]), [['Sleep 101', ['d', 'c', 'e']]]);
eq('course place', (({ course, index, total, prev, next }) => ({ course, index, total, prev: prev?.id ?? null, next: next?.id ?? null }))(N.coursePlace(pieces, pieces.find((p) => p.id === 'c'))), { course: 'Sleep 101', index: 1, total: 3, prev: 'd', next: 'e' });
eq('course place null outside a course', N.coursePlace(pieces, pieces[0]), null);
eq('related same topic, not self, max 3', N.relatedPieces(pieces, pieces.find((p) => p.id === 'a')).map((p) => p.id), ['b', 'd', 'e']);

/* filters */
eq('filter topic', N.filterPieces(pieces, { topic: 'nutrition' }).map((p) => p.id), ['c']);
eq('filter kind video', N.filterPieces(pieces, { kind: 'video' }).map((p) => p.id), ['d']);
eq('filter saved', N.filterPieces(pieces, { kind: 'saved', savedIds: ['e', 'zz'] }).map((p) => p.id), ['e']);
eq('filter query on title case-insensitive', N.filterPieces(pieces, { q: ' C ' }).map((p) => p.id), ['c']);
eq('filter query on author', N.filterPieces([N.toPiece(row({ id: 'x', author_name: 'Dr Meera' }))], { q: 'meera' }).length, 1);

/* toPiece normalisation */
const p = N.toPiece({ id: 1, kind: 'other', title: '  ', topic: 'unknown', evidence: [{ title: 'A', year: 2020, url: 'https://x' }, { title: '' }, 'junk'], minutes: '6', sort: null });
eq('toPiece defaults', { kind: p.kind, title: p.title, topic: p.topic, minutes: p.minutes, sort: p.sort, evidence: p.evidence.length }, { kind: 'article', title: 'Untitled', topic: 'mind', minutes: 6, sort: 0, evidence: 1 });

/* durations and labels */
eq('fmtClock m:ss', N.fmtClock(260), '4:20');
eq('fmtClock h:mm:ss', N.fmtClock(3725), '1:02:05');
eq('minutesOf editor value', N.minutesOf(N.toPiece(row({ id: 'm', minutes: 6 }))), 6);
eq('minutesOf from video seconds', N.minutesOf(pieces.find((x) => x.id === 'd')), 13);
eq('minutesOf null', N.minutesOf(N.toPiece(row({ id: 'n' }))), null);
eq('metaLine article', N.metaLine(N.toPiece(row({ id: 'm', minutes: 6, author_name: 'Dr Meera' }))), 'Article · 6 min · Dr Meera');
eq('metaLine video', N.metaLine(pieces.find((x) => x.id === 'd')), 'Video · 13 min');
eq('creditLine credit wins', N.creditLine({ credit: 'Adapted from X', source_name: 'Y' }), 'Adapted from X');
eq('creditLine source', N.creditLine({ credit: null, source_name: 'Y' }), 'Source: Y');
eq('evidenceDetail', N.evidenceDetail({ title: 't', authors: 'A, B', journal: null, year: 2021 }), 'A, B, 2021');
eq('topic meta fallback label', N.topicMeta('other').label, 'Other');
eq('topic accents', N.TOPICS.map((t) => t.key + ':' + t.accent), ['sleep:#6366F1', 'nutrition:#84CC16', 'movement:#F97316', 'recovery:#14B8A6', 'metabolic:#F59E0B', 'biomarkers:#F43F5E', 'mind:#8B5CF6']);

/* local state helpers */
eq('local keys', N.localKeys('u1').pos('p1'), 'nucleus:u1:pos:p1');
eq('pushRecent dedupes and caps', N.pushRecent(['b', 'a'], 'a').slice(0, 2), ['a', 'b']);
eq('pushRecent cap 20', N.pushRecent(Array.from({ length: 25 }, (_, i) => 'x' + i), 'new').length, 20);
eq('resumeLabel audio', N.resumeLabel(N.toPiece(row({ id: 'r' })), { medium: 'audio', value: 260, at: '' }), 'Resume at 4:20');
eq('resumeLabel read 42%', N.resumeLabel(N.toPiece(row({ id: 'r' })), { medium: 'read', value: 0.42, at: '' }), 'Continue reading');
eq('resumeLabel read finished = Read', N.resumeLabel(N.toPiece(row({ id: 'r' })), { medium: 'read', value: 0.99, at: '' }), 'Read');
eq('resumeLabel video none = Watch', N.resumeLabel(pieces.find((x) => x.id === 'd'), null), 'Watch');
eq('resumeFrom past 5 s', N.resumeFrom({ medium: 'audio', value: 42, at: '' }, 600), 42);
eq('resumeFrom near the end = 0', N.resumeFrom({ medium: 'audio', value: 595, at: '' }, 600), 0);
eq('resumeFrom read = 0', N.resumeFrom({ medium: 'read', value: 0.5, at: '' }, null), 0);
eq('speed cycle', [N.nextSpeed(1), N.nextSpeed(1.25), N.nextSpeed(1.5)], [1.25, 1.5, 1]);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
