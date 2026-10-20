// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/qhp_turns_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of the turn-by-turn half of src/lib/qhpNavigation.ts (manoeuvre kinds, street parsing,
// banner distances, next manoeuvre along the live Google sample, voice cue sequence).
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/qhpNavigation.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, require);
const N = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };

// manoeuvre kinds (Google enum + the OSRM-mapped names)
eq('kind TURN_LEFT', N.maneuverKind('TURN_LEFT'), 'left');
eq('kind TURN_SLIGHT_RIGHT', N.maneuverKind('TURN_SLIGHT_RIGHT'), 'slight-right');
eq('kind TURN_SHARP_LEFT', N.maneuverKind('TURN_SHARP_LEFT'), 'sharp-left');
eq('kind UTURN_RIGHT', N.maneuverKind('UTURN_RIGHT'), 'uturn-right');
eq('kind ROUNDABOUT_LEFT', N.maneuverKind('ROUNDABOUT_LEFT'), 'roundabout-left');
eq('kind RAMP_RIGHT', N.maneuverKind('RAMP_RIGHT'), 'ramp-right');
eq('kind FORK_LEFT', N.maneuverKind('FORK_LEFT'), 'fork-left');
eq('kind MERGE', N.maneuverKind('MERGE'), 'merge');
eq('kind DEPART', N.maneuverKind('DEPART'), 'depart');
eq('kind unknown -> straight', N.maneuverKind('MANEUVER_UNSPECIFIED'), 'straight');
eq('kind null -> straight', N.maneuverKind(null), 'straight');

// street parsing, incl. Google's two-line instructions
eq('street onto', N.streetOf('Turn left onto Sri Aurobindo Marg\nPass by the church (on the left in 350m)'), 'Sri Aurobindo Marg');
eq('street to stay on', N.streetOf('Keep left to stay on Sri Aurobindo Marg\nPass by YES BANK (on the left)'), 'Sri Aurobindo Marg');
eq('street toward', N.streetOf('Turn right toward Shiva Rd\nRestricted usage road'), 'Shiva Rd');
eq('street roundabout exit', N.streetOf('At the roundabout, take the 2nd exit onto Teen Murti Marg'), 'Teen Murti Marg');
eq('street none', N.streetOf('Turn left'), null);
eq('street head east none', N.streetOf('Head east\nRestricted usage road'), null);
eq('title first line', N.instructionTitle('Head east\nRestricted usage road'), 'Head east');
eq('note second line', N.instructionNote('Turn left onto X\nPass by the church (on the left in 350m)'), 'Pass by the church (on the left in 350m)');
eq('note none', N.instructionNote('Turn left onto X'), null);

// banner distances
eq('fmt 7 m -> 10 m', N.fmtStepDistance(7), '10 m');
eq('fmt 48 m -> 50 m', N.fmtStepDistance(48), '50 m');
eq('fmt 132 m -> 150 m', N.fmtStepDistance(132), '150 m');
eq('fmt 412 m -> 400 m', N.fmtStepDistance(412), '400 m');
eq('fmt 980 m -> 1000 m', N.fmtStepDistance(980), '1000 m');
eq('fmt 1230 m -> 1.2 km', N.fmtStepDistance(1230), '1.2 km');
eq('fmt 2000 m -> 2 km', N.fmtStepDistance(2000), '2 km');
eq('fmt 14600 m -> 15 km', N.fmtStepDistance(14600), '15 km');
eq('spoken 400', N.spokenDistance(412), 'In 400 metres');
eq('spoken 1.2 km', N.spokenDistance(1230), 'In 1.2 kilometres');

// next manoeuvre along the live sample (steps from the deployed function, 14 Oct 2026)
const sample = JSON.parse(fs.readFileSync(__dirname + '/nav-route-sample.json', 'utf8'));
const steps = sample.steps;
const totalM = sample.distanceKm * 1000;
eq('sample has steps', steps.length > 5, true);
const at0 = N.nextManeuver(0, steps, totalM);
eq('at start: first manoeuvre is step 1 (TURN_RIGHT) 137 m ahead', [at0.index, at0.kind, at0.distanceM], [1, 'right', 137]);
eq('at start: then-chip (step 2 within 92 m)', at0.then && at0.then.kind, 'right');
eq('at start: then street Shiva Rd', at0.then && at0.then.street, 'Shiva Rd');
const at200 = N.nextManeuver(200, steps, totalM);
eq('at 200 m: step 2 turn right onto Shiva Rd, 29 m', [at200.index, at200.street, at200.distanceM], [2, 'Shiva Rd', 29]);
const at240 = N.nextManeuver(240, steps, totalM); // 11 m past step 2's start: still inside the 15 m tolerance
eq('at 240 m: step 2 still counts (tolerance)', at240.index, 2);
const at260 = N.nextManeuver(260, steps, totalM);
eq('at 260 m: step 3 turn left onto Sri Aurobindo Marg', [at260.index, at260.kind, at260.street], [3, 'left', 'Sri Aurobindo Marg']);
eq('at 260 m: note is the landmark line', at260.note, 'Pass by the church (on the left in 350m)');
const atEnd = N.nextManeuver(totalM - 30, steps, totalM);
eq('near the end: arrive', [atEnd.kind, atEnd.distanceM <= 60], ['arrive', true]);
eq('no steps -> null', N.nextManeuver(100, [], 5000), null);

eq('prep onto', N.prepOf('Turn left onto Sri Aurobindo Marg\nPass by'), 'onto');
eq('prep toward', N.prepOf('Turn right toward Shiva Rd'), 'toward');
eq('prep to stay on', N.prepOf('Keep left to stay on Sri Aurobindo Marg'), 'to stay on');
eq('at start: step 1 prep toward, then (step 2) prep onto', [at0.prep, at0.then && at0.then.prep], ['toward', 'onto']);
eq('at 200 m: step 2 prep onto', at200.prep, 'onto');

// voice cue sequence for one manoeuvre: far once, near once, nothing else
const spoken = new Set();
const mv = (d) => ({ index: 3, kind: 'left', instruction: 'Turn left onto Sri Aurobindo Marg', note: null, street: 'Sri Aurobindo Marg', prep: 'onto', distanceM: d, then: null });
eq('cue at 600 m: none', N.voiceCue(mv(600), spoken), null);
const far = N.voiceCue(mv(390), spoken); spoken.add(far.id);
eq('cue at 390 m: far', far.text, 'In 400 metres, turn left onto Sri Aurobindo Marg.');
eq('cue at 300 m: already said', N.voiceCue(mv(300), spoken), null);
const near = N.voiceCue(mv(60), spoken); spoken.add(near.id);
eq('cue at 60 m: near', near.text, 'Turn left onto Sri Aurobindo Marg.');
eq('cue at 20 m: already said', N.voiceCue(mv(20), spoken), null);
const withThen = N.voiceCue({ ...mv(50), index: 9, then: { kind: 'left', street: 'Safdarjung Rd', prep: 'onto', gapM: 246 } }, spoken);
eq('near cue with then', withThen.text, 'Turn left onto Sri Aurobindo Marg, then turn left onto Safdarjung Road.');
const toward = N.voiceCue({ ...mv(300), index: 1, kind: 'right', street: 'Shiva Rd', prep: 'toward' }, new Set());
eq('far cue keeps toward', toward.text, 'In 300 metres, turn right toward Shiva Road.');
const stay = N.voiceCue({ ...mv(60), index: 4, kind: 'slight-left', street: 'Sri Aurobindo Marg', prep: 'to stay on' }, new Set());
eq('near cue keeps to stay on', stay.text, 'Keep left to stay on Sri Aurobindo Marg.');
const arr = N.voiceCue({ index: 20, kind: 'arrive', instruction: '', note: null, street: null, prep: 'on', distanceM: 50, then: null }, new Set());
eq('arrival cue id is fixed', arr.id, N.ARRIVE_CUE);
eq('arrival cue text', arr.text, 'You have arrived at your destination.');
eq('phrase expands Rd', N.maneuverPhrase('right', 'Shiva Rd'), 'turn right onto Shiva Road');
eq('phrase roundabout', N.maneuverPhrase('roundabout-left', 'Teen Murti Marg'), 'take the roundabout onto Teen Murti Marg');

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
