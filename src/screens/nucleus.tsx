/* Odds Nucleus, "The core of longevity knowledge" (16 Oct 2026): the staff reading room
   over the member app's Odds Library. Every signed-in role gets the drawer entry
   Learn > Odds Nucleus. Two screens: the hub (search, hero, topics, courses, Continue,
   the full list) and the piece (YouTube / Vimeo inline through a WebView, direct files
   through expo-video, an article read aloud through expo-audio, the body with the
   member app's heading / quote / bullet rules, sources, related pieces). Read only:
   saved pieces, the recent list and resume positions live on the device
   (nucleusQueries.ts); nothing is written to the database. Not a sensitive route
   (published education content, never a client's data). Copy: "piece", "course",
   "Saved", "Continue"; no em dashes. */
import React from 'react';
import { View, Text, Pressable, TextInput, Image, Linking, AppState, ScrollView, PanResponder, ActivityIndicator, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { WebView } from 'react-native-webview';
import { useVideoPlayer, VideoView } from 'expo-video';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { C, F, hexA } from '../theme';
import { Icon, type IconName } from '../icons';
import { Serif, Body, Mono, Card } from '../components/primitives';
import { Page, TitleBlock, BackLink, HScroll, AnimChip } from './common';
import { useStore } from '../store';
import { useAuth } from '../auth';
import { trackEvent } from '../lib/amplitude';
import { getIsOnline } from '../lib/offline';
import { useNucleusPieces, useNucleusLocal, readPosition, type NucleusLocal } from '../lib/nucleusQueries';
import {
  type NucleusPiece, type NucleusTopic, type NucleusPosition, type KindFilter, type BodyBlock,
  TOPICS, topicMeta, heroPiece, courses, coursePlace, relatedPieces, filterPieces,
  videoHost, videoEmbedUrl, youtubeThumb, isHttp, isHttps, parseBody, fmtClock, minutesOf, metaLine, kindLabel,
  authorInitial, creditLine, evidenceDetail, resumeLabel, resumeFrom, nextSpeed,
} from '../lib/nucleus';

const EMBER = C.orange;
const READ_SIZE = 16;
const READ_LINE = 26;
const POSITION_EVERY_MS = 10_000;

/* ============================================================ shared bits ============ */

/** The topic cover: the accent fading into the card, the topic glyph large and faint at the right. */
function TopicTile({ topic, height, radius = 16, children, style }: { topic: NucleusTopic; height?: number; radius?: number; children?: React.ReactNode; style?: any }) {
  const t = topicMeta(topic);
  return (
    <LinearGradient colors={[hexA(t.accent, 0.55), 'rgba(18,14,14,0.9)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[{ height, borderRadius: radius, overflow: 'hidden', justifyContent: 'flex-end' }, style]}>
      <View pointerEvents="none" style={{ position: 'absolute', right: -6, top: -4, opacity: 0.16 }}>
        <Icon name={t.icon} size={Math.max(56, (height ?? 120) * 0.9)} color="#fff" strokeWidth={1.4} />
      </View>
      {children}
    </LinearGradient>
  );
}

/** Cover image, a YouTube still for a video without one, or the topic tile. */
function Cover({ piece, height, radius = 16, children }: { piece: NucleusPiece; height: number; radius?: number; children?: React.ReactNode }) {
  const [failed, setFailed] = React.useState(false);
  const uri = piece.cover_url && isHttps(piece.cover_url) ? piece.cover_url : piece.kind === 'video' ? youtubeThumb(piece.video_url) : null;
  if (uri && !failed) {
    return (
      <View style={{ height, borderRadius: radius, overflow: 'hidden', backgroundColor: '#0c0908', justifyContent: 'flex-end' }}>
        <Image source={{ uri }} onError={() => setFailed(true)} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} resizeMode="cover" />
        {children}
      </View>
    );
  }
  return <TopicTile topic={piece.topic} height={height} radius={radius}>{children}</TopicTile>;
}

function KindGlyph({ kind, size = 34 }: { kind: NucleusPiece['kind']; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: 'rgba(0,0,0,0.55)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={kind === 'video' ? 'play' : 'nucleus'} size={size * 0.45} color="#fff" strokeWidth={2.2} fill={kind === 'video' ? '#fff' : 'none'} />
    </View>
  );
}

function TopicPill({ topic, small }: { topic: NucleusTopic; small?: boolean }) {
  const t = topicMeta(topic);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: small ? 2 : 3, paddingHorizontal: small ? 7 : 9, borderRadius: 999, backgroundColor: hexA(t.accent, 0.16), borderWidth: 1, borderColor: hexA(t.accent, 0.5), alignSelf: 'flex-start' }}>
      <Icon name={t.icon} size={small ? 9 : 11} color={t.accent} strokeWidth={2.2} />
      <Text style={{ fontFamily: F.bodySemi, fontSize: small ? 9.5 : 10.5, color: t.accent }}>{t.label}</Text>
    </View>
  );
}

function Chip({ label, icon, active, accent = EMBER, onPress }: { label: string; icon?: IconName; active: boolean; accent?: string; onPress: () => void }) {
  return (
    <AnimChip active={active} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: active ? hexA(accent, 0.2) : 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: active ? hexA(accent, 0.6) : 'rgba(255,255,255,0.1)' }}>
      {icon ? <Icon name={icon} size={12} color={active ? accent : C.muted} strokeWidth={2.2} /> : null}
      <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: active ? accent : C.ink3 }}>{label}</Text>
    </AnimChip>
  );
}

function Label({ text, right }: { text: string; right?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Mono style={{ fontSize: 9, letterSpacing: 1.4, color: C.mono2 }}>{text.toUpperCase()}</Mono>
      {right}
    </View>
  );
}

function StateCard({ icon, title, text, action, onAction }: { icon: IconName; title: string; text: string; action?: string; onAction?: () => void }) {
  return (
    <Card radius={18} style={{ padding: 18, alignItems: 'center', gap: 8 }}>
      <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: hexA(EMBER, 0.12), borderWidth: 1, borderColor: hexA(EMBER, 0.35), alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color={EMBER} strokeWidth={2} />
      </View>
      <Serif style={{ fontSize: 17, textAlign: 'center' }}>{title}</Serif>
      <Body style={{ fontSize: 12.5, color: C.muted2, textAlign: 'center', lineHeight: 18 }}>{text}</Body>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button" style={{ marginTop: 4, paddingVertical: 9, paddingHorizontal: 18, borderRadius: 999, backgroundColor: hexA(EMBER, 0.12), borderWidth: 1, borderColor: hexA(EMBER, 0.4) }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12.5, color: EMBER }}>{action}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

/* ============================================================ hub cards ============ */

function HeroCard({ piece, saved, onPress }: { piece: NucleusPiece; saved: boolean; onPress: () => void }) {
  const m = minutesOf(piece);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open ${piece.title}`} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <Cover piece={piece} height={210} radius={22}>
        <LinearGradient colors={['rgba(8,6,6,0)', 'rgba(8,6,6,0.92)']} style={{ paddingHorizontal: 16, paddingTop: 50, paddingBottom: 15, gap: 7 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <KindGlyph kind={piece.kind} size={30} />
            <TopicPill topic={piece.topic} />
            {piece.featured ? <Mono style={{ fontSize: 8, letterSpacing: 1.2, color: C.gold }}>FEATURED</Mono> : null}
            <View style={{ flex: 1 }} />
            {saved ? <Icon name="bookmark" size={14} color={C.gold} strokeWidth={2} fill={C.gold} /> : null}
          </View>
          <Serif style={{ fontSize: 22, lineHeight: 26, color: '#fff' }} numberOfLines={2}>{piece.title}</Serif>
          {piece.summary ? <Body style={{ fontSize: 12.5, color: C.ink3, lineHeight: 17 }} numberOfLines={2}>{piece.summary}</Body> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.muted }}>{kindLabel(piece.kind).toUpperCase()}{m != null ? ` · ${m} MIN` : ''}</Mono>
            {piece.kind === 'article' && piece.audio_url ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Icon name="headphones" size={11} color={C.gold} strokeWidth={2.2} />
                <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.gold }}>LISTEN</Mono>
              </View>
            ) : null}
          </View>
        </LinearGradient>
      </Cover>
    </Pressable>
  );
}

function PieceRow({ piece, saved, line, onPress }: { piece: NucleusPiece; saved: boolean; line?: string | null; onPress: () => void }) {
  const t = topicMeta(piece.topic);
  return (
    <Card onPress={onPress} radius={18} border={hexA(t.accent, 0.22)} style={{ padding: 11 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 92 }}>
          <Cover piece={piece} height={64} radius={12}>
            <View style={{ position: 'absolute', left: 6, bottom: 6 }}><KindGlyph kind={piece.kind} size={22} /></View>
          </Cover>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text numberOfLines={2} style={{ fontFamily: F.bodySemi, fontSize: 14, lineHeight: 18, color: '#fff' }}>{piece.title}</Text>
          {piece.summary ? <Body numberOfLines={1} style={{ fontSize: 11.5, color: C.muted2 }}>{piece.summary}</Body> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            <Body style={{ fontSize: 10.5, color: C.muted }} numberOfLines={1}>{line ?? metaLine(piece)}</Body>
            <TopicPill topic={piece.topic} small />
          </View>
        </View>
        <Icon name="bookmark" size={15} color={saved ? C.gold : C.faint2} strokeWidth={2} fill={saved ? C.gold : 'none'} />
      </View>
    </Card>
  );
}

function CourseCard({ name, pieces, onOpen }: { name: string; pieces: NucleusPiece[]; onOpen: (id: string) => void }) {
  const t = topicMeta(pieces[0]?.topic);
  return (
    <Card radius={18} border={hexA(t.accent, 0.3)} colors={[hexA(t.accent, 0.14), 'rgba(18,14,14,0.6)']} style={{ padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: hexA(t.accent, 0.18), borderWidth: 1, borderColor: hexA(t.accent, 0.5), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="layers" size={16} color={t.accent} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Serif style={{ fontSize: 16 }} numberOfLines={1}>{name}</Serif>
          <Body style={{ fontSize: 11, color: C.muted2 }}>{pieces.length} piece{pieces.length === 1 ? '' : 's'} · course</Body>
        </View>
      </View>
      <View style={{ gap: 6 }}>
        {pieces.map((p, i) => (
          <Pressable key={p.id} onPress={() => onOpen(p.id)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${i + 1}. ${p.title}`}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, paddingHorizontal: 9, borderRadius: 11, backgroundColor: pressed ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)' })}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: hexA(t.accent, 0.2), borderWidth: 1, borderColor: hexA(t.accent, 0.5), alignItems: 'center', justifyContent: 'center' }}>
              <Mono style={{ fontSize: 9, color: t.accent }}>{i + 1}</Mono>
            </View>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.body, fontSize: 12.5, color: C.ink }}>{p.title}</Text>
            <Mono style={{ fontSize: 8, letterSpacing: 0.8, color: C.muted3 }}>{kindLabel(p.kind).toUpperCase()}</Mono>
            <Icon name="chevRight" size={12} color={C.muted3} strokeWidth={2.3} />
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

function ContinueStrip({ pieces, local, onOpen }: { pieces: NucleusPiece[]; local: NucleusLocal; onOpen: (id: string) => void }) {
  const items = local.continueIds.map((id) => pieces.find((p) => p.id === id)).filter((p): p is NucleusPiece => !!p);
  if (!items.length) return null;
  return (
    <View style={{ gap: 9 }}>
      <Label text="Continue" />
      <HScroll gap={10}>
        {items.map((p) => {
          const t = topicMeta(p.topic);
          return (
            <Card key={p.id} onPress={() => onOpen(p.id)} radius={16} border={hexA(t.accent, 0.3)} style={{ width: 190, padding: 10, gap: 8 }}>
              <Cover piece={p} height={70} radius={11}>
                <View style={{ position: 'absolute', left: 6, bottom: 6 }}><KindGlyph kind={p.kind} size={22} /></View>
              </Cover>
              <Text numberOfLines={2} style={{ fontFamily: F.bodySemi, fontSize: 12.5, lineHeight: 16, color: '#fff' }}>{p.title}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Icon name="play" size={10} color={t.accent} strokeWidth={2.2} fill={t.accent} />
                <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: t.accent }}>{resumeLabel(p, local.getPosition(p.id)).toUpperCase()}</Mono>
              </View>
            </Card>
          );
        })}
      </HScroll>
    </View>
  );
}

/* ============================================================ the hub ============ */

export function Nucleus() {
  const { go, set } = useStore();
  const q = useNucleusPieces(true);
  const local = useNucleusLocal();
  const [query, setQuery] = React.useState('');
  const [topic, setTopic] = React.useState<NucleusTopic | 'all'>('all');
  const [kind, setKind] = React.useState<KindFilter>('all');
  const pieces = q.data ?? [];

  // One search event per settled query of 2+ characters.
  React.useEffect(() => {
    const s = query.trim();
    if (s.length < 2) return;
    const t = setTimeout(() => trackEvent('Nucleus Searched', { query: s }), 600);
    return () => clearTimeout(t);
  }, [query]);

  const openPiece = (id: string) => { set({ nucleusPieceId: id }); go('nucleus-piece'); };
  const pickTopic = (t: NucleusTopic | 'all') => { setTopic(t); trackEvent('Nucleus Topic Filtered', { topic: t }); };

  const searching = query.trim().length > 0;
  const filtered = filterPieces(pieces, { q: query, topic, kind, savedIds: local.savedIds });
  const hero = heroPiece(pieces);
  const courseList = courses(pieces);
  const filtering = searching || topic !== 'all' || kind !== 'all';
  const online = getIsOnline();

  return (
    <Page gap={18} pt={6} scrollKey="nucleus">
      <TitleBlock title="Odds Nucleus" sub="The core of longevity knowledge" />

      {/* search */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, height: 46, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
        <Icon name="search" size={16} color={C.muted} strokeWidth={2.2} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search pieces, topics, authors" placeholderTextColor={C.faint} returnKeyType="search"
          autoCorrect={false} style={{ flex: 1, fontFamily: F.body, fontSize: 14, color: '#fff', paddingVertical: 0 }} accessibilityLabel="Search the Nucleus" />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search" style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="close" size={12} color={C.ink3} strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </View>

      {q.isLoading && !pieces.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 20, justifyContent: 'center' }}>
          <ActivityIndicator size="small" color={EMBER} />
          <Body style={{ fontSize: 12, color: C.muted2 }}>Opening the Nucleus…</Body>
        </View>
      ) : q.isError && !pieces.length ? (
        <StateCard icon="alert" title="Could not load the Nucleus" text={online ? (q.error as Error)?.message ?? 'Something went wrong.' : 'You are offline and nothing is stored on this phone yet.'} action="Retry" onAction={() => q.refetch()} />
      ) : !pieces.length ? (
        <StateCard icon="nucleus" title="Nothing published yet" text="The web Education Content page fills the Nucleus. Published pieces appear here the next time you open it." />
      ) : (
        <>
          {!online ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, backgroundColor: hexA(C.gold, 0.1), borderWidth: 1, borderColor: hexA(C.gold, 0.35) }}>
              <Icon name="alert" size={13} color={C.gold} strokeWidth={2.2} />
              <Body style={{ flex: 1, fontSize: 11.5, color: C.gold }}>Offline: showing the last list. Articles still read; audio and video need a connection.</Body>
            </View>
          ) : null}

          {!searching && hero ? <HeroCard piece={hero} saved={local.isSaved(hero.id)} onPress={() => openPiece(hero.id)} /> : null}

          {/* topics */}
          <View style={{ gap: 9 }}>
            <Label text="Topics" />
            <HScroll gap={8}>
              <Chip label="All" active={topic === 'all'} onPress={() => pickTopic('all')} />
              {TOPICS.map((t) => <Chip key={t.key} label={t.label} icon={t.icon} accent={t.accent} active={topic === t.key} onPress={() => pickTopic(t.key)} />)}
            </HScroll>
            <HScroll gap={8}>
              {([['all', 'All'], ['article', 'Articles'], ['video', 'Videos'], ['saved', 'Saved']] as [KindFilter, string][]).map(([k, label]) => (
                <Chip key={k} label={label} icon={k === 'saved' ? 'bookmark' : k === 'video' ? 'play' : k === 'article' ? 'nucleus' : undefined} active={kind === k} accent={C.gold} onPress={() => setKind(k)} />
              ))}
            </HScroll>
          </View>

          {!filtering && courseList.length ? (
            <View style={{ gap: 9 }}>
              <Label text="Courses" />
              {courseList.map((c) => <CourseCard key={c.name} name={c.name} pieces={c.pieces} onOpen={openPiece} />)}
            </View>
          ) : null}

          {!filtering ? <ContinueStrip pieces={pieces} local={local} onOpen={openPiece} /> : null}

          <View style={{ gap: 9 }}>
            <Label text={searching ? 'Results' : filtering ? 'Pieces' : 'All pieces'} right={<Mono style={{ fontSize: 9, letterSpacing: 1, color: C.muted3 }}>{filtered.length}</Mono>} />
            {filtered.length ? filtered.map((p) => <PieceRow key={p.id} piece={p} saved={local.isSaved(p.id)} onPress={() => openPiece(p.id)} />) : (
              <Body style={{ fontSize: 12.5, color: C.muted2, paddingVertical: 10, textAlign: 'center' }}>
                {kind === 'saved' && !searching && topic === 'all' ? 'Nothing saved yet. Tap the bookmark on a piece to keep it here.' : 'No piece matches.'}
              </Body>
            )}
          </View>
        </>
      )}
    </Page>
  );
}

/* ============================================================ the piece ============ */

/** A direct video file through expo-video: resumes, stores the position every 10 s and on leave. */
function FileVideo({ url, startAt, onPosition }: { url: string; startAt: number; onPosition: (seconds: number) => void }) {
  const player = useVideoPlayer(url, (p) => { if (startAt > 0) p.currentTime = startAt; p.play(); });
  const onPosRef = React.useRef(onPosition); onPosRef.current = onPosition;
  React.useEffect(() => {
    const read = () => { try { const t = player.currentTime; if (Number.isFinite(t) && t > 0) onPosRef.current(t); } catch { /* released */ } };
    const t = setInterval(read, POSITION_EVERY_MS);
    return () => { clearInterval(t); read(); };
  }, [player]);
  return <VideoView player={player} style={{ width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' }} nativeControls contentFit="contain" />;
}

function VideoBlock({ piece, startAt, onPosition }: { piece: NucleusPiece; startAt: number; onPosition: (seconds: number) => void }) {
  const [started, setStarted] = React.useState(false);
  const [width, setWidth] = React.useState(0);
  const host = videoHost(piece.video_url);
  const embed = videoEmbedUrl(piece.video_url);
  const start = () => {
    if (!getIsOnline()) return;
    trackEvent('Nucleus Video Played', { id: piece.id, host: host ?? 'unknown' });
    setStarted(true);
  };
  const online = getIsOnline();
  if (!host) {
    return (
      <Cover piece={piece} height={190} radius={18}>
        <View style={{ padding: 14, gap: 8, backgroundColor: 'rgba(8,6,6,0.6)' }}>
          <Body style={{ fontSize: 12, color: C.ink3 }}>This video link cannot play inside the app.</Body>
          <Pressable onPress={() => { if (piece.video_url) Linking.openURL(piece.video_url).catch(() => {}); }} hitSlop={10} accessibilityRole="button" style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingHorizontal: 13, borderRadius: 999, backgroundColor: hexA(EMBER, 0.14), borderWidth: 1, borderColor: hexA(EMBER, 0.45) }}>
            <Icon name="play" size={12} color={EMBER} strokeWidth={2.2} fill={EMBER} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, color: EMBER }}>Open in browser</Text>
          </Pressable>
        </View>
      </Cover>
    );
  }
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ borderRadius: 18, overflow: 'hidden', backgroundColor: '#000' }}>
      {!started ? (
        <Pressable onPress={start} accessibilityRole="button" accessibilityLabel={online ? 'Play the video' : 'Needs a connection'} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
          <Cover piece={piece} height={Math.round((width || 320) * 9 / 16)} radius={18}>
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="play" size={26} color="#fff" strokeWidth={2} fill="#fff" />
              </View>
              <Mono style={{ fontSize: 9, letterSpacing: 1.2, color: '#fff' }}>{online ? (startAt > 0 ? `RESUME AT ${fmtClock(startAt)}` : host === 'file' ? 'PLAY' : host === 'youtube' ? 'PLAY ON YOUTUBE' : 'PLAY ON VIMEO') : 'NEEDS A CONNECTION'}</Mono>
            </View>
          </Cover>
        </Pressable>
      ) : host === 'file' && piece.video_url ? (
        <FileVideo url={piece.video_url} startAt={startAt} onPosition={onPosition} />
      ) : embed ? (
        <WebView
          source={{ uri: embed }}
          style={{ width: '100%', height: Math.round((width || 320) * 9 / 16), backgroundColor: '#000' }}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          allowsFullscreenVideo
          mediaPlaybackRequiresUserAction={false}
          originWhitelist={['*']}
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={() => <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#fff" /></View>}
        />
      ) : null}
    </View>
  );
}

/** The article read aloud: expo-audio, seek by drag, 1x / 1.25x / 1.5x, resume, position every 10 s. */
function ListenBar({ piece, startAt, onPosition, onEnd }: { piece: NucleusPiece; startAt: number; onPosition: (seconds: number) => void; onEnd: () => void }) {
  const accent = topicMeta(piece.topic).accent;
  const playerRef = React.useRef<AudioPlayer | null>(null);
  const subRef = React.useRef<{ remove: () => void } | null>(null);
  const playedRef = React.useRef(false);
  const [playing, setPlaying] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [pos, setPos] = React.useState(startAt);
  const [dur, setDur] = React.useState(piece.audio_seconds ?? 0);
  const [speed, setSpeed] = React.useState(1);
  const [err, setErr] = React.useState<string | null>(null);
  const [drag, setDrag] = React.useState<number | null>(null);
  const [barW, setBarW] = React.useState(0);
  const posRef = React.useRef(startAt); posRef.current = pos;
  const onPosRef = React.useRef(onPosition); onPosRef.current = onPosition;
  const onEndRef = React.useRef(onEnd); onEndRef.current = onEnd;

  const store = () => { const p = playerRef.current; const t = p ? safeTime(p) : posRef.current; if (t > 0) onPosRef.current(t); };
  const ensure = async (): Promise<AudioPlayer> => {
    if (playerRef.current) return playerRef.current;
    if (!piece.audio_url) throw new Error('No audio on this piece.');
    setLoading(true);
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    const p = createAudioPlayer({ uri: piece.audio_url }, { updateInterval: 500 });
    playerRef.current = p;
    subRef.current = p.addListener('playbackStatusUpdate', (st: any) => {
      if (!st?.isLoaded) return;
      setLoading(false);
      if (Number.isFinite(st.currentTime)) setPos(st.currentTime);
      if (st.duration) setDur(st.duration);
      setPlaying(!!st.playing);
      if (st.error) { setErr(String(st.error)); setPlaying(false); }
      if (st.didJustFinish) { setPlaying(false); setPos(0); onEndRef.current(); try { p.pause(); p.seekTo(0); } catch { /* released */ } }
    });
    if (startAt > 0) { try { await p.seekTo(startAt); } catch { /* start from 0 */ } }
    return p;
  };
  const toggle = async () => {
    if (!getIsOnline() && !playerRef.current) { setErr('Needs a connection.'); return; }
    try {
      setErr(null);
      const p = await ensure();
      if (p.playing) { p.pause(); store(); }
      else {
        if (!playedRef.current) { playedRef.current = true; trackEvent('Nucleus Audio Played', { id: piece.id }); }
        p.play();
      }
    } catch (e: any) { setLoading(false); setErr(e?.message ?? 'Could not play the audio.'); }
  };
  const cycleSpeed = () => {
    const s = nextSpeed(speed);
    setSpeed(s);
    try { playerRef.current?.setPlaybackRate(s); } catch { /* applied on the next player */ }
  };
  const seekToFraction = async (f: number) => {
    const total = dur || piece.audio_seconds || 0;
    if (!total) return;
    const t = Math.max(0, Math.min(total, f * total));
    setPos(t);
    try { const p = await ensure(); await p.seekTo(t); } catch { /* ignore */ }
  };

  // The position every 10 s while playing; pause in the background; release on leave.
  React.useEffect(() => {
    if (!playing) return;
    const t = setInterval(store, POSITION_EVERY_MS);
    return () => clearInterval(t);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') { try { playerRef.current?.pause(); } catch { /* released */ } store(); } });
    return () => sub.remove();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => () => {
    store();
    try { subRef.current?.remove(); } catch { /* gone */ }
    try { playerRef.current?.pause(); playerRef.current?.remove(); } catch { /* released */ }
    playerRef.current = null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pan = React.useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => setDrag(clamp01(e.nativeEvent.locationX / Math.max(1, barWRef.current))),
    onPanResponderMove: (e) => setDrag(clamp01(e.nativeEvent.locationX / Math.max(1, barWRef.current))),
    onPanResponderRelease: (e) => { const f = clamp01(e.nativeEvent.locationX / Math.max(1, barWRef.current)); setDrag(null); seekToFraction(f); },
    onPanResponderTerminate: () => setDrag(null),
  })).current;
  const barWRef = React.useRef(0); barWRef.current = barW;

  const total = dur || piece.audio_seconds || 0;
  const frac = drag ?? (total ? clamp01(pos / total) : 0);
  const shown = drag != null ? drag * total : pos;
  return (
    <View style={{ borderRadius: 18, padding: 12, backgroundColor: hexA(accent, 0.08), borderWidth: 1, borderColor: hexA(accent, 0.35), gap: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <Pressable onPress={toggle} hitSlop={10} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Listen to this article'}
          style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: playing ? accent : hexA(accent, 0.18), borderWidth: 1, borderColor: hexA(accent, 0.6), alignItems: 'center', justifyContent: 'center' }}>
          {loading ? <ActivityIndicator size="small" color={playing ? '#0c0808' : accent} /> : playing ? (
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <View style={{ width: 4, height: 15, borderRadius: 2, backgroundColor: '#0c0808' }} />
              <View style={{ width: 4, height: 15, borderRadius: 2, backgroundColor: '#0c0808' }} />
            </View>
          ) : <Icon name="play" size={18} color={accent} strokeWidth={2.2} fill={accent} />}
        </Pressable>
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="headphones" size={13} color={accent} strokeWidth={2.2} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: '#fff' }}>Listen to this article</Text>
          </View>
          <Mono style={{ fontSize: 9.5, letterSpacing: 0.8, color: C.muted }}>{fmtClock(shown)} / {fmtClock(total)}{startAt > 0 && !playing && pos === startAt ? ' · RESUMES' : ''}</Mono>
        </View>
        <Pressable onPress={cycleSpeed} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Speed ${speed}x`} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
          <Mono style={{ fontSize: 10, color: C.ink3 }}>{speed}x</Mono>
        </Pressable>
      </View>
      <View {...pan.panHandlers} onLayout={(e) => setBarW(e.nativeEvent.layout.width)} style={{ height: 26, justifyContent: 'center' }} accessibilityRole="adjustable" accessibilityLabel="Seek">
        <View style={{ height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
          <View style={{ width: `${frac * 100}%`, height: 4, backgroundColor: accent }} />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', left: Math.max(0, frac * barW - 7), width: 14, height: 14, borderRadius: 7, backgroundColor: accent, borderWidth: 2, borderColor: '#0c0908' }} />
      </View>
      {err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}
    </View>
  );
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const safeTime = (p: AudioPlayer): number => { try { const t = p.currentTime; return Number.isFinite(t) ? t : 0; } catch { return 0; } };

function BodyBlocks({ blocks }: { blocks: BodyBlock[] }) {
  return (
    <View style={{ gap: 14 }}>
      {blocks.map((b, i) => {
        if (b.type === 'h2') return <Serif key={i} style={{ fontSize: 20, lineHeight: 26, marginTop: 6 }}>{b.text}</Serif>;
        if (b.type === 'quote') return (
          <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ width: 3, borderRadius: 2, backgroundColor: EMBER }} />
            <Text style={{ flex: 1, fontFamily: F.italic, fontSize: READ_SIZE + 1, lineHeight: READ_LINE, color: C.ink }}>{b.text}</Text>
          </View>
        );
        if (b.type === 'bullets') return (
          <View key={i} style={{ gap: 6 }}>
            {b.items.map((it, j) => (
              <View key={j} style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: EMBER, marginTop: 10 }} />
                <Text style={{ flex: 1, fontFamily: F.bodyReg, fontSize: READ_SIZE, lineHeight: READ_LINE, color: C.ink }}>{it}</Text>
              </View>
            ))}
          </View>
        );
        return <Text key={i} style={{ fontFamily: F.bodyReg, fontSize: READ_SIZE, lineHeight: READ_LINE, color: C.ink }}>{b.text}</Text>;
      })}
    </View>
  );
}

function AuthorBlock({ piece }: { piece: NucleusPiece }) {
  const [failed, setFailed] = React.useState(false);
  if (!piece.author_name) return null;
  const uri = piece.author_photo_url && isHttps(piece.author_photo_url) && !failed ? piece.author_photo_url : null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {uri ? <Image source={{ uri }} onError={() => setFailed(true)} style={{ width: 38, height: 38, borderRadius: 19 }} /> : (
        <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: hexA(EMBER, 0.16), borderWidth: 1, borderColor: hexA(EMBER, 0.45), alignItems: 'center', justifyContent: 'center' }}>
          <Serif style={{ fontSize: 15, color: EMBER }}>{authorInitial(piece.author_name)}</Serif>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: '#fff' }}>{piece.author_name}</Text>
        {piece.author_role ? <Body style={{ fontSize: 11.5, color: C.muted2 }}>{piece.author_role}</Body> : null}
      </View>
    </View>
  );
}

function SourcesBlock({ piece }: { piece: NucleusPiece }) {
  const credit = creditLine(piece);
  if (!credit && !piece.evidence.length) return null;
  const open = (url: string | null | undefined, kind: 'source' | 'evidence') => {
    if (!url || !isHttp(url)) return;
    trackEvent('Nucleus Source Opened', { id: piece.id, kind });
    Linking.openURL(url.trim()).catch(() => {});
  };
  return (
    <View style={{ gap: 10, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)' }}>
      {credit ? (
        <Pressable onPress={() => open(piece.source_url, 'source')} disabled={!isHttps(piece.source_url)} hitSlop={6} accessibilityRole={isHttps(piece.source_url) ? 'link' : 'text'}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Body style={{ fontSize: 12, color: isHttps(piece.source_url) ? EMBER : C.muted2 }}>{credit}</Body>
          {isHttps(piece.source_url) ? <Icon name="arrowRight" size={11} color={EMBER} strokeWidth={2.2} /> : null}
        </Pressable>
      ) : null}
      {piece.evidence.length ? (
        <View style={{ gap: 8 }}>
          <Label text="Sources" />
          {piece.evidence.map((e, i) => {
            const link = isHttp(e.url);
            const detail = evidenceDetail(e);
            return (
              <Pressable key={i} onPress={() => open(e.url, 'evidence')} disabled={!link} hitSlop={4} accessibilityRole={link ? 'link' : 'text'}
                style={({ pressed }) => ({ flexDirection: 'row', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: pressed && link ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.035)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' })}>
                <Mono style={{ fontSize: 9, color: C.muted3, marginTop: 3 }}>{String(i + 1).padStart(2, '0')}</Mono>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontFamily: F.bodySemi, fontSize: 12.5, lineHeight: 17, color: link ? EMBER : C.ink }}>{e.title}</Text>
                  {detail ? <Body style={{ fontSize: 11, color: C.muted2, lineHeight: 15 }}>{detail}</Body> : null}
                </View>
                {link ? <Icon name="arrowRight" size={12} color={EMBER} strokeWidth={2.2} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** The reader / player for one piece. Re-mounted per piece id (key) so players and scroll start fresh. */
function PieceView({ piece, all, local, onOpen, onBack }: { piece: NucleusPiece; all: NucleusPiece[]; local: NucleusLocal; onOpen: (id: string) => void; onBack: () => void }) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const t = topicMeta(piece.topic);
  const place = coursePlace(all, piece);
  const related = relatedPieces(all, piece, 3);
  const blocks = React.useMemo(() => parseBody(piece.body), [piece.body]);
  const saved = local.isSaved(piece.id);
  const scrollRef = React.useRef<ScrollView>(null);
  const [pos, setPos] = React.useState<NucleusPosition | null>(() => local.getPosition(piece.id));
  const [posReady, setPosReady] = React.useState(!!local.getPosition(piece.id));
  const [progress, setProgress] = React.useState(0);
  const furthest = React.useRef(0);
  const sizes = React.useRef({ content: 0, view: 0 });
  const localRef = React.useRef(local); localRef.current = local;
  const mediumKind: 'audio' | 'video' | null = piece.kind === 'video' ? 'video' : piece.audio_url ? 'audio' : null;

  // On open: the recent list, the event, and the stored position for this piece.
  React.useEffect(() => {
    local.touchRecent(piece.id);
    trackEvent('Nucleus Piece Opened', { id: piece.id, kind: piece.kind, topic: piece.topic, series: piece.series ?? null });
    if (userId) readPosition(userId, piece.id).then((p) => { setPos(p); setPosReady(true); }).catch(() => setPosReady(true));
    else setPosReady(true);
  }, [piece.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reading progress: the furthest scroll fraction is kept on leave (articles only).
  const onScroll = (e: any) => {
    const y = e.nativeEvent.contentOffset?.y ?? 0;
    const span = Math.max(1, sizes.current.content - sizes.current.view);
    const f = clamp01(y / span);
    setProgress(f);
    if (f > furthest.current) furthest.current = f;
  };
  React.useEffect(() => () => {
    if (piece.kind === 'article' && !piece.audio_url && furthest.current > 0.02) {
      localRef.current.setPosition(piece.id, { medium: 'read', value: Math.round(furthest.current * 100) / 100, at: new Date().toISOString() });
    }
  }, [piece.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const mediaStart = posReady ? resumeFrom(pos, piece.kind === 'video' ? piece.duration_seconds : piece.audio_seconds) : 0;
  const storeMedia = (seconds: number) => {
    if (!mediumKind) return;
    const p = { medium: mediumKind, value: Math.round(seconds), at: new Date().toISOString() } as NucleusPosition;
    localRef.current.setPosition(piece.id, p);
  };
  const continueRead = pos?.medium === 'read' && pos.value > 0.1 && pos.value < 0.98 ? pos.value : null;
  const jumpToRead = () => {
    const span = Math.max(0, sizes.current.content - sizes.current.view);
    scrollRef.current?.scrollTo({ y: (continueRead ?? 0) * span, animated: true });
  };
  const toggleSaved = () => { const on = local.toggleSaved(piece.id); trackEvent('Nucleus Saved', { id: piece.id, saved: on }); };
  const m = minutesOf(piece);

  return (
    <View style={{ flex: 1 }}>
      {piece.kind === 'article' ? (
        <View style={{ height: 3, backgroundColor: 'rgba(255,255,255,0.05)' }}>
          <View style={{ width: `${progress * 100}%`, height: 3, backgroundColor: t.accent }} />
        </View>
      ) : null}
      <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={48} showsVerticalScrollIndicator={false}
        onContentSizeChange={(_w, h) => { sizes.current.content = h; }} onLayout={(e) => { sizes.current.view = e.nativeEvent.layout.height; }}
        keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 8, paddingBottom: 100, gap: 16, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        {/* header row */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}><BackLink label="Odds Nucleus" onPress={onBack} /></View>
          <Pressable onPress={toggleSaved} hitSlop={10} accessibilityRole="button" accessibilityLabel={saved ? 'Remove from Saved' : 'Save this piece'} accessibilityState={{ selected: saved }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: saved ? hexA(C.gold, 0.16) : 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: saved ? hexA(C.gold, 0.55) : 'rgba(255,255,255,0.12)' }}>
            <Icon name="bookmark" size={13} color={saved ? C.gold : C.ink3} strokeWidth={2} fill={saved ? C.gold : 'none'} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: saved ? C.gold : C.ink3 }}>{saved ? 'Saved' : 'Save'}</Text>
          </Pressable>
        </View>

        {place ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 13, backgroundColor: hexA(t.accent, 0.1), borderWidth: 1, borderColor: hexA(t.accent, 0.3) }}>
            <Icon name="layers" size={13} color={t.accent} strokeWidth={2.1} />
            <Body numberOfLines={1} style={{ flex: 1, fontSize: 11.5, color: C.ink3 }}>{place.index + 1} of {place.total} in {place.course}</Body>
            <Pressable onPress={() => place.prev && onOpen(place.prev.id)} disabled={!place.prev} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous piece" style={{ opacity: place.prev ? 1 : 0.3 }}>
              <Icon name="chevLeft" size={16} color={t.accent} strokeWidth={2.4} />
            </Pressable>
            <Pressable onPress={() => place.next && onOpen(place.next.id)} disabled={!place.next} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next piece" style={{ opacity: place.next ? 1 : 0.3 }}>
              <Icon name="chevRight" size={16} color={t.accent} strokeWidth={2.4} />
            </Pressable>
          </View>
        ) : null}

        {piece.kind === 'video' ? (
          posReady ? <VideoBlock piece={piece} startAt={mediaStart} onPosition={storeMedia} /> : <View style={{ height: 190, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.04)' }} />
        ) : (
          <Cover piece={piece} height={200} radius={20} />
        )}

        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <TopicPill topic={piece.topic} />
            <Mono style={{ fontSize: 9, letterSpacing: 1, color: C.muted }}>{kindLabel(piece.kind).toUpperCase()}{m != null ? ` · ${m} MIN${piece.kind === 'article' ? ' READ' : ''}` : ''}</Mono>
          </View>
          <Serif style={{ fontSize: 26, lineHeight: 31 }}>{piece.title}</Serif>
          {piece.summary ? <Body style={{ fontSize: 14, lineHeight: 20, color: C.ink3 }}>{piece.summary}</Body> : null}
          <AuthorBlock piece={piece} />
        </View>

        {piece.kind === 'article' && piece.audio_url && isHttps(piece.audio_url) ? (
          posReady ? <ListenBar piece={piece} startAt={mediaStart} onPosition={storeMedia} onEnd={() => localRef.current.clearPosition(piece.id)} /> : null
        ) : null}

        {continueRead != null ? (
          <Pressable onPress={jumpToRead} hitSlop={8} accessibilityRole="button" style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: hexA(t.accent, 0.14), borderWidth: 1, borderColor: hexA(t.accent, 0.45) }}>
            <Icon name="chevDown" size={12} color={t.accent} strokeWidth={2.4} />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: t.accent }}>Continue reading · {Math.round(continueRead * 100)}%</Text>
          </Pressable>
        ) : null}

        {blocks.length ? (
          <View style={{ gap: 6 }}>
            {piece.kind === 'video' ? <Label text="Notes" /> : null}
            <BodyBlocks blocks={blocks} />
          </View>
        ) : piece.kind === 'article' && !piece.audio_url ? (
          <Body style={{ fontSize: 12.5, color: C.muted2 }}>This piece has no text yet.</Body>
        ) : null}

        <SourcesBlock piece={piece} />

        {related.length ? (
          <View style={{ gap: 9, paddingTop: 6 }}>
            <Label text={`More on ${t.label}`} />
            {related.map((p) => <PieceRow key={p.id} piece={p} saved={local.isSaved(p.id)} onPress={() => onOpen(p.id)} />)}
          </View>
        ) : null}

        {place?.next ? (
          <Pressable onPress={() => onOpen(place.next!.id)} hitSlop={6} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 16, backgroundColor: hexA(t.accent, pressed ? 0.22 : 0.14), borderWidth: 1, borderColor: hexA(t.accent, 0.45) })}>
            <View style={{ flex: 1 }}>
              <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: t.accent }}>NEXT IN {place.course.toUpperCase()}</Mono>
              <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 13.5, color: '#fff', marginTop: 2 }}>{place.next.title}</Text>
            </View>
            <Icon name="arrowRight" size={16} color={t.accent} strokeWidth={2.3} />
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

export function NucleusPiece() {
  const { nucleusPieceId, go, set } = useStore();
  const q = useNucleusPieces(false);
  const local = useNucleusLocal();
  const all = q.data ?? [];
  const found = all.find((p) => p.id === nucleusPieceId) ?? null;
  // A piece unpublished while open stays readable until the user leaves it.
  const held = React.useRef<NucleusPiece | null>(null);
  if (found) held.current = found;
  const piece = found ?? (held.current && held.current.id === nucleusPieceId ? held.current : null);
  const onOpen = (id: string) => set({ nucleusPieceId: id });
  const onBack = () => go('nucleus');

  if (!piece) {
    return (
      <Page gap={14} pt={6}>
        <BackLink label="Odds Nucleus" onPress={onBack} />
        {q.isLoading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 20, justifyContent: 'center' }}>
            <ActivityIndicator size="small" color={EMBER} />
            <Body style={{ fontSize: 12, color: C.muted2 }}>Opening the piece…</Body>
          </View>
        ) : <StateCard icon="nucleus" title="This piece is no longer available" text="It was unpublished or removed. The Nucleus shows what is published now." action="Back to the Nucleus" onAction={onBack} />}
      </Page>
    );
  }
  return <PieceView key={piece.id} piece={piece} all={all} local={local} onOpen={onOpen} onBack={onBack} />;
}

/* ============================================================ home teaser ============ */

/** One compact card on the trainer, doctor, therapist and coach homes: the hero piece, hidden while the list is empty. */
export function NucleusHomeCard() {
  const { go, set } = useStore();
  const q = useNucleusPieces(false);
  const hero = heroPiece(q.data ?? []);
  if (!hero) return null;
  const t = topicMeta(hero.topic);
  const m = minutesOf(hero);
  return (
    <Card onPress={() => { set({ nucleusPieceId: hero.id }); go('nucleus-piece'); }} radius={19} border={hexA(t.accent, 0.3)} colors={[hexA(t.accent, 0.12), 'rgba(18,14,14,0.6)']} style={{ padding: 13 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 84 }}>
          <Cover piece={hero} height={60} radius={12}>
            <View style={{ position: 'absolute', left: 6, bottom: 6 }}><KindGlyph kind={hero.kind} size={22} /></View>
          </Cover>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="nucleus" size={12} color={C.gold} strokeWidth={2.1} />
            <Mono style={{ fontSize: 8.5, letterSpacing: 1.2, color: C.gold }}>ODDS NUCLEUS</Mono>
          </View>
          <Text numberOfLines={2} style={{ fontFamily: F.bodySemi, fontSize: 13.5, lineHeight: 17, color: '#fff' }}>{hero.title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <TopicPill topic={hero.topic} small />
            <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: t.accent }}>{hero.kind === 'video' ? 'WATCH' : 'READ'}{m != null ? ` · ${m} MIN` : ''}</Mono>
            <Pressable onPress={() => go('nucleus')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Browse all pieces">
              <Mono style={{ fontSize: 8.5, letterSpacing: 0.8, color: C.muted }}>BROWSE ALL</Mono>
            </Pressable>
          </View>
        </View>
        <Icon name="chevRight" size={14} color={C.muted3} strokeWidth={2.3} />
      </View>
    </Card>
  );
}

void Platform;
