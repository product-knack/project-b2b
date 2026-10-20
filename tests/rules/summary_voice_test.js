// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/summary_voice_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/summaryVoice.ts: the controller's sequencing with stubbed deps
// (parts back to back, cloud failure -> device voice, player stall / error -> device voice,
// stop, pause / resume, a second play while one runs, both voices failing).
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const load = (file, stubs) => {
  const src = fs.readFileSync(file, 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', js)(m, m.exports, (name) => (name in stubs ? stubs[name] : require(name)));
  return m.exports;
};
const rules = load(ROOT + '/src/lib/clientHealthSummary.ts', {});
const focus = load(ROOT + '/src/lib/audioFocus.ts', {});
const V = load(ROOT + '/src/lib/summaryVoice.ts', {
  react: { useState: () => [null, () => {}], useRef: () => ({ current: null }), useEffect: () => {} },
  'react-native': { Platform: { OS: 'android' } },
  'expo-speech': { stop: async () => {}, speak: () => {}, pause: async () => {}, resume: async () => {} },
  'expo-audio': { createAudioPlayer: () => ({}), setAudioModeAsync: async () => {} },
  './supabase': { supabase: {} },
  './withTimeout': { invokeWithTimeout: async () => ({ data: null, error: null }) },
  './clientHealthSummary': rules,
  './audioFocus': focus,
});

let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const tick = () => new Promise((r) => setImmediate(r));

/* ---- fake timers ---- */
const timers = [];
const setTimer = (fn, ms) => { const t = { fn, ms, dead: false }; timers.push(t); return t; };
const clearTimer = (t) => { if (t) t.dead = true; };
const fireTimers = () => { const live = timers.splice(0).filter((t) => !t.dead); live.forEach((t) => t.fn()); return live.length; };

/* ---- fake player ---- */
const makeFakePlayer = (log) => (uri) => {
  const p = { uri, listeners: [], played: 0, paused: 0, removed: false, replaced: [] };
  log.players.push(p);
  return {
    play() { p.played++; log.events.push(`play ${p.uri}`); },
    pause() { p.paused++; log.events.push('pause'); },
    replace(src) { p.uri = src.uri; p.replaced.push(src.uri); log.events.push(`replace ${src.uri}`); },
    remove() { p.removed = true; log.events.push('remove'); },
    addListener(_ev, cb) { p.listeners.push(cb); return { remove() { p.listeners = p.listeners.filter((x) => x !== cb); } }; },
    _status(st) { p.listeners.slice().forEach((cb) => cb(st)); },
    _p: p,
  };
};

const build = (over = {}) => {
  const log = { players: [], events: [], states: [], device: [] };
  const fake = makeFakePlayer(log);
  const handles = [];
  const deps = {
    getAudio: async () => ['u1', 'u2', 'u3'],
    makePlayer: (uri) => { const h = fake(uri); handles.push(h); return h; },
    prepareAudio: async () => { log.events.push('audio-mode'); },
    deviceSpeak: (text, cb) => { log.device.push({ text, cb }); log.events.push('device-speak'); return () => { log.events.push('device-cancel'); }; },
    deviceStop: () => { log.events.push('device-stop'); },
    devicePause: () => { log.events.push('device-pause'); },
    deviceResume: () => { log.events.push('device-resume'); },
    deviceCanPause: false,
    stallMs: 15000,
    setTimer, clearTimer,
    ...over,
  };
  const ctl = V.createSummaryVoice(deps, (s) => log.states.push(s));
  return { ctl, log, handles, deps };
};
const REQ = { clientId: 'c', which: 'weekly', script: 'One. Two. Three.' };
const last = (log) => log.states[log.states.length - 1];

(async () => {
  /* 1. three parts back to back, onDone once, player released */
  {
    const { ctl, log, handles } = build();
    let done = 0, err = 0;
    ctl.play('weekly', REQ, { onDone: () => done++, onError: () => err++ });
    eq('preparing first', { id: last(log).id, phase: last(log).phase }, { id: 'weekly', phase: 'preparing' });
    await tick(); await tick();
    eq('playing part 1 of 3', { phase: last(log).phase, source: last(log).source, part: last(log).part, parts: last(log).parts }, { phase: 'playing', source: 'sarvam', part: 1, parts: 3 });
    const h = handles[0];
    eq('one player, played once', { n: handles.length, played: h._p.played }, { n: 1, played: 1 });
    // a status before playing: a stray didJustFinish must not advance
    h._status({ isLoaded: true, playing: false, didJustFinish: true });
    eq('finish before playing ignored', last(log).part, 1);
    h._status({ isLoaded: true, playing: true, didJustFinish: false });
    h._status({ isLoaded: true, playing: false, didJustFinish: true });
    eq('advanced to part 2', { part: last(log).part, uri: h._p.uri }, { part: 2, uri: 'u2' });
    // the same end status repeated while u2 loads must not skip u3
    h._status({ isLoaded: true, playing: false, didJustFinish: true });
    eq('repeat finish ignored', { part: last(log).part, uri: h._p.uri }, { part: 2, uri: 'u2' });
    h._status({ playing: true }); h._status({ playing: false, didJustFinish: true });
    eq('advanced to part 3', { part: last(log).part, uri: h._p.uri }, { part: 3, uri: 'u3' });
    h._status({ playing: true }); h._status({ playing: false, didJustFinish: true });
    eq('done once, idle, released', { done, err, phase: last(log).phase, removed: h._p.removed }, { done: 1, err: 0, phase: 'idle', removed: true });
    eq('no device voice used', log.device.length, 0);
    eq('no live timers left', fireTimers(), 0);
  }

  /* 2. cloud failure -> device voice with the notice; device onDone -> onDone */
  {
    const { ctl, log } = build({ getAudio: async () => { throw new Error('Sarvam 500'); } });
    let done = 0;
    ctl.play('context', { ...REQ, which: 'context' }, { onDone: () => done++ });
    await tick(); await tick();
    eq('device fallback after cloud failure', { phase: last(log).phase, source: last(log).source, notice: last(log).notice }, { phase: 'playing', source: 'device', notice: "Cloud voice unavailable (Sarvam 500); using this device's voice." });
    eq('device got the script', log.device[0].text, REQ.script);
    log.device[0].cb.onDone();
    eq('device done -> onDone, notice kept', { done, phase: last(log).phase, notice: last(log).notice }, { done: 1, phase: 'idle', notice: "Cloud voice unavailable (Sarvam 500); using this device's voice." });
  }

  /* 3. empty url list counts as a cloud failure */
  {
    const { ctl, log } = build({ getAudio: async () => [] });
    ctl.play('weekly', REQ);
    await tick(); await tick();
    eq('no urls -> device', { source: last(log).source, notice: last(log).notice }, { source: 'device', notice: "Cloud voice unavailable (No recording came back); using this device's voice." });
  }

  /* 4. player error status -> device voice; player released */
  {
    const { ctl, log, handles } = build();
    ctl.play('weekly', REQ);
    await tick(); await tick();
    handles[0]._status({ error: 'decode failed' });
    eq('player error -> device', { source: last(log).source, notice: last(log).notice, removed: handles[0]._p.removed }, { source: 'device', notice: "The recording could not play (decode failed); using this device's voice.", removed: true });
    // later statuses from the dead player are ignored
    handles[0]._status({ playing: true }); handles[0]._status({ playing: false, didJustFinish: true });
    eq('dead player statuses ignored', last(log).source, 'device');
  }

  /* 5. stall (never plays) -> device voice; a playing status disarms the stall */
  {
    const { ctl, log, handles } = build();
    ctl.play('weekly', REQ);
    await tick(); await tick();
    eq('stall fires -> device', (fireTimers(), last(log).source), 'device');
    eq('device spoke once', log.device.length, 1);
  }
  {
    const { ctl, log, handles } = build();
    ctl.play('weekly', REQ);
    await tick(); await tick();
    handles[0]._status({ playing: true });
    eq('playing disarms the stall', (fireTimers(), last(log).source), 'sarvam');
  }

  /* 6. stop mid-way: no onDone, player released, device stopped, idle */
  {
    const { ctl, log, handles } = build();
    let done = 0;
    ctl.play('weekly', REQ, { onDone: () => done++ });
    await tick(); await tick();
    handles[0]._status({ playing: true });
    ctl.stop();
    eq('stop -> idle, released', { phase: last(log).phase, removed: handles[0]._p.removed, stopped: log.events.filter((e) => e === 'device-stop').length > 0 }, { phase: 'idle', removed: true, stopped: false });
    handles[0]._status({ playing: false, didJustFinish: true });
    eq('late finish after stop ignored', done, 0);
  }

  /* 7. pause / resume on the recording (both platforms); device voice cannot pause on Android */
  {
    const { ctl, log, handles } = build();
    ctl.play('weekly', REQ);
    await tick(); await tick();
    eq('canPause on sarvam', ctl.canPause(), true);
    ctl.pause();
    eq('paused', { phase: last(log).phase, paused: handles[0]._p.paused }, { phase: 'paused', paused: 1 });
    ctl.resume();
    eq('resumed', { phase: last(log).phase, played: handles[0]._p.played }, { phase: 'playing', played: 2 });
  }
  {
    const { ctl, log } = build({ getAudio: async () => { throw new Error('offline'); } });
    ctl.play('weekly', REQ);
    await tick(); await tick();
    eq('device voice on android cannot pause', ctl.canPause(), false);
    ctl.pause();
    eq('pause ignored on device/android', last(log).phase, 'playing');
  }
  {
    const { ctl, log } = build({ getAudio: async () => { throw new Error('offline'); }, deviceCanPause: true });
    ctl.play('weekly', REQ);
    await tick(); await tick();
    eq('device voice on ios can pause', ctl.canPause(), true);
    ctl.pause();
    eq('device paused', { phase: last(log).phase, ev: log.events.includes('device-pause') }, { phase: 'paused', ev: true });
    ctl.resume();
    eq('device resumed', last(log).phase, 'playing');
  }

  /* 8. a second play while the first is still being fetched: the first result is dropped */
  {
    let resolveFirst;
    let calls = 0;
    const { ctl, log, handles } = build({ getAudio: () => { calls++; return calls === 1 ? new Promise((r) => { resolveFirst = r; }) : Promise.resolve(['x1']); } });
    let doneFirst = 0;
    ctl.play('weekly', REQ, { onDone: () => doneFirst++ });
    ctl.play('context', { ...REQ, which: 'context' });
    await tick(); await tick();
    eq('second play is the one playing', { id: last(log).id, players: handles.length, uri: handles[0]._p.uri }, { id: 'context', players: 1, uri: 'x1' });
    resolveFirst(['u1']);
    await tick(); await tick();
    eq('first result dropped', { id: last(log).id, players: handles.length }, { id: 'context', players: 1 });
  }

  /* 9. both voices fail -> onError with the device message, idle */
  {
    const { ctl, log } = build({ getAudio: async () => { throw new Error('offline'); } });
    let errMsg = null, done = 0;
    ctl.play('weekly', REQ, { onDone: () => done++, onError: (m) => { errMsg = m; } });
    await tick(); await tick();
    log.device[0].cb.onError('no TTS engine');
    eq('both failed -> onError', { errMsg, done, phase: last(log).phase }, { errMsg: 'no TTS engine', done: 0, phase: 'idle' });
  }

  /* 10. play after a finished run starts fresh (notice cleared) */
  {
    const { ctl, log } = build({ getAudio: async () => { throw new Error('x'); } });
    ctl.play('weekly', REQ);
    await tick(); await tick();
    log.device[0].cb.onDone();
    eq('notice kept after done', !!last(log).notice, true);
    ctl.play('weekly', REQ);
    eq('notice cleared on next play', { phase: last(log).phase, notice: last(log).notice }, { phase: 'preparing', notice: null });
  }

  /* 11. one voice at a time ACROSS controllers (two cards / strips): the second play silences the first;
         the released player is paused before it is removed */
  {
    const A = build(), B = build();
    let doneA = 0;
    A.ctl.play('weekly', REQ, { onDone: () => doneA++ });
    await tick(); await tick();
    A.handles[0]._status({ playing: true });
    B.ctl.play('context', { ...REQ, which: 'context' });
    eq('first controller silenced by the second play', { phase: last(A.log).phase, paused: A.handles[0]._p.paused, removed: A.handles[0]._p.removed, deviceStopped: A.log.events.includes('device-stop') }, { phase: 'idle', paused: 1, removed: true, deviceStopped: false });
    await tick(); await tick();
    eq('second controller plays', { phase: last(B.log).phase, source: last(B.log).source }, { phase: 'playing', source: 'sarvam' });
    A.handles[0]._status({ playing: false, didJustFinish: true });
    eq('late finish of the silenced run ignored', doneA, 0);
    // a device-voice fallback in A is silenced by B too
    const Cc = build({ getAudio: async () => { throw new Error('offline'); } });
    Cc.ctl.play('weekly', REQ);
    await tick(); await tick();
    eq('B silenced by C', { phase: last(B.log).phase, removed: B.handles[0]._p.removed }, { phase: 'idle', removed: true });
    eq('C speaks on the device', last(Cc.log).source, 'device');
    B.ctl.play('weekly', REQ);
    eq('C (device voice) silenced by B', { phase: last(Cc.log).phase, stopped: Cc.log.events.filter((e) => e === 'device-stop').length >= 1, cancelled: Cc.log.events.includes('device-cancel') }, { phase: 'idle', stopped: true, cancelled: true });
    await tick(); await tick();
    B.ctl.stop();
    // after a run ends by itself its controller is no longer silenced by others
    const D = build();
    D.ctl.play('weekly', REQ);
    await tick(); await tick();
    D.handles[0]._status({ playing: true }); D.handles[0]._status({ playing: false, didJustFinish: true });
    D.handles[0]._status({ playing: true }); D.handles[0]._status({ playing: false, didJustFinish: true });
    D.handles[0]._status({ playing: true }); D.handles[0]._status({ playing: false, didJustFinish: true });
    eq('D finished on its own', last(D.log).phase, 'idle');
    const statesBefore = D.log.states.length;
    const E = build();
    E.ctl.play('weekly', REQ);
    eq('a finished controller is not re-stopped', D.log.states.length, statesBefore);
    E.ctl.stop();
  }

  /* 12. shared audio focus with players outside the summaries (voice memos, voice notes, Nucleus) */
  {
    let memoPaused = 0;
    const memo = { silence: () => { memoPaused++; } };
    focus.claimAudioFocus(memo);
    const S = build();
    S.ctl.play('weekly', REQ);
    eq('a summary play pauses a voice memo that was playing', memoPaused, 1);
    await tick(); await tick();
    S.handles[0]._status({ playing: true });
    focus.claimAudioFocus(memo);
    eq('a voice memo play stops the summary', { phase: last(S.log).phase, paused: S.handles[0]._p.paused, removed: S.handles[0]._p.removed }, { phase: 'idle', paused: 1, removed: true });
    eq('the memo holds the focus after it claimed', focus.holdsAudioFocus(memo), true);
    focus.releaseAudioFocus(memo);
    eq('released focus is empty', focus.holdsAudioFocus(memo), false);
    // claiming twice by the same holder never silences itself
    let selfSilenced = 0;
    const one = { silence: () => { selfSilenced++; } };
    focus.claimAudioFocus(one); focus.claimAudioFocus(one);
    eq('same holder claiming again is not silenced', selfSilenced, 0);
    focus.releaseAudioFocus(one);
  }

  /* 13. the device voice stopped from outside: the controller goes idle, not stuck on "playing", no onDone */
  {
    const { ctl, log } = build({ getAudio: async () => { throw new Error('offline'); } });
    let done = 0;
    ctl.play('weekly', REQ, { onDone: () => done++ });
    await tick(); await tick();
    log.device[0].cb.onStopped();
    eq('outside stop -> idle, no onDone', { phase: last(log).phase, done }, { phase: 'idle', done: 0 });
  }

  /* 14. stop() of an idle controller (a strip mounting folded) never stops the shared device engine */
  {
    const { ctl, log } = build();
    ctl.stop();
    eq('idle stop leaves the device engine alone', log.events.includes('device-stop'), false);
  }

  /* 15. resume takes the focus back */
  {
    const { ctl, log, handles } = build();
    ctl.play('weekly', REQ);
    await tick(); await tick();
    handles[0]._status({ playing: true });
    ctl.pause();
    let otherSilenced = 0;
    const other = { silence: () => { otherSilenced++; } };
    focus.claimAudioFocus(other);
    // the paused summary was silenced by the other player (stopped, idle)
    eq('paused summary is stopped when another player claims', last(log).phase, 'idle');
    focus.releaseAudioFocus(other);
    void otherSilenced;
  }

  /* 16. message helpers */
  eq('CLOUD_UNAVAILABLE text', V.CLOUD_UNAVAILABLE('x'), "Cloud voice unavailable (x); using this device's voice.");
  eq('STALL_MS', V.STALL_MS, 15000);
  eq('SPEAK_FN_MS', V.SPEAK_FN_MS, 45000);

  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
