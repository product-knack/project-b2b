/* Odds Nucleus, "The core of longevity knowledge" (16 Oct 2026): the pure rules of the
   staff reading room over the member app's Odds Library (public.longevity_resources,
   published rows only). A straight port of the web CMS helpers (hub-track
   src/lib/libraryContent.ts) so the phone parses links, bodies and order exactly as
   the editor's preview does. No React, no network: tested in node. */
import type { IconName } from '../icons';

export type NucleusKind = 'article' | 'video';
export type NucleusTopic = 'sleep' | 'nutrition' | 'movement' | 'recovery' | 'metabolic' | 'biomarkers' | 'mind';
export type NucleusMedium = 'audio' | 'video' | 'read';

export type NucleusEvidence = { title: string; authors?: string | null; journal?: string | null; year?: number | string | null; url?: string | null };

/** One published piece, as the app holds it (plain object: the query cache is persisted). */
export type NucleusPiece = {
  id: string;
  kind: NucleusKind;
  title: string;
  summary: string | null;
  body: string | null;
  video_url: string | null;
  audio_url: string | null;
  audio_seconds: number | null;
  cover_url: string | null;
  topic: NucleusTopic;
  minutes: number | null;
  duration_seconds: number | null;
  author_name: string | null;
  author_role: string | null;
  author_photo_url: string | null;
  source_name: string | null;
  source_url: string | null;
  credit: string | null;
  evidence: NucleusEvidence[];
  series: string | null;
  series_order: number | null;
  featured: boolean;
  published_at: string;
  sort: number;
  updated_at: string | null;
};

/* ---------- topics ---------- */
export type TopicMeta = { key: NucleusTopic; label: string; accent: string; icon: IconName };
export const TOPICS: TopicMeta[] = [
  { key: 'sleep', label: 'Sleep', accent: '#6366F1', icon: 'moon' },
  { key: 'nutrition', label: 'Nutrition', accent: '#84CC16', icon: 'leaf' },
  { key: 'movement', label: 'Movement', accent: '#F97316', icon: 'activity' },
  { key: 'recovery', label: 'Recovery', accent: '#14B8A6', icon: 'heart' },
  { key: 'metabolic', label: 'Metabolic', accent: '#F59E0B', icon: 'flame' },
  { key: 'biomarkers', label: 'Biomarkers', accent: '#F43F5E', icon: 'stethoscope' },
  { key: 'mind', label: 'Mind', accent: '#8B5CF6', icon: 'brain' },
];
const FALLBACK_TOPIC: TopicMeta = { key: 'mind', label: 'Longevity', accent: '#E0A53C', icon: 'nucleus' };
export const topicMeta = (t: string | null | undefined): TopicMeta => TOPICS.find((x) => x.key === t) ?? { ...FALLBACK_TOPIC, label: t ? t[0].toUpperCase() + t.slice(1) : FALLBACK_TOPIC.label };
export const topicLabel = (t: string | null | undefined) => topicMeta(t).label;

/* ---------- rows to pieces ---------- */
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

export const normaliseEvidence = (v: unknown): NucleusEvidence[] => {
  if (!Array.isArray(v)) return [];
  const out: NucleusEvidence[] = [];
  for (const e of v as any[]) {
    if (!e || typeof e !== 'object') continue;
    const title = String(e.title ?? '').trim();
    if (!title) continue;
    out.push({ title, authors: str(e.authors), journal: str(e.journal), year: e.year == null || e.year === '' ? null : (e.year as number | string), url: str(e.url) });
  }
  return out;
};

export const toPiece = (r: any): NucleusPiece => ({
  id: String(r.id),
  kind: r.kind === 'video' ? 'video' : 'article',
  title: String(r.title ?? '').trim() || 'Untitled',
  summary: str(r.summary),
  body: typeof r.body === 'string' ? r.body : null,
  video_url: str(r.video_url),
  audio_url: str(r.audio_url),
  audio_seconds: num(r.audio_seconds),
  cover_url: str(r.cover_url),
  topic: (TOPICS.some((t) => t.key === r.topic) ? r.topic : 'mind') as NucleusTopic,
  minutes: num(r.minutes),
  duration_seconds: num(r.duration_seconds),
  author_name: str(r.author_name),
  author_role: str(r.author_role),
  author_photo_url: str(r.author_photo_url),
  source_name: str(r.source_name),
  source_url: str(r.source_url),
  credit: str(r.credit),
  evidence: normaliseEvidence(r.evidence),
  series: str(r.series),
  series_order: num(r.series_order),
  featured: r.featured === true,
  published_at: typeof r.published_at === 'string' ? r.published_at : '',
  sort: num(r.sort) ?? 0,
  updated_at: str(r.updated_at),
});

/* ---------- order, hero, courses, related, filters ---------- */
/** Library order: sort ascending, then published_at newest first (ISO strings compare as text). */
export const libraryOrder = (a: Pick<NucleusPiece, 'sort' | 'published_at'>, b: Pick<NucleusPiece, 'sort' | 'published_at'>) =>
  a.sort - b.sort || (a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0);
export const sortPieces = <T extends Pick<NucleusPiece, 'sort' | 'published_at'>>(rows: T[]): T[] => [...rows].sort(libraryOrder);

/** The hero: the first featured piece in Library order, else the first piece. */
export const heroPiece = (pieces: NucleusPiece[]): NucleusPiece | null => pieces.find((p) => p.featured) ?? pieces[0] ?? null;

export type NucleusCourse = { name: string; pieces: NucleusPiece[] };
/** Pieces sharing a series form a course; inside, series_order ascending (nulls last) then Library order;
    courses in the order their first piece appears. */
export const courses = (pieces: NucleusPiece[]): NucleusCourse[] => {
  const by = new Map<string, NucleusPiece[]>();
  for (const p of pieces) {
    if (!p.series) continue;
    const key = p.series.trim();
    if (!by.has(key)) by.set(key, []);
    by.get(key)!.push(p);
  }
  return Array.from(by.entries()).map(([name, list]) => ({
    name,
    pieces: [...list].sort((a, b) => {
      const ao = a.series_order ?? Number.POSITIVE_INFINITY, bo = b.series_order ?? Number.POSITIVE_INFINITY;
      return ao - bo || libraryOrder(a, b);
    }),
  }));
};

/** The piece's place in its course: { course, index (0-based), total, prev, next }, or null. */
export const coursePlace = (pieces: NucleusPiece[], piece: NucleusPiece) => {
  if (!piece.series) return null;
  const c = courses(pieces).find((x) => x.name === piece.series!.trim());
  if (!c) return null;
  const index = c.pieces.findIndex((p) => p.id === piece.id);
  if (index < 0) return null;
  return { course: c.name, index, total: c.pieces.length, prev: c.pieces[index - 1] ?? null, next: c.pieces[index + 1] ?? null };
};

export const relatedPieces = (pieces: NucleusPiece[], piece: NucleusPiece, n = 3): NucleusPiece[] =>
  pieces.filter((p) => p.topic === piece.topic && p.id !== piece.id).slice(0, n);

export type KindFilter = 'all' | 'article' | 'video' | 'saved';
export const filterPieces = (pieces: NucleusPiece[], f: { q?: string; topic?: NucleusTopic | 'all'; kind?: KindFilter; savedIds?: string[] }): NucleusPiece[] => {
  const q = (f.q ?? '').trim().toLowerCase();
  const saved = new Set(f.savedIds ?? []);
  return pieces.filter((p) => {
    if (f.topic && f.topic !== 'all' && p.topic !== f.topic) return false;
    if (f.kind === 'article' && p.kind !== 'article') return false;
    if (f.kind === 'video' && p.kind !== 'video') return false;
    if (f.kind === 'saved' && !saved.has(p.id)) return false;
    if (q) {
      const hay = `${p.title} ${p.summary ?? ''} ${p.author_name ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
};

/* ---------- links ---------- */
export const isHttps = (url: string | null | undefined) => !!url && /^https:\/\/\S+$/i.test(url.trim());
export const isHttp = (url: string | null | undefined) => !!url && /^https?:\/\/\S+$/i.test(url.trim());

export const youtubeId = (u: string): string | null =>
  (u.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/) || u.match(/youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{6,})/))?.[1] ?? null;
export const vimeoId = (u: string): { id: string; hash?: string } | null => {
  const m = u.match(/vimeo\.com\/(?:video\/)?(\d{5,})(?:\/([a-f0-9]+))?/i);
  if (!m) return null;
  const hash = m[2] || u.match(/[?&]h=([a-f0-9]+)/i)?.[1];
  return { id: m[1], hash };
};
export const isDirectVideo = (u: string) => /^https:\/\/\S+\.(mp4|m3u8)(\?\S*)?$/i.test(u.trim());
export const isDirectAudio = (u: string) => /^https:\/\/\S+\.(mp3|m4a)(\?\S*)?$/i.test(u.trim());

export type VideoHost = 'youtube' | 'vimeo' | 'file';
export const videoHost = (url: string | null | undefined): VideoHost | null => {
  if (!url) return null;
  const u = url.trim();
  if (youtubeId(u)) return 'youtube';
  if (vimeoId(u)) return 'vimeo';
  if (isDirectVideo(u)) return 'file';
  return null;
};
/** The embed page for a WebView (YouTube through the no-cookie host, inline, no related videos; Vimeo with its hash). */
export const videoEmbedUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  const u = url.trim();
  const yt = youtubeId(u);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt}?playsinline=1&rel=0`;
  const vm = vimeoId(u);
  if (vm) return `https://player.vimeo.com/video/${vm.id}${vm.hash ? `?h=${vm.hash}` : ''}`;
  return null;
};
/** A still for a YouTube video when the piece has no cover. */
export const youtubeThumb = (url: string | null | undefined): string | null => {
  const id = url ? youtubeId(url.trim()) : null;
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
};

/* ---------- body ---------- */
export type BodyBlock =
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'bullets'; items: string[] };

/* Inline bold (26 Oct 2026, the web editor's Bold button stores **text**): identical to the web parser so
   all three readers agree. */
export type InlineRun = { text: string; bold: boolean };

/** **x** becomes a bold run; an unmatched ** prints as typed. */
export const inlineRuns = (text: string): InlineRun[] => {
  const out: InlineRun[] = [];
  const re = /\*\*(?=\S)([\s\S]*?\S)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out.length ? out : [{ text, bold: false }];
};
export const stripInline = (text: string) => inlineRuns(text).map((r) => r.text).join('');

/** Blocks split on blank lines; all "- " = bullets; first line "## " = heading (the rest parses on);
    all "> " = pull quote; else a paragraph with its lines joined by a space. Headings lose the bold markers;
    paragraphs, bullets and quotes keep them for inlineRuns at render time. */
export const parseBody = (body: string | null | undefined): BodyBlock[] => {
  const text = (body ?? '').replace(/\r\n/g, '\n');
  const blocks: BodyBlock[] = [];
  for (const chunk of text.split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    if (lines.every((l) => /^- /.test(l))) { blocks.push({ type: 'bullets', items: lines.map((l) => l.replace(/^- /, '').trim()) }); continue; }
    if (/^## /.test(lines[0])) {
      blocks.push({ type: 'h2', text: stripInline(lines[0].replace(/^## /, '').trim()) });
      const rest = lines.slice(1);
      if (rest.length) blocks.push(...parseBody(rest.join('\n')));
      continue;
    }
    if (lines.every((l) => /^> /.test(l))) { blocks.push({ type: 'quote', text: lines.map((l) => l.replace(/^> /, '').trim()).join(' ') }); continue; }
    blocks.push({ type: 'p', text: lines.map((l) => l.trim()).join(' ') });
  }
  return blocks;
};

/* ---------- durations and meta ---------- */
/** m:ss, or h:mm:ss over an hour. */
export const fmtClock = (seconds: number | null | undefined): string => {
  const v = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(v / 3600), m = Math.floor((v % 3600) / 60), s = v % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
};

/** Minutes for the meta line: the editor's number, else the media length rounded up. */
export const minutesOf = (p: NucleusPiece): number | null => {
  if (p.minutes != null && p.minutes > 0) return p.minutes;
  const secs = p.kind === 'video' ? p.duration_seconds : p.audio_seconds;
  return secs != null && secs > 0 ? Math.max(1, Math.ceil(secs / 60)) : null;
};
export const kindLabel = (k: NucleusKind) => (k === 'video' ? 'Video' : 'Article');
/** "Article · 6 min · Dr Name" or "Video · 12 min". */
export const metaLine = (p: NucleusPiece): string => {
  const parts = [kindLabel(p.kind)];
  const m = minutesOf(p);
  if (m != null) parts.push(`${m} min`);
  if (p.author_name) parts.push(p.author_name);
  return parts.join(' · ');
};
export const authorInitial = (name: string | null | undefined) => (name ?? '').trim().charAt(0).toUpperCase() || 'O';

/** The credit line under a piece: `credit` if set, else "Source: <name>". */
export const creditLine = (p: NucleusPiece): string | null => p.credit ?? (p.source_name ? `Source: ${p.source_name}` : null);
/** "authors, journal, year" for an evidence entry (the parts that exist). */
export const evidenceDetail = (e: NucleusEvidence): string => [e.authors, e.journal, e.year == null ? null : String(e.year)].filter((x): x is string => !!x && x.trim() !== '').join(', ');

/* ---------- local state keys and labels ---------- */
export type NucleusPosition = { medium: NucleusMedium; value: number; at: string };
export const localKeys = (userId: string) => ({
  saved: `nucleus:${userId}:saved`,
  recent: `nucleus:${userId}:recent`,
  pos: (pieceId: string) => `nucleus:${userId}:pos:${pieceId}`,
});
export const RECENT_MAX = 20;
export const CONTINUE_MAX = 5;
/** The recent list after opening a piece: newest first, no duplicates, capped. */
export const pushRecent = (recent: string[], id: string): string[] => [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_MAX);

/** The Continue strip's line: "Resume at 4:20" for media with a position, "Continue reading" past 10%, else Read / Watch. */
export const resumeLabel = (p: NucleusPiece, pos: NucleusPosition | null | undefined): string => {
  if (pos && (pos.medium === 'audio' || pos.medium === 'video') && pos.value > 0) return `Resume at ${fmtClock(pos.value)}`;
  if (pos && pos.medium === 'read' && pos.value > 0.1 && pos.value < 0.98) return 'Continue reading';
  return p.kind === 'video' ? 'Watch' : 'Read';
};
/** A stored media position worth resuming: past 5 s and not within the last 10 s of the length. */
export const resumeFrom = (pos: NucleusPosition | null | undefined, lengthSeconds: number | null | undefined): number => {
  if (!pos || pos.medium === 'read' || !(pos.value > 5)) return 0;
  if (lengthSeconds && pos.value > lengthSeconds - 10) return 0;
  return pos.value;
};
export const SPEEDS = [1, 1.25, 1.5] as const;
export const nextSpeed = (s: number): number => SPEEDS[(SPEEDS.indexOf(s as any) + 1) % SPEEDS.length];
