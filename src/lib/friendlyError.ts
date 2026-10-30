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
  s.replace(/^[A-Z][A-Z0-9_]{3,}:\s*/, '').replace(/\s[—–-]\s/g, ', ').replace(/\s+/g, ' ').trim();

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
