# iOS handoff: Prescription PDF schedule, Weekly and Monthly no longer print as DAILY (Android since 30 Oct 2026)

Since 30 Oct 2026 the doctor's prescription panel on the web can store three new frequencies, **Weekly**, **Monthly**
and **Alternate days** (a weekly Mounjaro injection, a monthly vitamin D). The app's prescription PDF printed **DAILY**
in its SCHEDULE column for every frequency it did not know, so a weekly injection read DAILY on the sheet the consultant
shares with the client. Android fixed it in commit 75f43e2 (30 Oct 2026): only the daily codes print DAILY, the three new
ones print their own word, and the popup and the built instruction sentence word them too ("Once a week").
The Android commit 0ea1aac ("versionCode 44: My Crew row layout and names, prescription schedule wording") only changed
`app.json`; the wording itself is in 75f43e2, and no other Android commit up to 2 Nov 2026 touches the prescription code.
`app.json` now reads version 5.2, versionCode 43 (the owner set it back from 44 the same day).

One pure file changes in three spots (`src/lib/prescriptionSheet.ts`) and one rule test is new. No screen code changes,
no new package. Server: none (no SQL, no RPC change).

## 1. What the user sees (Android)

**Who and where.** The consultant doctor (`profiles.role = 'doctor'` with "consultant" in the specialization tag; on
live data Dr. Wasir). Drawer **All Calls** (or the bottom pill **All calls**) → a call row's **Prescription** button →
the record popup → **Download PDF** (shown when the call has any prescription content). `sharePrescriptionPdf` renders
the dark Odds Longevity A4 sheet with **expo-print**, renames it `Prescription_<client>_<yyyy-MM-dd>.pdf` and opens the
share sheet (**expo-sharing**). The sheet's table is headed "Medication Schedule" with the columns
`S.NO / MEDICINE / SCHEDULE / INSTRUCTIONS`.

The same popup's Prescription tab (`PrescriptionView`) shows each medicine with DOSE / FREQUENCY / TIMING / DURATION
pills; its FREQUENCY pill uses the same wording. The CRM's Doctor Consultation record popup renders the same
`PrescriptionView`, so a CRM sees the new pill wording too (the CRM has no Download PDF in the app; unchanged).
Physio and nutrition doctors never see any of this.

**Per frequency** (the stored value is `prescription.medicines[].frequency`; the popup pill is drawn as
`<value> · <hint in lower case>`; INSTRUCTIONS here is the sentence built when the doctor wrote no instruction, dose 1,
timing "Any time", no duration):

| Stored frequency | SCHEDULE before | SCHEDULE after | Popup FREQUENCY before | Popup FREQUENCY after | INSTRUCTIONS before | INSTRUCTIONS after |
|---|---|---|---|---|---|---|
| `OD` | DAILY | DAILY | Once daily · morning | Once daily · morning | Once a day | Once a day |
| `BD` | DAILY | DAILY | Twice daily · morning and night | Twice daily · morning and night | Two times a day | Two times a day |
| `TDS` | DAILY | DAILY | Three times daily · morning, afternoon and night | (same) | Three times a day | Three times a day |
| `QID` | DAILY | DAILY | Four times daily · morning, noon, evening and night | (same) | Four times a day | Four times a day |
| `HS` | NIGHTLY | NIGHTLY | At bedtime | At bedtime | At bedtime | At bedtime |
| `SOS` | AS NEEDED | AS NEEDED | When needed | When needed | When needed | When needed |
| `Weekly` | **DAILY** | **WEEKLY** | Weekly | **Once a week** | Weekly | **Once a week** |
| `Monthly` | **DAILY** | **MONTHLY** | Monthly | **Once a month** | Monthly | **Once a month** |
| `Alternate days` | **DAILY** | **ALTERNATE DAYS** | Alternate days | **On alternate days** | Alternate days | **On alternate days** |
| any other word, e.g. `Every 3 days` | **DAILY** | **EVERY 3 DAYS** | Every 3 days | Every 3 days | Every 3 days | Every 3 days |
| empty | (blank) | (blank) | (no pill) | (no pill) | (blank) | (blank) |

The new three have no morning / night hint (`scheduleWords` returns '' for them, as before). An `OD` line whose timing
mentions bed or night keeps its hint "at night".

**INSTRUCTIONS column, full sentences** (no instruction written; output of the Android code before and after 75f43e2):

| Line | Before | After |
|---|---|---|
| Weekly, Any time, 3 weeks | Weekly for 3 weeks | Once a week for 3 weeks |
| Weekly, Any time, 3 weeks, dose 2 | 2 each, weekly for 3 weeks | 2 each, once a week for 3 weeks |
| Monthly, After food, 3 months | Monthly after food for 3 months | Once a month after food for 3 months |
| Alternate days, Empty stomach, 10 days | Alternate days on an empty stomach for 10 days | On alternate days on an empty stomach for 10 days |
| BD, After food, 5 days | Two times a day after food for 5 days | Two times a day after food for 5 days |
| Weekly, instruction "Subcutaneous injection", 3 weeks | Subcutaneous injection | Subcutaneous injection |

The last row is unchanged on purpose: the doctor's own instruction still wins and the app does not add the duration
to it (the web does since 30 Oct; see 2.2).

**One sheet row, before and after** (a weekly injection with the instruction written):
```
S.NO  MEDICINE         SCHEDULE   INSTRUCTIONS
1     Mounjaro         DAILY      Subcutaneous injection      (before)
      10 mg
1     Mounjaro         WEEKLY     Subcutaneous injection      (after)
      10 mg
```

**UI strings that did not change** (for reference): "Download PDF", "Medication Schedule", "SCHEDULE", "INSTRUCTIONS",
"No medicines prescribed.", the error alert title "Couldn't build the prescription PDF" with the fallback "Try again.",
and every label in the prescription editor.

## 2. Data / server contract

### 2.1 The field
- `doctor_consultation_details.prescription` (jsonb) → `medicines[]` → `frequency` (text). Unchanged shape.
- Values: `OD`, `BD`, `TDS`, `QID`, `HS`, `SOS` (app editor and web), and since 30 Oct 2026 the web panel also stores
  `Weekly`, `Monthly`, `Alternate days` as those exact words (hub-track `src/components/doctor/PrescriptionPanel.tsx`:
  `const FREQUENCIES = ["OD", "BD", "TDS", "QID", "HS", "Weekly", "Monthly", "Alternate days", "SOS"];`, commit
  8a2433ee8). The server (`amend_prescription`) does not check frequency, so no SQL was needed; `is_sos` stays false
  for the three.
- The rules match the stored words exactly (case and the space in "Alternate days"). Anything else falls to the default
  branch, which prints the stored word in capitals, so no spelling can ever read DAILY again.
- Read path unchanged: the record popup already holds `call.prescription`; nothing new is fetched.
- Web reference for the same wording: hub-track `src/components/doctor/prescriptionPdf.ts`, `FREQUENCY_TEXT`
  (`Weekly: "once a week"`, `Monthly: "once a month"`, `"Alternate days": "on alternate days"`). The web's newer sheet
  words its SCHEDULE column as sentences (`scheduleText`: "Once a week"); the app sheet keeps its capitals
  (WEEKLY). Do not copy the web column; match Android.

### 2.2 Not in this change (Android does not do these yet; keep iOS the same so both apps match)
1. The app's prescription editor (`src/screens/consultantCalls.tsx`, `const FREQUENCIES = ['OD', 'BD', 'TDS', 'QID', 'HS', 'SOS'];`)
   still cannot choose Weekly / Monthly / Alternate days. Opening Edit prescription on a weekly line shows no Frequency
   chip selected and the line summary reads `1 · Weekly · <timing> · <duration>`; saving without touching the chip
   keeps "Weekly".
2. The sheet's DATE is still `finalized_at || date` (the web switched to the consultation day plus an "Updated" line).
3. INSTRUCTIONS still prints the doctor's instruction alone when there is one (the web appends the duration:
   "Subcutaneous injection, for 3 weeks").
4. The therapist's Medications tab (`src/lib/medications.ts`, `rxDetail`) still prints the raw word ("1 dose Weekly").

## 3. Code to port

### 3.1 `src/lib/prescriptionSheet.ts` (three spots)

The file has no `react-native` import. It imports `expo-print`, `expo-sharing`, `expo-file-system` (`File`, `Paths`)
and `./consultantQueries` (`RxData`, `RxMedicineLine`, `istYmdOf`, `MONTHS_LONG`, `pad2`); the rule test stubs all of
them. The three changes:
1. `FREQUENCY_TEXT` (popup FREQUENCY pill, through `medicineFields`): adds `Weekly`, `Monthly`, `'Alternate days'`.
2. `scheduleLabel` (SCHEDULE column): only `OD` / `BD` / `TDS` / `QID` are DAILY; the three new words print WEEKLY,
   MONTHLY, ALTERNATE DAYS; the default prints the stored word in capitals instead of DAILY.
3. `instructionText` (INSTRUCTIONS column, no instruction written): the `times` map adds the three.

The exact Android diff (75f43e2):
```diff
diff --git a/src/lib/prescriptionSheet.ts b/src/lib/prescriptionSheet.ts
index 9ed6e4f..be1053d 100644
--- a/src/lib/prescriptionSheet.ts
+++ b/src/lib/prescriptionSheet.ts
@@ -32,7 +32,8 @@ export const LOGO_URL = 'https://passport.oddsfitness.com/lovable-uploads/5a7e1b
 /** Room for the body between the patient block (top 447) and the signature rule (999), less a gap. */
 const BODY_MAX_H = 538;
 
-export const FREQUENCY_TEXT: Record<string, string> = { OD: 'once daily', BD: 'twice daily', TDS: 'three times daily', QID: 'four times daily', HS: 'at bedtime', SOS: 'as needed' };
+// Weekly / Monthly / Alternate days (30 Oct 2026): the web panel stores them as these words; same wording as the web sheet.
+export const FREQUENCY_TEXT: Record<string, string> = { OD: 'once daily', BD: 'twice daily', TDS: 'three times daily', QID: 'four times daily', HS: 'at bedtime', SOS: 'as needed', Weekly: 'once a week', Monthly: 'once a month', 'Alternate days': 'on alternate days' };
 
 const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
 
@@ -63,18 +64,28 @@ export const medicineFields = (m: RxMedicineLine): MedicineField[] => {
   return fields.filter((f) => f.value !== '');
 };
 /** SCHEDULE column as the sample words it. */
+// 30 Oct 2026: only the daily codes are DAILY. Before, every other frequency fell to DAILY, so a weekly
+// Mounjaro injection or a monthly vitamin D printed as DAILY on the app's PDF. A frequency this list does not
+// know prints as its own words in capitals instead of a wrong DAILY.
 export const scheduleLabel = (m: RxMedicineLine): string => {
   switch (m.frequency) {
     case 'SOS': return 'AS NEEDED';
     case 'HS': return 'NIGHTLY';
-    default: return m.frequency ? 'DAILY' : '';
+    case 'OD':
+    case 'BD':
+    case 'TDS':
+    case 'QID': return 'DAILY';
+    case 'Weekly': return 'WEEKLY';
+    case 'Monthly': return 'MONTHLY';
+    case 'Alternate days': return 'ALTERNATE DAYS';
+    default: return (m.frequency || '').trim().toUpperCase();
   }
 };
 /** INSTRUCTIONS column: the doctor's own note, else one sentence from dose, frequency, timing and duration. */
 export const instructionText = (m: RxMedicineLine): string => {
   const own = (m.instruction || '').trim();
   if (own) return own;
-  const times: Record<string, string> = { OD: 'Once a day', BD: 'Two times a day', TDS: 'Three times a day', QID: 'Four times a day', HS: 'At bedtime', SOS: 'When needed' };
+  const times: Record<string, string> = { OD: 'Once a day', BD: 'Two times a day', TDS: 'Three times a day', QID: 'Four times a day', HS: 'At bedtime', SOS: 'When needed', Weekly: 'Once a week', Monthly: 'Once a month', 'Alternate days': 'On alternate days' };
   const timing = (m.timing || '').trim();
   const when = /any time/i.test(timing) ? '' : /empty/i.test(timing) ? 'on an empty stomach' : /early/i.test(timing) ? 'early in the morning' : timing.toLowerCase();
   const duration = m.duration_value != null && String(m.duration_value) !== '' ? `for ${m.duration_value} ${m.duration_unit}` : '';
```

The whole file as it is on Android now (HEAD, 2 Nov 2026; LF line endings, ASCII only). If your copy matches Android's
pre-30-Oct version everywhere else, replace it with this byte for byte. If your copy differs elsewhere (for example
other `expo-file-system` imports in `sharePrescriptionPdf`), keep your file and apply only the diff above.
```ts
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { RxData, RxMedicineLine, istYmdOf, MONTHS_LONG, pad2 } from './consultantQueries';

/* ============ Odds Longevity prescription sheet (native) ============
   Port of hub-track components/doctor/prescriptionPdf.ts: the same markup and
   the same measured CSS (A4 at 96 dpi, 794 x 1123 px, every position taken off
   the clinic's dark sample). The web rasterises the sheet with html2canvas into
   jsPDF; here expo-print renders the HTML straight to a PDF and expo-sharing
   hands the file on. Two knowing differences: the runner mark uses the CSS crop
   of the logo lockup (the web cuts it out on a canvas), and pagination is an
   estimate (no DOM to measure): the spacing tightens in the web's three steps
   and, when even the tightest does not fit one sheet, the body flows on to
   more pages instead of being clipped. */

const A4_W = 794;
const A4_H = 1123;
const SANS = "'Gill Sans MT', 'Gill Sans', 'Geogrotesque', Roboto, system-ui, sans-serif";
const PAGE_BG = '#080808';
const BAND = '#111828';
const SHAPE = '#152038';
const FRAME = '#3459a8';
const ORANGE = '#f68a21';
const RULE = '#1e3158';
const RULE_FAINT = '#10141f';
const INK = '#dde5f8';
const INK_SOFT = '#a8aebd';
const LABEL = '#7d818b';
/** The logo lockup the web ships; served by the passport domain (checked 22 Sep 2026). */
export const LOGO_URL = 'https://passport.oddsfitness.com/lovable-uploads/5a7e1bb8-4d58-454a-87e1-d784fec7d3f6.png';
/** Room for the body between the patient block (top 447) and the signature rule (999), less a gap. */
const BODY_MAX_H = 538;

// Weekly / Monthly / Alternate days (30 Oct 2026): the web panel stores them as these words; same wording as the web sheet.
export const FREQUENCY_TEXT: Record<string, string> = { OD: 'once daily', BD: 'twice daily', TDS: 'three times daily', QID: 'four times daily', HS: 'at bedtime', SOS: 'as needed', Weekly: 'once a week', Monthly: 'once a month', 'Alternate days': 'on alternate days' };

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** When in the day the doses fall, in plain words. */
export const scheduleWords = (m: RxMedicineLine): string => {
  const atNight = /bed|night/i.test(m.timing || '');
  switch (m.frequency) {
    case 'OD': return atNight ? 'At night' : 'Morning';
    case 'BD': return 'Morning and night';
    case 'TDS': return 'Morning, afternoon and night';
    case 'QID': return 'Morning, noon, evening and night';
    default: return '';
  }
};
export interface MedicineField { label: string; value: string; hint?: string }
/** Dose / Frequency / Timing / Duration, empty ones left out; shared by the popup and the sheet. */
export const medicineFields = (m: RxMedicineLine): MedicineField[] => {
  const freqRaw = FREQUENCY_TEXT[m.frequency] ?? (m.frequency || '').toLowerCase();
  const freq = freqRaw ? freqRaw[0].toUpperCase() + freqRaw.slice(1) : '';
  const when = scheduleWords(m);
  const timing = (m.timing || '').trim();
  const fields: MedicineField[] = [
    { label: 'Dose', value: (m.dose_amount || '').trim() },
    { label: 'Frequency', value: m.frequency === 'SOS' ? 'When needed' : freq, hint: when || undefined },
    { label: 'Timing', value: /any time/i.test(timing) ? '' : timing },
    { label: 'Duration', value: m.duration_value != null && String(m.duration_value) !== '' ? `${m.duration_value} ${m.duration_unit}` : '' },
  ];
  return fields.filter((f) => f.value !== '');
};
/** SCHEDULE column as the sample words it. */
// 30 Oct 2026: only the daily codes are DAILY. Before, every other frequency fell to DAILY, so a weekly
// Mounjaro injection or a monthly vitamin D printed as DAILY on the app's PDF. A frequency this list does not
// know prints as its own words in capitals instead of a wrong DAILY.
export const scheduleLabel = (m: RxMedicineLine): string => {
  switch (m.frequency) {
    case 'SOS': return 'AS NEEDED';
    case 'HS': return 'NIGHTLY';
    case 'OD':
    case 'BD':
    case 'TDS':
    case 'QID': return 'DAILY';
    case 'Weekly': return 'WEEKLY';
    case 'Monthly': return 'MONTHLY';
    case 'Alternate days': return 'ALTERNATE DAYS';
    default: return (m.frequency || '').trim().toUpperCase();
  }
};
/** INSTRUCTIONS column: the doctor's own note, else one sentence from dose, frequency, timing and duration. */
export const instructionText = (m: RxMedicineLine): string => {
  const own = (m.instruction || '').trim();
  if (own) return own;
  const times: Record<string, string> = { OD: 'Once a day', BD: 'Two times a day', TDS: 'Three times a day', QID: 'Four times a day', HS: 'At bedtime', SOS: 'When needed', Weekly: 'Once a week', Monthly: 'Once a month', 'Alternate days': 'On alternate days' };
  const timing = (m.timing || '').trim();
  const when = /any time/i.test(timing) ? '' : /empty/i.test(timing) ? 'on an empty stomach' : /early/i.test(timing) ? 'early in the morning' : timing.toLowerCase();
  const duration = m.duration_value != null && String(m.duration_value) !== '' ? `for ${m.duration_value} ${m.duration_unit}` : '';
  const dose = (m.dose_amount || '').trim();
  const head = times[m.frequency] ?? (m.frequency || '');
  const parts = [head, when, duration].filter(Boolean).join(' ');
  return dose && dose !== '1' ? `${dose} each, ${parts.charAt(0).toLowerCase()}${parts.slice(1)}` : parts;
};
/** "09-September-2026", the sheet's date format (IST calendar day). */
const sheetDate = (iso?: string | null): string => {
  const src = iso && !isNaN(new Date(iso).getTime()) ? iso : new Date().toISOString();
  const [y, m, d] = istYmdOf(src).split('-').map(Number);
  return `${pad2(d)}-${MONTHS_LONG[m - 1]}-${y}`;
};

export interface PrescriptionSheetData {
  rx: RxData;
  clientName?: string | null;
  sex?: string | null;
  doctorName?: string | null;
}

type Tight = '' | 'rx-tight' | 'rx-tighter' | 'rx-tightest';
const ROW_H: Record<Tight, number> = { '': 86, 'rx-tight': 70, 'rx-tighter': 60, 'rx-tightest': 52 };
const THEAD_H: Record<Tight, number> = { '': 57, 'rx-tight': 57, 'rx-tighter': 44, 'rx-tightest': 34 };
const GAP: Record<Tight, number> = { '': 37, 'rx-tight': 26, 'rx-tighter': 18, 'rx-tightest': 12 };
const BUL_PAD: Record<Tight, number> = { '': 16, 'rx-tight': 10, 'rx-tighter': 6, 'rx-tightest': 4 };
const BUL_LINE: Record<Tight, number> = { '': 34, 'rx-tight': 27, 'rx-tighter': 23, 'rx-tightest': 19 };
/** The web measures the DOM; here the body height is estimated from the same CSS numbers. */
const estimateBody = (meds: number, extras: number, t: Tight): number => {
  let h = 26 + THEAD_H[t] + (meds ? meds * ROW_H[t] : 50);
  if (extras) h += GAP[t] + 24 + BUL_PAD[t] + extras * BUL_LINE[t];
  return h;
};

/** The sheet as standalone markup (same structure as the web's buildPrescriptionSheetHtml). */
export const buildPrescriptionSheetHtml = (d: PrescriptionSheetData): { html: string; tight: Tight; long: boolean } => {
  const { rx } = d;
  const meds = (rx.medicines ?? []).filter((m) => (m.name ?? '').trim() !== '');
  const bare = (d.clientName?.trim() || rx.patient?.name || '').replace(/^(mr|ms|mrs|dr)\.?\s+/i, '');
  const age = rx.patient?.age != null ? String(rx.patient.age) : '';
  const sexRaw = (d.sex ?? '').trim().toLowerCase();
  const sex = sexRaw.startsWith('m') ? 'Male' : sexRaw.startsWith('f') ? 'Female' : sexRaw ? sexRaw[0].toUpperCase() + sexRaw.slice(1) : '';
  const name = bare ? `${sex === 'Male' ? 'Mr. ' : sex === 'Female' ? 'Ms. ' : ''}${bare}` : '';
  const doctorRaw = (d.doctorName || rx.doctor?.name || '').trim().replace(/^dr\.?\s*/i, '');
  const doctor = doctorRaw ? `DR. ${doctorRaw.toUpperCase()}` : '';
  const rows = meds.map((m) => `
      <div class="rx-row">
        <span class="c n"></span>
        <span class="c med"><span class="nm">${esc(m.name)}</span>${m.strength ? `<span class="str">${esc(m.strength)}</span>` : ''}</span>
        <span class="c sch">${esc(scheduleLabel(m))}</span>
        <span class="c ins">${esc(instructionText(m))}</span>
      </div>`).join('');
  const advice = (rx.advice ?? []).map((a) => a.text).filter(Boolean);
  const tests = (rx.lab_tests ?? []).map((t) => t.name).filter(Boolean);
  const followUp = rx.follow_up?.after_value != null ? `Follow up after ${rx.follow_up.after_value} ${rx.follow_up.after_unit}` : '';
  const extras = [...advice, ...tests, ...(followUp ? [followUp] : [])];
  let tight: Tight = '';
  for (const t of ['', 'rx-tight', 'rx-tighter', 'rx-tightest'] as Tight[]) { tight = t; if (estimateBody(meds.length, extras.length, t) <= BODY_MAX_H) break; }
  const long = estimateBody(meds.length, extras.length, tight) > BODY_MAX_H;
  const html = `
  <div class="rx-sheet ${tight} ${long ? 'rx-long' : ''}">
    <div class="rx-frame-top"></div>
    <div class="rx-frame-left"></div>
    <div class="rx-band"></div>
    <div class="rx-bar"></div>
    <img class="rx-logo" src="${LOGO_URL}" alt="Odds" />
    <div class="rx-runner rx-runner-crop"></div>
    <div class="rx-brand">ODDS LONGEVITY</div>
    <div class="rx-title">Prescription</div>
    <div class="rx-rule rx-rule-title"></div>
    <div class="rx-lab rx-name-k">NAME</div>
    <div class="rx-name">${esc(name)}</div>
    <div class="rx-lab rx-date-k">DATE</div>
    <div class="rx-val rx-date">${esc(sheetDate(rx.finalized_at || rx.date))}</div>
    <div class="rx-lab rx-age-k">AGE</div>
    <div class="rx-val rx-age">${esc(age)}</div>
    <div class="rx-lab rx-sex-k">SEX</div>
    <div class="rx-val rx-sex">${esc(sex)}</div>
    <div class="rx-body">
      <div class="rx-sec" data-sec="meds">
        <h2 class="rx-h">Medication Schedule</h2>
        <div class="rx-thead"><span class="c n">S.NO</span><span class="c med">MEDICINE</span><span class="c sch">SCHEDULE</span><span class="c ins">INSTRUCTIONS</span></div>
        ${meds.length ? `<div class="rx-rows">${rows}</div>` : '<p class="rx-empty">No medicines prescribed.</p>'}
      </div>
      ${extras.length ? `<div class="rx-sec" data-sec="extras">
        <h2 class="rx-h">Additional Instructions</h2>
        <ul class="rx-bul">${extras.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </div>` : ''}
    </div>
    <div class="rx-sign">
      <div class="rx-rule"></div>
      <div class="who">${esc(doctor)}</div>
    </div>
    <div class="rx-contact">
      <span class="ph">7735582679</span>
      <span class="em">enquire@oddsfitness.com</span>
      <span class="web">www.oddslongevity.com</span>
    </div>
    <div class="rx-shape"></div>
    <div class="rx-frame-bottom"></div>
  </div>`;
  return { html, tight, long };
};

const polyBg = (w: number, h: number, points: string, fill: string) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polygon points="${points}" fill="${fill}"/></svg>`)}")`;
const BAND_BG = polyBg(481, 46, '0,0 481,0 427,46 0,46', BAND);
const SHAPE_BG = polyBg(229, 49, '52,0 229,0 229,49 0,49', SHAPE);

export const PRESCRIPTION_SHEET_CSS = `
@page{size:210mm 297mm;margin:0}
html,body{margin:0;padding:0;background:${PAGE_BG}}
.rx-sheet{position:relative;width:${A4_W}px;height:${A4_H}px;background:${PAGE_BG};color:${INK};font-family:${SANS};overflow:hidden;box-sizing:border-box;-webkit-font-smoothing:antialiased}
.rx-sheet *{box-sizing:border-box;margin:0;padding:0}
.rx-frame-top{position:absolute;left:9px;top:21px;width:785px;height:1.5px;background:${FRAME}}
.rx-frame-left{position:absolute;left:9px;top:21px;width:1.5px;height:1100px;background:${FRAME}}
.rx-frame-bottom{position:absolute;left:18px;top:1120px;width:757px;height:1.5px;background:${FRAME}}
.rx-band{position:absolute;left:11px;top:23px;width:481px;height:46px;background:${BAND_BG} no-repeat;background-size:481px 46px}
.rx-bar{position:absolute;left:52px;top:63px;width:46px;height:5px;background:${ORANGE}}
.rx-logo{position:absolute;left:52px;top:90px;height:69px;width:auto}
.rx-runner{position:absolute;left:627px;top:41px;width:145px;height:122px;opacity:.75}
.rx-runner-crop{overflow:hidden;background:url('${LOGO_URL}') no-repeat;background-size:311px 121.5px;background-position:-166px 0}
.rx-brand{position:absolute;left:52px;top:174px;font-size:11px;line-height:14px;letter-spacing:.25em;color:${LABEL};white-space:nowrap}
.rx-title{position:absolute;left:52px;top:194px;font-size:44px;line-height:50px;font-weight:400;color:${INK};white-space:nowrap}
.rx-rule{height:1px;background:${RULE}}
.rx-rule-title{position:absolute;left:52px;top:274px;width:680px}
.rx-lab{position:absolute;font-size:11px;line-height:14px;letter-spacing:.2em;color:${LABEL};white-space:nowrap}
.rx-val{position:absolute;font-size:15.5px;line-height:20px;color:${INK_SOFT};white-space:nowrap}
.rx-name-k{left:52px;top:295px}
.rx-name{position:absolute;left:52px;top:313px;font-size:25px;line-height:30px;color:${INK};white-space:nowrap}
.rx-date-k{left:52px;top:372px}
.rx-age-k{left:475px;top:372px}
.rx-sex-k{left:618px;top:372px}
.rx-date{left:52px;top:387px}
.rx-age{left:475px;top:387px}
.rx-sex{left:619px;top:387px}
.rx-body{position:absolute;top:447px;left:52px;width:680px}
.rx-sec{margin:0}
.rx-sec + .rx-sec{margin-top:37px}
.rx-h{font-size:23px;line-height:26px;font-weight:700;color:${INK};white-space:nowrap}
.rx-sec[data-sec="extras"] .rx-h{font-size:20px;line-height:24px}
.rx-thead,.rx-row{display:table;width:100%;table-layout:fixed}
.rx-thead .c,.rx-row .c{display:table-cell;vertical-align:top}
.rx-thead .c{font-size:10px;line-height:14px;letter-spacing:.12em;color:${LABEL};padding-top:25px;padding-bottom:18px;border-bottom:1px solid ${RULE}}
.c.n{width:42px}
.c.med{width:286px}
.c.sch{width:115px}
.c.ins{width:237px}
.rx-rows{counter-reset:rx}
.rx-row{counter-increment:rx;height:86px;border-bottom:2px solid ${RULE_FAINT};page-break-inside:avoid}
.rx-row .c{padding-top:12px}
.rx-row .n:before{content:counter(rx);font-size:15px;line-height:20px;font-weight:700;color:${ORANGE}}
.rx-row .nm{display:block;font-size:16px;line-height:20px;font-weight:700;color:${INK}}
.rx-row .str{display:block;font-size:15px;line-height:27px;font-weight:700;color:${INK}}
.rx-row .sch{font-size:14.5px;line-height:20px;font-weight:700;color:${INK}}
.rx-row .ins{font-size:14.3px;line-height:20px;color:${INK_SOFT}}
.rx-empty{font-size:15px;line-height:30px;color:${LABEL};padding-top:20px}
.rx-bul{list-style:none;padding-top:16px}
.rx-bul li{position:relative;padding-left:20px;font-size:14.3px;line-height:34px;color:${INK_SOFT};page-break-inside:avoid}
.rx-bul li:before{content:"";position:absolute;left:0;top:15px;width:4px;height:4px;border-radius:2px;background:${ORANGE}}
.rx-sign{position:absolute;left:52px;top:999px;width:680px}
.rx-sign .who{margin-top:4px;font-size:18px;line-height:22px;font-weight:700;color:${INK};white-space:nowrap}
.rx-contact{position:absolute;left:52px;top:1055px;width:680px;height:16px;font-size:12px;line-height:16px;color:${LABEL}}
.rx-contact span{position:absolute;top:0;white-space:nowrap}
.rx-contact .ph{left:0}
.rx-contact .em{left:278px}
.rx-contact .web{left:565px}
.rx-shape{position:absolute;left:544px;top:1073px;width:229px;height:49px;background:${SHAPE_BG} no-repeat;background-size:229px 49px}
.rx-tight .rx-row{height:70px}
.rx-tight .rx-sec + .rx-sec{margin-top:26px}
.rx-tight .rx-bul{padding-top:10px}
.rx-tight .rx-bul li{line-height:27px}
.rx-tight .rx-bul li:before{top:12px}
.rx-tighter .rx-row{height:60px}
.rx-tighter .rx-row .str{line-height:22px}
.rx-tighter .rx-thead .c{padding-top:18px;padding-bottom:12px}
.rx-tighter .rx-sec + .rx-sec{margin-top:18px}
.rx-tighter .rx-bul{padding-top:6px}
.rx-tighter .rx-bul li{line-height:23px}
.rx-tighter .rx-bul li:before{top:10px}
.rx-tightest .rx-h{line-height:24px}
.rx-tightest .rx-sec[data-sec="extras"] .rx-h{line-height:22px}
.rx-tightest .rx-row{height:52px}
.rx-tightest .rx-row .c{padding-top:8px}
.rx-tightest .rx-row .str{line-height:20px}
.rx-tightest .rx-thead .c{padding-top:12px;padding-bottom:8px}
.rx-tightest .rx-sec + .rx-sec{margin-top:12px}
.rx-tightest .rx-bul{padding-top:4px}
.rx-tightest .rx-bul li{line-height:19px}
.rx-tightest .rx-bul li:before{top:8px}
/* A prescription too long for one sheet even at the tightest spacing flows on:
   the body, the signature and the contact line leave their fixed positions and
   stack, the left frame line follows the page, nothing is clipped. */
.rx-long{height:auto;min-height:${A4_H}px;overflow:visible}
.rx-long .rx-frame-left{height:auto;bottom:0}
.rx-long .rx-body{position:relative;top:auto;left:auto;margin:447px 0 0 52px}
.rx-long .rx-sign{position:relative;top:auto;left:auto;margin:48px 0 0 52px}
.rx-long .rx-contact{position:relative;top:auto;left:auto;margin:24px 0 0 52px}
.rx-long .rx-shape{position:relative;top:auto;left:auto;margin:14px 0 0 544px}
.rx-long .rx-frame-bottom{position:relative;top:auto;left:auto;margin:0 0 0 18px}
`;

/** The full printable document. */
export const buildPrescriptionDocumentHtml = (d: PrescriptionSheetData): string => {
  const { html } = buildPrescriptionSheetHtml(d);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${A4_W}"><style>${PRESCRIPTION_SHEET_CSS}</style></head><body>${html}</body></html>`;
};

/** "Prescription_<client>_<yyyy-MM-dd>.pdf" (IST day of finalized_at or date). */
export const prescriptionFileName = (d: PrescriptionSheetData): string => {
  const who = (d.clientName || d.rx.patient?.name || 'client').replace(/^(mr|ms|mrs|dr)\.?\s+/i, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'client';
  const src = d.rx.finalized_at || d.rx.date;
  const ymd = src && !isNaN(new Date(src).getTime()) ? istYmdOf(src) : istYmdOf(new Date().toISOString());
  return `Prescription_${who}_${ymd}.pdf`;
};

/** Renders the sheet to a PDF in the cache directory and opens the share sheet. */
export async function sharePrescriptionPdf(d: PrescriptionSheetData): Promise<{ uri: string; pages: number }> {
  const html = buildPrescriptionDocumentHtml(d);
  // A4 in points (72 per inch); the CSS is 96 dpi px, which the print engine maps to the same 210 x 297 mm.
  const res = await Print.printToFileAsync({ html, width: 595, height: 842, base64: false });
  let uri = res.uri;
  try {
    const name = prescriptionFileName(d);
    const src = new File(res.uri);
    const dst = new File(Paths.cache, name);
    if (dst.exists) dst.delete();
    await src.move(dst);
    uri = dst.uri;
  } catch { /* keep the print engine's own file name */ }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: prescriptionFileName(d), UTI: 'com.adobe.pdf' });
  return { uri, pages: res.numberOfPages };
}
```

### 3.2 `tests/rules/prescription_schedule_test.js` (new, 13 cases)
```js
// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/prescription_schedule_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/prescriptionSheet.ts (30 Oct 2026): the SCHEDULE column printed DAILY for every
// frequency it did not know, so a weekly Mounjaro or a monthly vitamin D read DAILY on the app's PDF.
// The expo modules and consultantQueries are stubbed; only the pure wording functions are exercised.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/prescriptionSheet.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const stub = (name) => {
  if (name === './consultantQueries') return { istYmdOf: (s) => String(s).slice(0, 10), MONTHS_LONG: [], pad2: (n) => String(n).padStart(2, '0') };
  return {};
};
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, stub);
const M = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const line = (frequency, instruction = '', dv = null, du = 'days', timing = 'Any time') => ({ frequency, instruction, duration_value: dv, duration_unit: du, timing, dose_amount: '1' });

// SCHEDULE column
eq('Weekly is WEEKLY, not DAILY', M.scheduleLabel(line('Weekly')), 'WEEKLY');
eq('Monthly is MONTHLY', M.scheduleLabel(line('Monthly')), 'MONTHLY');
eq('Alternate days', M.scheduleLabel(line('Alternate days')), 'ALTERNATE DAYS');
eq('daily codes stay DAILY', ['OD', 'BD', 'TDS', 'QID'].map((f) => M.scheduleLabel(line(f))), ['DAILY', 'DAILY', 'DAILY', 'DAILY']);
eq('HS and SOS unchanged', [M.scheduleLabel(line('HS')), M.scheduleLabel(line('SOS'))], ['NIGHTLY', 'AS NEEDED']);
eq('unknown words print themselves, never DAILY', M.scheduleLabel(line('Every 3 days')), 'EVERY 3 DAYS');
eq('empty stays empty', M.scheduleLabel(line('')), '');

// INSTRUCTIONS column, no instruction written
eq('monthly with no instruction', M.instructionText(line('Monthly')), 'Once a month');
eq('weekly with duration, no instruction', M.instructionText(line('Weekly', '', 3, 'weeks')), 'Once a week for 3 weeks');
eq('own instruction still wins', M.instructionText(line('Weekly', 'Subcutaneous injection', 3, 'weeks')), 'Subcutaneous injection');

// popup fields
const freq = (f) => M.medicineFields(line(f)).find((x) => x.label === 'Frequency');
eq('popup weekly', freq('Weekly').value, 'Once a week');
eq('popup monthly', freq('Monthly').value, 'Once a month');
eq('popup OD unchanged', freq('OD').value, 'Once daily');

console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
```
It needs `typescript` in `node_modules` (already there for tsc). Run from the repo root:
`node tests/rules/prescription_schedule_test.js` → 13 lines starting `PASS`, then `all passed`, exit code 0.

### 3.3 Screens: no code change
The wording reaches the screens through the functions above. Check that your screens call them the same way (Android
blocks, unchanged by this fix):

`src/components/consultantUi.tsx`, `PrescriptionView`, the Medicines block:
```tsx
            {medicines.map((m, i) => {
              const fields = medicineFields(m);
```
```tsx
                          <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, letterSpacing: 0.6, color: CX.slate400 }}>{f.label.toUpperCase()}</Text>
                          <Text style={{ fontFamily: F.bodySemi, fontSize: 11.5, color: CX.slate800 }}>{f.value}{f.hint ? <Text style={{ fontFamily: F.bodyReg, color: CX.slate500 }}> · {f.hint.toLowerCase()}</Text> : null}</Text>
```

`src/screens/consultantCalls.tsx`, `CallRecordSheet`, the PDF action and its button:
```tsx
  const savePdf = async () => {
    if (!call?.prescription) return;
    setSaving(true);
    try { await sharePrescriptionPdf({ rx: call.prescription, clientName: slotPersonName(call.client), doctorName: slotPersonName(call.doctor) }); }
    catch (e: any) { Alert.alert("Couldn't build the prescription PDF", friendlyError(e, 'Try again.')); }
    finally { setSaving(false); }
  };
```
```tsx
                  {rxState(call.prescription) !== 'none' ? <LightBtn small label="Download PDF" icon="file" tone="outline" busy={saving} onPress={savePdf} /> : null}
```

`src/components/consultCrmUi.tsx` (CRM record popup) renders `<PrescriptionView rx={rx} />` and so needs nothing either.

### 3.4 Done when
- `npx tsc --noEmit` exit 0.
- `node tests/rules/prescription_schedule_test.js` prints `all passed`; every other `node tests/rules/*_test.js` still passes.

## 4. Check on the iPhone
1. Find a call that has a non-daily line (read-only SQL):
   ```sql
   select id, consultation_date, doctor_id, status
   from doctor_consultation_details
   where status <> 'cancelled'
     and exists (select 1 from jsonb_array_elements(coalesce(prescription->'medicines', '[]'::jsonb)) m
                 where m->>'frequency' in ('Weekly', 'Monthly', 'Alternate days'))
   order by consultation_date desc;
   ```
   Sign in on the iPhone as that row's doctor (a consultant). If no row comes back, ask the owner to write a Weekly and
   a Monthly line on a throw-away booking from the web panel; the app editor cannot choose them (2.2).
2. All Calls → that call → **Prescription**. In the Medicines block the weekly line's FREQUENCY pill reads
   "Once a week" (was "Weekly"), the monthly one "Once a month", with no "· morning" hint. An `OD` line on the same
   prescription still reads "Once daily · morning".
3. Tap **Download PDF**. The share sheet opens with `Prescription_<client>_<yyyy-MM-dd>.pdf`; save it to Files and open
   it. SCHEDULE reads WEEKLY / MONTHLY / ALTERNATE DAYS on those lines; `OD` / `BD` / `TDS` / `QID` lines still read
   DAILY, `HS` NIGHTLY, `SOS` AS NEEDED. No non-daily line reads DAILY.
4. INSTRUCTIONS on the same sheet: a line with an instruction written prints that instruction alone (for example
   "Subcutaneous injection", no duration added); a weekly line without one prints "Once a week for 3 weeks" (or with
   its own timing and duration, as in section 1).
5. Open an older call whose prescription has only daily codes, HS or SOS, and download its PDF: it matches what iOS
   printed before the change, cell for cell.
6. Edit prescription on the weekly call, look only: the weekly line's summary reads `1 · Weekly · ...` and no Frequency
   chip is selected (same as Android). Press **Cancel**. Do not press "Save changes as vN" on a real call: every save
   makes a new prescription version.
7. As a CRM (if you have one): Doctor Consultation → the same call → Prescription tab shows "Once a week" in the
   FREQUENCY pill; there is no Download PDF there (unchanged).

Not confirmed:
- Whether the iOS repo's `src/lib/prescriptionSheet.ts` is still identical to Android's pre-30-Oct version (the 8 to 20
  Oct handoff told iOS to copy it); if it is not, apply the diff in 3.1 by hand.
- Which live calls carry Weekly / Monthly lines: a hub-track data script of 30 Oct 2026 saved one such prescription
  (Dr. Wasir, 29 Oct 2026 call), but this was not re-checked live for this handoff; use the SQL in step 1.
- Whether a signed Android build containing 75f43e2 was installed and checked on a device.
