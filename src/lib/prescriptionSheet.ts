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

export const FREQUENCY_TEXT: Record<string, string> = { OD: 'once daily', BD: 'twice daily', TDS: 'three times daily', QID: 'four times daily', HS: 'at bedtime', SOS: 'as needed' };

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
export const scheduleLabel = (m: RxMedicineLine): string => {
  switch (m.frequency) {
    case 'SOS': return 'AS NEEDED';
    case 'HS': return 'NIGHTLY';
    default: return m.frequency ? 'DAILY' : '';
  }
};
/** INSTRUCTIONS column: the doctor's own note, else one sentence from dose, frequency, timing and duration. */
export const instructionText = (m: RxMedicineLine): string => {
  const own = (m.instruction || '').trim();
  if (own) return own;
  const times: Record<string, string> = { OD: 'Once a day', BD: 'Two times a day', TDS: 'Three times a day', QID: 'Four times a day', HS: 'At bedtime', SOS: 'When needed' };
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
