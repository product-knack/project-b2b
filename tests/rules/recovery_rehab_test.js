// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/recovery_rehab_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Recovery and rehab entries on the QHP (11 Nov 2026): same-JSON storage, the text older readers use, carry
// forward to the next QHP, progress per area, and what the trainer reads. src/lib/recoveryRehab.ts is a byte for
// byte copy of the web file (hub-track src/lib/recoveryRehab.ts); these are the web's offline checks.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/recoveryRehab.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, require);
const P = m.exports;
const {
  carryRehabForward, cleanIntensity, emptyRehabEntry, extractRecoveryRehab, extractTrainerRecommendations, painNotesFromMedical, painTextProjection, qhpGuidanceCountLine, qhpGuidanceOf, recoveryRehabFromJson, recoveryRehabJson, rehabAreaLabel, rehabProgress, rehabReferralText, rehabSummaryLine,
} = P;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const e = (over) => ({ ...emptyRehabEntry(), ...over });
const knee = e({ id: "k1", area: "Knee", side: "right", intensity: 6, type: "chronic_condition", status: "active", recommendation: "No deep squats. Quad sets daily.", referral: "physio", referralNote: "Dr Mehta" });
const back = e({ id: "b1", area: "Lower back", side: "", intensity: 3, type: "acute_injury", status: "improving", recommendation: "", referral: "none" });
const oldShoulder = e({ id: "s1", area: "Shoulder", side: "left", intensity: 0, type: "post_surgery", status: "resolved" });
// ---- cleaning and JSON round trip
eq("intensity is clamped to 0..10, blanks are null", [cleanIntensity("7"), cleanIntensity(14), cleanIntensity(-2), cleanIntensity(""), cleanIntensity("x"), cleanIntensity(3.6)], [7, 10, 0, null, null, 4]);
eq("entries without an area are not saved", recoveryRehabJson([knee, e({ area: "  " })]).map((x) => x.id), ["k1"]);
const json = JSON.parse(JSON.stringify(recoveryRehabJson([knee, back, oldShoulder])));
eq("JSON round trip keeps every field", recoveryRehabFromJson(json), [knee, back, oldShoulder]);
eq("junk is dropped, bad enums blanked, duplicate ids renamed", recoveryRehabFromJson([null, "x", { id: "a", area: "Hip", side: "up", type: "weird", status: "gone", referral: "x", intensity: "11" }, { id: "a", area: "Ankle or foot" }]).map((x) => [x.area, x.side, x.type, x.status, x.referral, x.intensity, x.id === "a"]), [["Hip", "", "", "", "", 10, true], ["Ankle or foot", "", "", "", "", null, false]]);
eq("not an array reads as none", recoveryRehabFromJson({ nope: 1 }), []);
// ---- labels
eq("area labels", [rehabAreaLabel(knee), rehabAreaLabel(back), rehabAreaLabel(e({ area: "Shoulder", side: "both" }))], ["Right knee", "Lower back", "Shoulder (both sides)"]);
eq("referral text", [rehabReferralText(knee), rehabReferralText(back), rehabReferralText(e({ referral: "other", referralNote: "Podiatrist" })), rehabReferralText(e({}))], ["Physiotherapist: Dr Mehta", "No referral", "Podiatrist", ""]);
eq("summary line", rehabSummaryLine(knee), "Right knee: pain 6/10, chronic condition, active. Recommendation: No deep squats. Quad sets daily. Referral: Physiotherapist: Dr Mehta");
// ---- the text every older reader and two scores use
eq("no entries: the free text exactly as before", painTextProjection("  right knee pain during the squat ", []), "right knee pain during the squat");
eq("no entries, no text: empty", painTextProjection("", []), "");
eq("entries: one name per open area, resolved left out", painTextProjection("", [knee, back, oldShoulder]), "Right knee, Lower back");
eq("entries plus notes", painTextProjection("pain during the squat", [knee]), "Right knee. pain during the squat");
eq("a comma inside an area name cannot make two sites", painTextProjection("", [e({ area: "Hip, groin", status: "active" })]), "Hip groin");
// the senior score's site count: pain.split(/[,;/]|\band\b/i)
const sites = (t) => t.split(/[,;/]|\band\b/i).map((x) => x.trim()).filter(Boolean).length;
eq("senior score site count = number of open areas", [sites(painTextProjection("", [knee])), sites(painTextProjection("", [knee, back])), sites(painTextProjection("", [oldShoulder]))], [1, 2, 0]);
// the QHP score's screen-pain test still sees the notes
eq("QHP score regex still matches the notes", /pain (on|during|with) (the )?(squat|screen|aslr|apley|reach|test)/.test(painTextProjection("pain during the squat", [knee]).toLowerCase()), true);
// ---- notes box on reopen
eq("a QHP saved with the feature: notes come from painDiscomfortNotes", painNotesFromMedical({ painDiscomfortNotes: "tight in the morning", painDiscomfortAreas: "Right knee. tight in the morning" }), "tight in the morning");
eq("an empty notes key stays empty (the projection is not copied in)", painNotesFromMedical({ painDiscomfortNotes: "", painDiscomfortAreas: "Right knee" }), "");
eq("an older QHP: the old free text", painNotesFromMedical({ painDiscomfortAreas: "right knee pain" }), "right knee pain");
eq("nothing saved", painNotesFromMedical(null), "");
// ---- carry forward and progress
const carried = carryRehabForward([knee, back, oldShoulder], { assessmentId: "qhp-1", day: "2026-09-13" });
eq("carry forward: open entries only, same ids, snapshot of last time", carried.map((x) => [x.id, x.previous]), [
    ["k1", { intensity: 6, status: "active", day: "2026-09-13", assessmentId: "qhp-1" }],
    ["b1", { intensity: 3, status: "improving", day: "2026-09-13", assessmentId: "qhp-1" }],
]);
eq("a new entry", rehabProgress(knee), { trend: "new", painChange: "", statusChange: "", line: "New at this QHP." });
eq("better: pain down and status up", rehabProgress({ ...carried[0], intensity: 3, status: "improving" }), { trend: "better", painChange: "6 to 3", statusChange: "active to improving", line: "Better since 13 Sep: pain 6 to 3, active to improving." });
eq("worse: pain up", rehabProgress({ ...carried[1], intensity: 5, status: "active" }).line, "Worse since 13 Sep: pain 3 to 5, improving to active.");
eq("no change", rehabProgress({ ...carried[0] }).line, "No change since 13 Sep: pain still 6.");
eq("resolved", rehabProgress({ ...carried[0], intensity: 0, status: "resolved" }).line, "Resolved since 13 Sep: pain 6 to 0, active to resolved.");
eq("same pain, status up counts as better", rehabProgress({ ...carried[0], status: "improving" }).trend, "better");
// a second carry keeps the id and takes the newer snapshot
const again = carryRehabForward([{ ...carried[0], intensity: 3, status: "improving" }], { assessmentId: "qhp-2", day: "2026-11-11" });
eq("carried twice: id kept, snapshot is the newer QHP", [again[0].id, again[0].previous], ["k1", { intensity: 3, status: "improving", day: "2026-11-11", assessmentId: "qhp-2" }]);
// ---- reading a saved QHP in its real shapes
const data = { "Standardized Assessment": { medicalHistory: { recoveryRehab: json, painDiscomfortAreas: "Right knee, Lower back" }, trainerRecommendations: [" Warm up the right knee ", "", "Avoid loaded flexion"] } };
eq("from the data column value", extractRecoveryRehab(data).map((x) => x.id), ["k1", "b1", "s1"]);
eq("from a row, standard goal column", extractRecoveryRehab({ new_client_assessment_data: data, qhp_data: null }).length, 3);
eq("from a row, special goal column", extractRecoveryRehab({ qhp_data: data, new_client_assessment_data: null }).length, 3);
eq("doctor re-assessment shape", extractRecoveryRehab({ existing_client_assessment_data: { "Existing Client Re-Assessment": { medicalHistory: { recoveryRehab: [knee] } } } }).map((x) => x.id), ["k1"]);
eq("a QHP without the feature", [extractRecoveryRehab({ new_client_assessment_data: { "Standardized Assessment": { medicalHistory: { painDiscomfortAreas: "knee" } } } }), extractRecoveryRehab(null)], [[], []]);
eq("trainer recommendations, trimmed", extractTrainerRecommendations({ new_client_assessment_data: data }), ["Warm up the right knee", "Avoid loaded flexion"]);
eq("No recommendation (null) reads as none", extractTrainerRecommendations({ new_client_assessment_data: { "Standardized Assessment": { trainerRecommendations: null } } }), []);
// ---- what the trainer reads
const g = qhpGuidanceOf({ new_client_assessment_data: data });
eq("guidance: open entries for programming, resolved apart", [g.hasContent, g.rehab.map((x) => x.id), g.resolved.map((x) => x.id), g.recommendations.length], [true, ["k1", "b1"], ["s1"], 2]);
eq("push line", [qhpGuidanceCountLine(g), qhpGuidanceCountLine({ recommendations: ["a"], rehab: [] }), qhpGuidanceCountLine({ recommendations: [], rehab: [knee] }), qhpGuidanceCountLine({ recommendations: [], rehab: [] })], ["2 recommendations and 2 recovery notes to read", "1 recommendation to read", "1 recovery note to read", ""]);
eq("only a resolved entry: nothing to read", qhpGuidanceOf({ "Standardized Assessment": { medicalHistory: { recoveryRehab: [oldShoulder] } } }).hasContent, false);

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
