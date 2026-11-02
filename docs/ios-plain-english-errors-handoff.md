# iOS handoff: Errors in plain English (Android since 26 Oct 2026)

Owner, 26 Oct 2026: "all the errors in the app are in technical language; fix it all, use basic English". On Android
every error a person sees is now one short, plain sentence. Alerts, inline red error lines, the Waiting to Sync reasons
and the Add Workout sync error all go through `friendlyError(e, plainFallback)` instead of showing `e.message` as it was
raised. Before, staff read lines such as "new row violates row-level security policy for table ...", "JSON object
requested, multiple (or no) rows returned", "duplicate key value violates unique constraint ...", "Could not find the
function ... in the schema cache" and "TypeError: Network request failed". Our own server sentences ("The client
cancelled this session.") still reach the person word for word. Server: none (no migration, no function, no package).

Android commits: 2fbbe30 (26 Oct 2026: `friendlyError`, 211 sites in 66 files converted by a codemod, the timeout
wording, the hard-coded technical lines), de8c438 (27 Oct: the codemod had put the new import inside multi-line import
blocks), 608aca2 (30 Oct: the E-word bug in `looksTechnical`), 2aa0a9d (2 Nov: `codedSentence` on the approval screens,
section 3.7). Android builds have it from 5.1 (33) of 26 Oct; the E-word fix is in the first build after 5.2 (43).

This document contains no em or en dash characters. Where the Android source has one, it is written as the escape
`\u2014` (em dash) or `\u2013` (en dash). Section 3.2 has the one-line command that puts them back so both files match
Android byte for byte.

## 1. What the user sees (Android)

- Alert titles are unchanged ("Couldn't save goals", "Reschedule failed", "Could not save session"); only the body
  changed.
- The body is one of these sentences, chosen from what was raised, checked in this order:

| What was raised | Shown |
|---|---|
| our `TimeoutError` (by its name) | This took too long. Check your connection and try again. |
| nothing (null, empty message and no code) | the call site's fallback (default: Something went wrong. Please try again.) |
| Network request failed, network error, Failed to fetch, fetch failed, ENOTFOUND, ECONN..., socket hang up, AbortError, aborted, load failed | No connection. Check your internet and try again. |
| code 57014, "canceling statement", "statement timeout" | The server took too long. Try again in a moment. |
| any other "timed out", "timeout", "took too long" | This took too long. Check your connection and try again. |
| code 55P03, "lock timeout", "could not obtain lock" | Someone else is changing this right now. Wait a moment and try again. |
| JWT expired, invalid claim, Auth session missing, refresh_token, Invalid Refresh Token, not signed in | Your sign-in has expired. Sign in again. |
| code 42501, row-level security, permission denied, not authorized / authorised, unauthorized, forbidden | You are not allowed to do this. Sign in again, or ask the tech team if you think you should be. |
| code 23505, duplicate key, unique constraint, already exists | This was already saved. Pull to refresh to see it. |
| code 23502 or 23514, null value in column, violates not-null, violates check constraint | Something is missing in the form. Check the fields and try again. |
| code 23503, violates foreign key | This points to something that no longer exists. Pull to refresh and try again. |
| code 22P02, 22007 or 22008, invalid input syntax, invalid input value, out of range | Some of the entered details are not valid. Check them and try again. |
| code PGRST116, JSON object requested, multiple (or no) rows, 0 rows | That item was not found. Pull to refresh and try again. |
| code PGRST202, PGRST204, 42P01, 42703 or 42883, could not find the function, schema cache, does not exist | This part is not set up on the server yet. Tell the tech team. |
| FunctionsHttpError, FunctionsFetchError, FunctionsRelayError, non-2xx, Edge Function, status code 5xx, Internal Server Error, Bad Gateway, Service Unavailable | The service did not answer. Try again in a moment. |
| payload too large, exceeded the maximum allowed size, entity too large, bucket not found, object not found, file too large | The file could not be saved. Check its size and try again. |
| anything else | the text itself, cleaned as below, or the fallback |

"Anything else" is cleaned like this:
- a leading code such as `PLAN_LIMIT: ` is removed (a capital letter, then at least 3 capitals, digits or underscores,
  then a colon);
- a dash with a space on both sides (`-`, `\u2013` or `\u2014`) becomes ", "; repeated spaces collapse;
- if what is left reads like code (`looksTechnical`), or is longer than 220 characters, the fallback is shown;
- otherwise it is shown as it is, with a full stop added when it does not end in `.`, `!` or `?`.

Examples, all from the rule test:

| Raised | Shown |
|---|---|
| The client cancelled this session. | The client cancelled this session. |
| Sagar Sharma already has a session at 7:00 pm on 27 Oct | Sagar Sharma already has a session at 7:00 pm on 27 Oct. |
| PLAN_LIMIT: Plan limit reached: 3 sessions are logged without an approved plan. | Plan limit reached: 3 sessions are logged without an approved plan. |
| Saved on this device `\u2014` it will upload later | Saved on this device, it will upload later. |
| Sadhvi's Strength plan ran out on 30 Oct 2026. The session was not added to the roster. Make a new plan and get it approved first. | the same sentence |
| Essentials sessions expired every evening. | the same sentence (since 30 Oct; before, the fallback) |
| Cannot read properties of undefined (reading "id") | Something went wrong. Please try again. |
| essentials_weeks row missing for client | Something went wrong. Please try again. |
| EPIPE write after end | Something went wrong. Please try again. |

Where the person sees these:
- every Alert body that used to show `e.message`, on every role and screen;
- every inline red error line that was set from `e.message` (`setErr`, `setError`);
- Home, Waiting to Sync: the red reason line under a "Sync failed" item;
- Today's Roster: the red line under "Workout logged · Sync failed · review it on Home" on a roster card;
- Add Workout: the red sync error box under the form when the server refuses the log;
- the voice note saves (session voice sheet, physio session sheet, therapy session sheet).

The session code and plan limit reasons keep their own texts (section 3.5). A few hard-coded lines were reworded too
(section 3.6), for example "This took too long. Check your connection and try again." and the "Already synced" alerts.

## 2. Data / server contract

- No server change: no table, column, RPC, edge function, migration or package.
- The offline outbox still stores the raw error string. Only the display translates it (section 3.5).

Server sentence convention (for anyone writing a `RAISE EXCEPTION` the apps will show, and for you to know what reaches
the screen):
- Either a plain sentence, which is shown word for word (a full stop is added when missing), or `CODE: sentence`, where
  `CODE` is capitals, digits and underscores (at least 4 characters, starting with a letter); `friendlyError` strips the
  code and shows the sentence.
- Never words that look technical. `looksTechnical` sends the fallback for: `XxxError`, `error:`, null, undefined, NaN,
  any brace or bracket, `[object`, `at name(`, `->`, `::`, select, insert, upsert, delete from, where, `pg_`, any
  snake_case word (`essentials_weeks`), a quoted lower-case identifier (`"trainer_id"`), status code, http, API, RPC,
  SQL, RLS, json, jsonb, uuid, relation, schema, constraint, violates, syntax, fetch, socket, stack, token, JWT,
  payload, query, column, table (all case-blind), and a capital system code of E plus 4 or more capitals (`ECONNREFUSED`,
  `EPIPE`, case-sensitive). Keep it under 220 characters.
- The earlier rows of that table also win over the sentence, so a sentence must not contain their words, for example:
  network error, failed to fetch, aborted, load failed, timed out, timeout, took too long, not signed in, permission
  denied, not authorized, unauthorized, forbidden, already exists, does not exist, out of range, 0 rows, Edge Function,
  file too large, object not found. A sentence raised with one of the codes in the table in section 1
  (42501, 23505, 23502, 23514, 23503, 22P02, 22007, 22008, 57014, 55P03, PGRST116, PGRST202, PGRST204, 42P01, 42703,
  42883) is replaced by that code's line whatever it says. A plain `RAISE EXCEPTION` (code P0001) is fine.
- A refusal that must carry 42501 (not allowed) and still show its own sentence uses an `OTP_` or `APPROVAL_` prefix and
  is read by `codedSentence` first (section 3.7).
- Android builds from 26 Oct 2026 to 5.2 (43), and any iOS build without the 30 Oct fix, turn every word of E plus 4 or
  more letters ("expired", "Essentials", "every") into the fallback. Server sentences meant for those phones avoid such
  words, which is why the plan refusal says "ran out".
- Codes that are read by their own mappers before `friendlyError` sees the text: `PLAN_LIMIT` (`planLimitText`),
  `OTP_NOT_VERIFIED` (`isOtpGateError`, `workoutOtpErrorText`), `OTP_VERIFY_FAILED:<reason>` (`verifyFailureReason`),
  `PAID_CANCEL_CODE_REQUIRED` (`isPaidCancelGateError`), `ESSENTIALS_LOCKED` (`isEssentialsLockedError`), the
  `ESSENTIALS_*` grab refusals (`describeGrabError`), `ROUTE_*` (route tracker), `DUPLICATE_SLOT`
  (`ALREADY_LOGGED_MESSAGE`).

## 3. Code to port

### 3.1 `src/lib/friendlyError.ts` (new; pure, no imports; copy byte for byte)
```ts
/* Plain-English errors (26 Oct 2026, owner: "all the errors in the app are in technical language; fix it all,
   use basic English"). Every alert, inline error line and Waiting to Sync reason goes through friendlyError,
   which turns what Supabase, Postgres, the network layer or an edge function said into one short sentence a
   trainer understands. A plain sentence our own server functions raise ("The client cancelled this session.")
   is kept as it is; anything that reads like code falls back to a generic line, never the raw text.
   Pure: no imports, node-tested in tests/rules/friendly_error_test.js. */

export const FRIENDLY_FALLBACK = 'Something went wrong. Please try again.';
export const NO_CONNECTION = 'No connection. Check your internet and try again.';
export const TOOK_TOO_LONG = 'This took too long. Check your connection and try again.';
export const NOT_ALLOWED = 'You are not allowed to do this. Sign in again, or ask the tech team if you think you should be.';
export const ALREADY_SAVED = 'This was already saved. Pull to refresh to see it.';
export const MISSING_FIELD = 'Something is missing in the form. Check the fields and try again.';
export const BAD_INPUT = 'Some of the entered details are not valid. Check them and try again.';
export const NOT_FOUND = 'That item was not found. Pull to refresh and try again.';
export const GONE_LINK = 'This points to something that no longer exists. Pull to refresh and try again.';
export const NOT_SET_UP = 'This part is not set up on the server yet. Tell the tech team.';
export const SERVER_SLOW = 'The server took too long. Try again in a moment.';
export const BUSY_ROW = 'Someone else is changing this right now. Wait a moment and try again.';
export const SERVICE_DOWN = 'The service did not answer. Try again in a moment.';
export const FILE_TOO_BIG = 'The file could not be saved. Check its size and try again.';
export const SIGNED_OUT = 'Your sign-in has expired. Sign in again.';

const rawOf = (e: unknown): { msg: string; code: string; name: string } => {
  if (e == null) return { msg: '', code: '', name: '' };
  if (typeof e === 'string') return { msg: e, code: '', name: '' };
  const o = e as { message?: unknown; code?: unknown; name?: unknown; error?: unknown; details?: unknown };
  const msg = typeof o.message === 'string' ? o.message : typeof o.error === 'string' ? o.error : '';
  return { msg: msg.trim(), code: typeof o.code === 'string' ? o.code : '', name: typeof o.name === 'string' ? o.name : '' };
};

/** True when the text reads like code or a database message, not like a sentence for a person. */
export const looksTechnical = (msg: string): boolean =>
  /[A-Za-z]+Error\b|\berror:|\bnull\b|\bundefined\b|\bNaN\b|[{}\[\]]|\[object|\bat\s+\w+\s*\(|->|::|\bselect\b|\binsert\b|\bupsert\b|\bdelete from\b|\bwhere\b|\bpg_|\b[a-z]+_[a-z_]+\b|"[a-z_]+"|status code|\bhttp\b|\bAPI\b|\bRPC\b|\bSQL\b|\bRLS\b|\bjson\b|\bjsonb\b|\buuid\b|\brelation\b|\bschema\b|\bconstraint\b|\bviolates\b|\bsyntax\b|\bfetch\b|\bsocket\b|\bstack\b|\btoken\b|\bJWT\b|\bpayload\b|\bquery\b|\bcolumn\b|\btable\b/i.test(msg)
  // System error codes (ECONNREFUSED, EPIPE) in capitals only. Inside the case-blind test above this matched every
  // English word of E plus 4 letters ("expired", "Essentials", "every"), so those plain sentences fell back (30 Oct 2026).
  || /\bE[A-Z]{4,}\b/.test(msg);

/** Strips a code prefix like "PLAN_LIMIT: " or "ESSENTIALS_LOCKED: " and tidies the dash rule. */
const tidy = (s: string): string =>
  s.replace(/^[A-Z][A-Z0-9_]{3,}:\s*/, '').replace(/\s[\u2014\u2013-]\s/g, ', ').replace(/\s+/g, ' ').trim();

/**
 * The sentence to show a person for any thrown value. `fallback` is used when nothing better is known;
 * it should itself be plain English (the default is "Something went wrong. Please try again.").
 */
export const friendlyError = (e: unknown, fallback: string = FRIENDLY_FALLBACK): string => {
  const { msg, code, name } = rawOf(e);
  const m = msg;
  if (name === 'TimeoutError') return TOOK_TOO_LONG;
  if (!m && !code) return fallback;
  // connection and time
  if (/network request failed|network error|failed to fetch|fetch failed|ENOTFOUND|ECONN|socket hang up|AbortError|\baborted\b|load failed/i.test(m) || name === 'AbortError') return NO_CONNECTION;
  if (code === '57014' || /canceling statement|statement timeout/i.test(m)) return SERVER_SLOW;
  if (/timed out|timeout\b|took too long/i.test(m)) return TOOK_TOO_LONG;
  if (code === '55P03' || /lock timeout|could not obtain lock/i.test(m)) return BUSY_ROW;
  // sign-in
  if (/JWT expired|invalid claim|Auth session missing|refresh_token|Invalid Refresh Token|not signed in/i.test(m)) return SIGNED_OUT;
  // permissions
  if (code === '42501' || /row-level security|permission denied|not authori[sz]ed|\bunauthori[sz]ed\b|\bforbidden\b/i.test(m)) return NOT_ALLOWED;
  // data shape
  if (code === '23505' || /duplicate key|unique constraint|already exists/i.test(m)) return ALREADY_SAVED;
  if (code === '23502' || code === '23514' || /null value in column|violates not-null|violates check constraint/i.test(m)) return MISSING_FIELD;
  if (code === '23503' || /violates foreign key/i.test(m)) return GONE_LINK;
  if (code === '22P02' || code === '22007' || code === '22008' || /invalid input syntax|invalid input value|out of range/i.test(m)) return BAD_INPUT;
  if (code === 'PGRST116' || /JSON object requested|multiple \(or no\) rows|0 rows/i.test(m)) return NOT_FOUND;
  if (code === 'PGRST202' || code === 'PGRST204' || code === '42P01' || code === '42703' || code === '42883' || /could not find the function|schema cache|does not exist|relation .* does not exist|column .* does not exist/i.test(m)) return NOT_SET_UP;
  // services and files
  if (/FunctionsHttpError|FunctionsFetchError|FunctionsRelayError|non-2xx|Edge Function|status code 5\d\d|Internal Server Error|Bad Gateway|Service Unavailable/i.test(m)) return SERVICE_DOWN;
  if (/payload too large|exceeded the maximum allowed size|entity too large|bucket not found|object not found|file too large/i.test(m)) return FILE_TOO_BIG;
  // a plain sentence from one of our own server functions is kept; code-like text is not
  const clean = tidy(m);
  if (!clean) return fallback;
  if (looksTechnical(clean)) return fallback;
  if (clean.length > 220) return fallback;
  return /[.!?]$/.test(clean) ? clean : clean + '.';
};
```

### 3.2 `tests/rules/friendly_error_test.js` (new; copy byte for byte)
`ROOT` is the repo root, so it runs unchanged in the iOS repo. It needs `typescript` in `node_modules`.
```js
// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/friendly_error_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// node test of src/lib/friendlyError.ts: raw server, network and library errors become one plain sentence.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/friendlyError.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
const F = m.exports;
let fails = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
const E = (message, code) => Object.assign(new Error(message), code ? { code } : {});

eq('rls by code', F.friendlyError(E('new row violates row-level security policy for table "session_schedule"', '42501')), F.NOT_ALLOWED);
eq('rls by text', F.friendlyError(E('new row violates row-level security policy for table "x"')), F.NOT_ALLOWED);
eq('no rows', F.friendlyError(E('JSON object requested, multiple (or no) rows returned', 'PGRST116')), F.NOT_FOUND);
eq('duplicate', F.friendlyError(E('duplicate key value violates unique constraint "session_schedule_key"', '23505')), F.ALREADY_SAVED);
eq('not null', F.friendlyError(E('null value in column "trainer_id" of relation "x" violates not-null constraint', '23502')), F.MISSING_FIELD);
eq('uuid', F.friendlyError(E('invalid input syntax for type uuid: "abc"', '22P02')), F.BAD_INPUT);
eq('missing function', F.friendlyError(E('Could not find the function public.xyz(p_a) in the schema cache', 'PGRST202')), F.NOT_SET_UP);
eq('statement timeout', F.friendlyError(E('canceling statement due to statement timeout', '57014')), F.SERVER_SLOW);
eq('network', F.friendlyError(E('TypeError: Network request failed')), F.NO_CONNECTION);
eq('failed to fetch', F.friendlyError(E('Failed to fetch')), F.NO_CONNECTION);
eq('abort', F.friendlyError(Object.assign(new Error('Aborted'), { name: 'AbortError' })), F.NO_CONNECTION);
eq('our timeout class', F.friendlyError(Object.assign(new Error('Crew alerts timed out'), { name: 'TimeoutError' })), F.TOOK_TOO_LONG);
eq('timed out text', F.friendlyError(E('Upload timed out, check your connection and try again.')), F.TOOK_TOO_LONG);
eq('edge function', F.friendlyError(E('FunctionsHttpError: Edge Function returned a non-2xx status code')), F.SERVICE_DOWN);
eq('jwt expired', F.friendlyError(E('JWT expired')), F.SIGNED_OUT);
eq('file too large', F.friendlyError(E('Payload too large')), F.FILE_TOO_BIG);
eq('our own plain sentence is kept', F.friendlyError(E('The client cancelled this session.')), 'The client cancelled this session.');
eq('plain sentence gets a full stop', F.friendlyError(E('Sagar Sharma already has a session at 7:00 pm on 27 Oct')), 'Sagar Sharma already has a session at 7:00 pm on 27 Oct.');
eq('code prefix stripped', F.friendlyError(E('PLAN_LIMIT: Plan limit reached: 3 sessions are logged without an approved plan.')), 'Plan limit reached: 3 sessions are logged without an approved plan.');
eq('em dash replaced', F.friendlyError(E('Saved on this device \u2014 it will upload later')), 'Saved on this device, it will upload later.');
eq('technical remainder falls back', F.friendlyError(E('Cannot read properties of undefined (reading "id")')), F.FRIENDLY_FALLBACK);
eq('identifier-looking text falls back', F.friendlyError(E('essentials_weeks row missing for client')), F.FRIENDLY_FALLBACK);
eq('custom fallback', F.friendlyError(E('[object Object]'), 'Could not save the note. Try again.'), 'Could not save the note. Try again.');
eq('empty error', [F.friendlyError(null), F.friendlyError(new Error('')), F.friendlyError(undefined, 'Try again.')], [F.FRIENDLY_FALLBACK, F.FRIENDLY_FALLBACK, 'Try again.']);
eq('string input', F.friendlyError('permission denied for table clients'), F.NOT_ALLOWED);
// 30 Oct 2026: the expired-plan refusal from plan_manager_add_session (P0001) reaches the trainer word for word
const coverPast = "Sadhvi's Strength plan ran out on 30 Oct 2026. The session was not added to the roster. Make a new plan and get it approved first.";
const coverLong = "Shubhangini's Aqua Aerobics plan runs out on 30 Oct 2026, so it does not cover the 30 Oct session. The session was not added to the roster. Make a new plan and get it approved first.";
eq('expired plan refusal kept', [F.friendlyError(E(coverPast, 'P0001')), F.friendlyError(E(coverLong, 'P0001'))], [coverPast, coverLong]);
// 30 Oct 2026: words of E plus 4 letters are English, not error codes; capital codes still fall back
eq('E words are not codes', F.friendlyError(E('Essentials sessions expired every evening.')), 'Essentials sessions expired every evening.');
eq('capital error code falls back', F.friendlyError(E('EPIPE write after end')), F.FRIENDLY_FALLBACK);
eq('too long falls back',F.friendlyError(E('a '.repeat(150) + 'sentence')), F.FRIENDLY_FALLBACK);
// standing rule: no dashes in any constant
const all = Object.values(F).filter((v) => typeof v === 'string').join(' ');
eq('no dashes in the copy', /[\u2013\u2014]|\s-\s/.test(all), false);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
```
Run: `node tests/rules/friendly_error_test.js`. Expected: 30 lines starting with PASS, then `ALL PASS`, exit code 0.

To make both files byte-identical to Android (put the dash characters back), run this from the repo root, then check
the hashes:
```sh
node -e 'const fs = require("fs"); for (const f of ["src/lib/friendlyError.ts", "tests/rules/friendly_error_test.js"]) fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/\\u2014/g, "\u2014").replace(/\\u2013/g, "\u2013"));'
shasum -a 256 src/lib/friendlyError.ts tests/rules/friendly_error_test.js
```
Expected (LF line endings, one newline at the end of each file; on Windows use `sha256sum`):
```
20ee8eb160829b459d7537d1ca0e865703b0e07e61c5990bc55efad182e51cef  src/lib/friendlyError.ts
40ab05d0e10f80ecc0007bdd4a8b9fd77779d47e3bfc577934f758e67d5adcb1  tests/rules/friendly_error_test.js
```
Without that step the code behaves exactly the same (an escape inside a regex or a string is the same character); only
the hashes differ.

### 3.3 `src/lib/withTimeout.ts` (two strings)
Android now (class `TimeoutError` and `withTimeout`):
```ts
export class TimeoutError extends Error {
  constructor(message = 'This took too long. Check your connection and try again.') {
    super(message);
    this.name = 'TimeoutError';
  }
}
export const isTimeoutError = (e: any) => e?.name === 'TimeoutError';
```
```ts
export function withTimeout<T>(p: Promise<T>, ms: number, label?: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    t = setTimeout(() => reject(new TimeoutError(label ? `${label} took too long. Check your connection and try again.` : undefined)), ms);
  });
  return Promise.race([p, timeout]).finally(() => { if (t) clearTimeout(t); }) as Promise<T>;
}
```
Old texts: `'The request timed out \u2014 check your connection and try again.'` and
`` `${label} timed out \u2014 check your connection and try again.` ``.
- The class name `TimeoutError` and `isTimeoutError` are unchanged. The outbox (`isTransientError` in `offline.ts`) and
  the route publisher key on the name, not on the text.
- `invokeWithTimeout` passes the edge function's name as the label, so the raw text reads "compare-qhps took too long.
  ..."; `friendlyError` shows "This took too long. Check your connection and try again." either by the name or, when a
  caller re-wrapped it as `new Error(error.message)`, by the words "took too long".
- The codemod also added `import { friendlyError } from './friendlyError';` to `withTimeout.ts`, `offline.ts`,
  `essentialsAuction.ts` (as its first line), `doctorQueries.ts` and `sessionVoiceQueries.ts`, where nothing uses it.
  TypeScript and Babel drop unused imports, so it is harmless (the auction rule test still passes); keep it or skip it.

### 3.4 The conversion rule (every call site)
Anything that puts an error in front of a person passes the error itself (not its message) to `friendlyError`, with a
plain fallback. `friendlyError` reads `message`, `code` and `name`, so pass the Supabase `error` object or the thrown
value; passing `error.message` loses the code and the code rules in section 1 cannot fire.

| Before | After |
|---|---|
| `e?.message ?? '<fallback>'` | `friendlyError(e, '<fallback>')` |
| `e?.message \|\| '<fallback>'` | `friendlyError(e, '<fallback>')` |
| `e?.message`, `e.message`, `error.message` (no fallback) | `friendlyError(e)`, `friendlyError(error)` |
| `String(err?.message ?? err)` | `friendlyError(err)` |
| an outbox answer `r.error ?? '<text>'` | `friendlyError(r.error, '<plain text>')` |

The same applies to `err`, `error` and any other name of the caught value.

Examples, exact Android before and after:

1. Alert with a fallback (`src/screens/trainer.tsx`, `ClientDetail`, `saveGoals`):
```ts
// before
Alert.alert("Couldn't save goals", e?.message ?? 'Try again.');
// after
Alert.alert("Couldn't save goals", friendlyError(e, 'Try again.'));
```
2. Alert with a technical fallback (`trainer.tsx`, `Profile`, `pickAvatar`):
```ts
// before
} catch (e: any) { Alert.alert('Upload failed', e?.message ?? 'Unknown error'); }
// after
} catch (e: any) { Alert.alert('Upload failed', friendlyError(e, 'Something went wrong. Please try again.')); }
```
3. A Supabase error object and a caught value, no fallback (`src/screens/managerChat.tsx`, `ManagerChat`,
   `saveTimeEdit`):
```ts
// before
if (error) { Alert.alert('Reschedule failed', error.message); return; }
} catch (err: any) { Alert.alert('Reschedule failed', String(err?.message ?? err)); }
// after
if (error) { Alert.alert('Reschedule failed', friendlyError(error)); return; }
} catch (err: any) { Alert.alert('Reschedule failed', friendlyError(err)); }
```
4. Inline error line from a mutation (`src/components/qhpAlerts.tsx`, `ResubmitSheet`):
```tsx
// before
onPress={() => { setErr(null); m.mutate({ id: row.id, message: msg.trim() }, { onSuccess: onClose, onError: (e: any) => setErr(e?.message ?? 'Failed to resubmit.') }); }}
// after
onPress={() => { setErr(null); m.mutate({ id: row.id, message: msg.trim() }, { onSuccess: onClose, onError: (e: any) => setErr(friendlyError(e, 'Could not resubmit. Please try again.')) }); }}
```
   The line that shows it is unchanged: `{err ? <Body style={{ fontSize: 11, color: C.red }}>{err}</Body> : null}`.
5. Inline error line, no fallback (`src/screens/opsLeads.tsx`, `toggleCategory`):
```ts
// before
update.mutate({ id: lead.id, patch: { categories: next, category: next[0] ?? 'not_defined' } }, { onError: (e: any) => setErr(e?.message) });
// after
update.mutate({ id: lead.id, patch: { categories: next, category: next[0] ?? 'not_defined' } }, { onError: (e: any) => setErr(friendlyError(e)) });
```
6. An `||` fallback (`src/components/PaidCancelCodeStep.tsx`, `submit`):
```ts
// before
setErr(e?.message || 'The code could not be verified. Check your connection and retry.');
// after
setErr(friendlyError(e, 'The code could not be verified. Check your connection and retry.'));
```
7. An outbox answer (`src/screens/doctorSessions.tsx`, `PhysioSessionSheet`, `doSubmit`; the same line in
   `src/screens/therapist.tsx`, `AddTherapySessionSheet`):
```ts
// before
if (r.status === 'failed') failed = r.error ?? 'The server rejected a voice note.';
// after
if (r.status === 'failed') failed = friendlyError(r.error, 'A voice note was not accepted. Try again.');
```

Fallbacks: a call site keeps its own fallback when it is already plain ("Try again.", "Check your connection and try
again.", "Turn on GPS and try again.", "Could not play this voice memo." and so on). These were rewritten:

| Old fallback | New fallback | Where |
|---|---|---|
| 'Unknown error' (18 sites), 'Failed' (41), 'Failed.' (5), 'Action failed.' (`qhpReview.tsx`, `ReviewSheet`) | 'Something went wrong. Please try again.' | everywhere |
| 'Failed to resubmit.' | 'Could not resubmit. Please try again.' | `qhpAlerts.tsx`, `ResubmitSheet` |
| 'Failed to delete fee' | 'Could not delete the fee. Please try again.' | `adminTools.tsx`, `AdminTrainerFees` |
| 'Delete failed' | 'Could not delete this. Please try again.' | `doctor.tsx`, `DoctorRoster` |
| 'Failed to log session' | 'Could not log the session. Please try again.' | `doctorSessions.tsx`, `PhysioSessionSheet` |
| 'Generation failed.' | 'Could not generate this. Please try again.' | `qhpAssessmentDetail.tsx`, `GeneratePdfModal` |
| 'Finalize failed.' | 'Could not finalize this. Please try again.' | `qhpAssessmentDetail.tsx`, `GeneratePdfModal` |

The import: `import { friendlyError } from '../lib/friendlyError';` in screens and components, `'./friendlyError'`
inside `src/lib`. Put it after the LAST complete import statement. On 26 Oct the codemod put it after the first line
of a multi-line import in 41 files, which does not compile, and a type-check piped into another command hid the
failure (fixed in de8c438):
```ts
// wrong (2fbbe30, trainer.tsx)
import {
import { friendlyError } from '../lib/friendlyError';
  Serif, Body, Mono, Card, StatCard, QuickAction, IconChip, GradientButton, ProgressBar, Pill, Avatar, AvatarPhoto, CountUp,
} from '../components/primitives';
// right (de8c438, academyCalendar.tsx)
import {
  useAcademyBatches, useAcademyUsers, useSetBatchTeachers, prettyDate, AcademyBatch,
} from '../lib/academyQueries';
import { friendlyError } from '../lib/friendlyError';
```
Run `npx tsc --noEmit`, then read its exit code on its own (`echo $?`), never through a pipe. The same commit also fixed
`essentialsCancelledAlert.tsx` (uid from `useAuth().session?.user?.id`); `ios-essentials-cancellations-handoff.md`
already covers that.

Where Android has the calls (`friendlyError(` calls added by 2fbbe30, per file; 218 calls in 59 files, which include the
hand-written display lines of section 3.5):
components/PaidCancelCodeStep.tsx 1, components/QhpVoiceMemo.tsx 1, components/SessionVoice.tsx 3,
components/VoiceNote.tsx 3, components/qhpAlerts.tsx 1, components/qhpRefreshPending.tsx 1, screens/academy.tsx 6,
screens/academyApproval.tsx 2, screens/academyCalendar.tsx 1, screens/academyTeacher.tsx 1,
screens/adminCertifications.tsx 2, screens/adminChurn.tsx 2, screens/adminClientDetail.tsx 5,
screens/adminClients.tsx 1, screens/adminIncidents.tsx 1, screens/adminPerformance.tsx 2, screens/adminRenewals.tsx 2,
screens/adminRequests.tsx 14, screens/adminRevenueForecast.tsx 5, screens/adminTools.tsx 4, screens/adminUsers.tsx 2,
screens/coach.tsx 2, screens/consultantCalls.tsx 1, screens/consultantProfile.tsx 1, screens/crm.tsx 5,
screens/crmBirthdays.tsx 1, screens/crmClientDetail.tsx 15, screens/crmDistribution.tsx 1,
screens/crmIncentivesPanel.tsx 1, screens/crmJourney.tsx 1, screens/crmQhp.tsx 2, screens/crmRevenueForecast.tsx 1,
screens/crmRoster.tsx 8, screens/crmSales.tsx 4, screens/crmService.tsx 3, screens/crmTabs.tsx 3,
screens/crmTasks.tsx 4, screens/doctor.tsx 6, screens/doctorClientDetail.tsx 13,
screens/doctorRehabRecommendation.tsx 1, screens/doctorSessions.tsx 2, screens/incentives.tsx 1,
screens/managerChat.tsx 18, screens/marketing.tsx 1, screens/messenger.tsx 11, screens/nucleus.tsx 1,
screens/ops.tsx 2, screens/opsEscalations.tsx 2, screens/opsLeads.tsx 16, screens/opsSalesTracker.tsx 3,
screens/qhpAssessmentDetail.tsx 2, screens/qhpAssessmentForm.tsx 1, screens/qhpNavigation.tsx 1,
screens/qhpReview.tsx 1, screens/referrals.tsx 1, screens/techDesk.tsx 6, screens/techDeskInbox.tsx 3,
screens/therapist.tsx 2, screens/trainer.tsx 11.

### 3.5 Waiting to Sync and the workout form: translate at render, never before storing
The outbox item keeps the server's raw text in `error`, and these readers parse that raw text:
- `isPlanLimitError` / `planLimitText` (`src/lib/planGate.ts`) look for `PLAN_LIMIT` and show the sentence after it;
- `isOtpGateError` (`src/lib/sessionOtp.ts`) looks for `OTP_NOT_VERIFIED`; the Retry now button then opens the Session
  code sheet first;
- `failedVerifyReasonFor` / `verifyFailureReason` read `OTP_VERIFY_FAILED:<reason>` from a refused saved code;
- `isTransientError` (`src/lib/offline.ts`) decides "retry later" or "failed" from the same text.

`friendlyError` strips the `PLAN_LIMIT:` prefix and maps codes to generic lines, so a translated string would break
every one of them. So `offline.ts` stores the raw text, unchanged. `isTransientError` and the `submitItem` catch,
Android now:
```ts
/* True for connectivity failures (retry later); false for real server rejections. */
function isTransientError(e: any): boolean {
  if (isTimeoutError(e)) return true; // a stalled request is retried, never marked failed
  const msg = String(e?.message ?? e ?? '');
  // The server's plan limit (22 Oct 2026) is a real refusal. Its sentence carries the client's name, which must
  // never be read as a network word below, so it is settled first.
  if (/PLAN_LIMIT/.test(msg)) return false;
  return /network request failed|network error|failed to fetch|fetch failed|timeout|timed out|abort|socket|ENOTFOUND|ECONN/i.test(msg);
}
```
```ts
} catch (e: any) {
  if (isTransientError(e)) {
    items = items.map((i) => (i.id === id ? { ...i, status: 'pending' as const, attempts: i.attempts + 1 } : i));
    await persist();
    return { status: 'queued' };
  }
  const msg = String(e?.message ?? e);
  items = items.map((i) => (i.id === id ? { ...i, status: 'failed' as const, attempts: i.attempts + 1, error: msg } : i));
  await persist();
  return { status: 'failed', error: msg };
}
```
(The drain loop and `flushSavedOtps` store `String(e?.message ?? e)` the same way.) Never call `friendlyError` in
`offline.ts`, `processItem`, `flushSavedOtps` or a submit function the outbox replays, and never store its output in an
outbox item.

The display points translate, each after the session code and plan limit checks have run on the raw text:

(a) `src/screens/trainer.tsx`, `RosterCard`, the line under a queued log on a roster card (was `{queued.error}`):
```tsx
{queued.status === 'failed' && queued.error ? <Body style={{ fontSize: 10.5, color: '#E0A090', marginTop: 2 }} numberOfLines={2}>{friendlyError(queued.error)}</Body> : null}
```
(b) `trainer.tsx`, `Dashboard`, the Waiting to Sync sheet (the `outboxOpen` Modal), the reason line of each failed item
(the last branch was `: o.error}`):
```tsx
{failed && o.error ? (
  <Body style={{ fontSize: 11, color: '#E0A090' }} numberOfLines={3}>{isOtpGateError(o.error) ? workoutOtpErrorText(failedVerifyReasonFor(outboxAll, (o.payload as WorkoutLogOutboxPayload)?.scheduleSessionId)) : isPlanLimitError(o.error) ? planLimitText(o.error) : friendlyError(o.error)}</Body>
) : null}
```
(c) `trainer.tsx`, `Workout`, `submit`, after `submitItem(itemId)` answers `failed` (the last branch was
`(res.error ?? 'The server rejected this log.')`):
```ts
} else {
  // Server rejection: stays safely queued on this device, shown on Home.
  setSyncError(isOtpGateError(res.error) ? workoutOtpErrorText(failedVerifyReasonFor(getOutboxMine(), workoutScheduleId)) : isPlanLimitError(res.error) ? planLimitText(res.error) : friendlyError(res.error, 'This log was not accepted. Check it and try again.'));
  if (editingOutboxId) set({ editingOutboxId: null });
}
```
`syncError` is shown as it is in the red box under the form (`<Body style={{ fontSize: 11.5, color: '#E0A090' }}>{syncError}</Body>`).
Android passes `getOutboxMine()` here since 2 Nov (see `ios-workout-form-smooth-handoff.md`); on 26 Oct it was
`outboxAllW`. Keep whatever your file passes; only the last branch changes.

(d) The same idea in `src/screens/managerChat.tsx`, `ManagerChat`, `sendPlan`: the raw roster error is kept in
`syncError` and translated only in the alert:
```ts
if (error) syncError = error.message;
} catch (err: any) { syncError = String(err?.message ?? err); }
Alert.alert('Roster not saved', `${friendlyError(syncError)}\n\nThe plan still goes to the chat, but no roster sessions were saved.`);
```

### 3.6 Hard-coded technical lines that were rewritten (2fbbe30)
Search your copy for the old text and replace it with the new one.

| File, function | Old text | New text |
|---|---|---|
| `src/lib/withTimeout.ts`, `TimeoutError` | The request timed out `\u2014` check your connection and try again. | This took too long. Check your connection and try again. |
| `withTimeout.ts`, `withTimeout` (with a label) | `${label}` timed out `\u2014` check your connection and try again. | `${label}` took too long. Check your connection and try again. |
| `src/screens/adminRevenue.tsx`, `Gate` (revenue password, timeout) | Verification timed out `\u2014` check your connection and try again. | Verification took too long. Check your connection and try again. |
| `trainer.tsx`, `Workout`, the edit-a-queued-log effect, alert "Already synced" | This workout synced to the server while it was queued `\u2014` saved logs can no longer be edited. | This workout was already saved while it was waiting. A saved log cannot be edited any more. |
| `trainer.tsx`, `Workout`, `submit` (edit in place, `!updated`), alert "Already synced" | This workout already reached the server `\u2014` saved logs can no longer be edited. | This workout is already saved. A saved log cannot be edited any more. |
| `trainer.tsx`, `Workout`, `submit`, sync error fallback | The server rejected this log. | This log was not accepted. Check it and try again. |
| `src/components/SessionVoice.tsx`, `SessionVoiceSheet` | The server rejected this note. | This note was not accepted. Try again. |
| `doctorSessions.tsx`, `PhysioSessionSheet`; `therapist.tsx`, `AddTherapySessionSheet` | The server rejected a voice note. | A voice note was not accepted. Try again. |
| `managerChat.tsx`, `ManagerChat`, `sendPlan` | title "Roster sync failed", body `${syncError}` + "The plan still posts to the chat, but NO roster sessions were saved." | title "Roster not saved", body `${friendlyError(syncError)}` + "The plan still goes to the chat, but no roster sessions were saved." |
| `src/lib/offline.ts`, `submitItem` | This entry was queued by a different account. | This entry was saved under a different account and cannot be sent from this one. |
| `src/lib/sessionVoiceQueries.ts`, `submitSessionVoiceNote` | Session not found yet (timeout, retrying) | The session is still being saved. This note will be sent again shortly. |
| `src/lib/clientHealthSummaryQueries.ts`, `friendlyListenError` | The listen trail is not set up on the server yet. | Listening is not set up on the server yet. Tell the tech team. |
| `src/lib/doctorQueries.ts`, `useSeniorDashboard` | Failed to load senior physio dashboard | Could not load the senior physio dashboard. Pull to refresh. |
| `doctorQueries.ts`, `useGenerateCounsellingAI` | AI analysis returned no content | The AI analysis came back empty. Try again. |

Two of these change behaviour, not only words:
- `submitSessionVoiceNote`: the old text was retried because `isTransientError` matched the word "timeout" in it. The
  new text has no such word, so the error is named `TimeoutError`, which keeps the note queued and retried. Copy the
  line exactly, name included:
```ts
if (/Session not found yet/i.test(String(e?.message ?? ''))) { const retry = new Error('The session is still being saved. This note will be sent again shortly.'); retry.name = 'TimeoutError'; throw retry; }
```
- `describeGrabError` (`src/lib/essentialsAuction.ts`, Essentials auction): it matched the old timeout words, so the
  new ones were added (same sentence shown):
```ts
if (/timed out|timeout|took too long/i.test(clean)) return 'The bid took too long. Pull to refresh to see whether it went through, then try again.';
```
  (was `if (/timed out|timeout/i.test(clean)) ...`).

### 3.7 Server sentences shown before `friendlyError`
- `codedSentence` (`src/lib/approvalRequests.ts`, 2 Nov 2026, commit 2aa0a9d). Some approval and Session code refusals
  carry the 42501 code, which `friendlyError` turns into its "You are not allowed to do this ..." line, so those
  screens read the server's sentence first:
```ts
/** The plain sentence of an approval / Session code server error ("APPROVAL_OWN_REQUEST: You cannot review your
    own request."). Some of them carry the 42501 "not allowed" code, which friendlyError turns into its generic
    line; these screens show the server's own sentence first and fall back to friendlyError otherwise. */
export const codedSentence = (e: unknown): string | null => {
  const msg = String((e as { message?: unknown } | null)?.message ?? '').trim();
  const m = msg.match(/^(?:OTP|APPROVAL)_[A-Z_]+:\s*(.+)$/s);
  return m && m[1].trim() ? m[1].trim() : null;
};
```
  Used as `codedSentence(e) ?? friendlyError(e, '<fallback>')`, for example (`src/components/sessionCodeApproval.tsx`,
  the Session code off request):
```ts
onError: (e) => Alert.alert("Couldn't send the request", (codedSentence(e) ?? friendlyError(e, 'Try again.'))),
```
  It belongs to the approval requests feature (Session code switch on the CRM client page, Pending Approvals for the
  doctors' manager), which has no iOS handoff yet. Nothing to do now if iOS does not have those screens; port it with
  them. Android's `tests/rules/approval_requests_test.js` checks: "OTP_OFF_NEEDS_APPROVAL: Turning off the Session code
  needs the doctors manager's approval. Send a request from the client page." (42501) shows the sentence after the
  colon; "APPROVAL_OWN_REQUEST: You cannot review your own request." (42501) shows "You cannot review your own
  request."; "Failed to fetch" still shows "No connection. Check your internet and try again."; a plain row-level
  security 42501 still shows the "not allowed" line.
- The manager's Add Session on My Crew (`managerChat.tsx`, `ManagerChat`, the add save) translates first and then picks
  the title from the translated sentence (from `ios-plan-cover-handoff.md` section 8.2; it needs the 30 Oct fix, or the
  "plan ran out" sentence never arrives):
```ts
if (error) { const msg = friendlyError(error); Alert.alert(isPlanCoverRefusal(msg) ? 'Plan expired' : 'Add failed', msg); return; }
```

### 3.8 Find what is left (run in the iOS repo root)
Android's verify recipe (alerts and `setErr` / `setError` lines):
```sh
grep -rnE "Alert\.alert\([^)]*\b(e|err|error)\??\.message|set(Err|Error)\((e|err|error)\??\.message" src
```
A wider sweep (any setter, any alert, the rest of the line), minus lines already converted:
```sh
grep -rnE "Alert\.alert\([^;]*\b(e|err|error|ex)\??\.message|set[A-Z][A-Za-z]*\([^;]*\b(e|err|error|ex)\??\.message" src | grep -v "friendlyError("
```
Raw outbox reasons in JSX, and the old hard-coded texts:
```sh
grep -rnE "(\{|: )(o|queued|item|it|res|r)\.error\}" src
grep -rnE "timed out|synced to the server|already reached the server|listen trail|returned no content|queued by a different account|timeout, retrying|Roster sync failed|server rejected|Failed to load senior physio" src
```
What Android itself returns today (2 Nov 2026), so you can tell parity from a miss:
- Recipe: 1 line, `src/components/qhpCancellation.tsx`, the Withdraw alert `Alert.alert('Could not withdraw', e?.message ?? 'Try again.')`
  (added on 27 Oct, after the codemod).
- Wider sweep: that line plus 9 that the codemod did not match (setter names it did not know): `src/lib/aiCache.ts`
  `setStatus` (not shown on screen), `src/screens/crm.tsx` `setSchedErr`, `src/screens/crmAi.tsx` the error bubble in
  `setMessages`, `src/screens/crmClientDetail.tsx` two `setMemo` errors, `src/screens/doctor.tsx` `setRepNote`,
  `src/screens/essentialsManager.tsx` two `setNotice`, `src/screens/messenger.tsx` `setDmErr`. These still show the
  raw message on Android; leave them as Android has them unless the owner asks for both apps.
- JSX grep: nothing.
- Old texts grep: only regexes and comments: `friendlyError.ts`, `offline.ts` (`isTransientError`),
  `essentialsAuction.ts`, `trainerQuiz.ts`, `clientQueries.ts`, `qhpNavigationQueries.ts`, `locationLog.ts`, and
  comments that mention "listen trail" or "server rejected" (`clientHealthSummaryCard.tsx`,
  `clientHealthSummaryQueries.ts`, `summaryVoice.ts`, `trainer.tsx`). No user-facing string.

## 4. Check on the iPhone
1. `node tests/rules/friendly_error_test.js`: 30 PASS lines, then `ALL PASS`. `npx tsc --noEmit` then `echo $?`: 0.
2. The four greps in 3.8 return only the lines Android also returns.
3. Turn on airplane mode (Wi-Fi off too). Open a client page and save goals (or any save that needs the server): the
   alert keeps its title and the body reads "No connection. Check your internet and try again." (or "This took too
   long. Check your connection and try again." if the request hung). Never "Network request failed".
4. Settings, Developer, Network Link Conditioner, profile "100% Loss", enabled. Repeat a save: after a wait (20 seconds
   or more) one of the two sentences above, never a raw text. Turn the conditioner off afterwards.
5. Waiting to Sync. Log a workout offline, then go online: it syncs as before. If you have a refused log at hand (a
   client with no approved plan and 3 plan-less sessions, or a Session code member with no verified code), its red
   reason line on Home and on the roster card reads the plan limit sentence or "Session code not verified. Verify the
   member's 4-digit code from Today's Roster, then save again.", and Retry now still opens the Session code sheet first.
   "Something went wrong" or the "not allowed" line there means the text was translated before it was stored.
6. Record a voice note in Add Workout and save on a slow network: the note stays queued and is sent later; it is not
   marked "Sync failed".
7. As a manager, My Crew, Add Session for a client whose plan ran out (see `ios-plan-cover-handoff.md` 8.4): the alert
   is titled "Plan expired" and shows the server's sentence word for word. This writes to the real roster when the
   server accepts it, so use a client whose plan has really run out.

## Not confirmed
- `isTransientError` (`offline.ts`) was not changed and does not match "took too long". A `TimeoutError` re-wrapped as
  `new Error(error.message)` inside an outbox submit loses its name and would now be marked failed instead of retried.
  On Android the voice note upload is covered by the outbox's own 45 second Sync deadline (shorter than the 60 second
  upload deadline); the other outbox paths were not checked one by one.
- Whether the error screen `ScreenErrorBoundary` (`src/components/errorBoundary.tsx`), which still prints the raw render
  error in small mono text under "This screen hit a snag", is meant to stay raw. Android did not convert it.
- The Android build number that first carries the 30 Oct E-word fix is not recorded (the feature doc says "next build"
  after 5.2 (43)).
- File and function names are taken from Android; line positions in the iOS files will differ.
