# Odds AI — deploy checklist (one-time, ~2 minutes)

The app side is fully built. Only the AI proxy edge function needs deploying.
**Model: Gemini 2.5 Flash, always.** No new API key is needed — the function
uses whichever of these secrets the project already has, in order:

1. `GEMINI_API_KEY` → Google Gemini direct, model `gemini-2.5-flash`
2. `LOVABLE_API_KEY` → Lovable AI gateway, model `google/gemini-2.5-flash` —
   Lovable-managed projects usually have this already (it's what the existing AI
   functions like generate-qhp-report use)

Optional: `AI_MODEL` secret overrides the model name (e.g. `gemini-2.5-pro`).

## 1. Deploy the function
Supabase dashboard (project `agtjszjedaenclbzgjvi`) → **Edge Functions → Deploy new function**:
- Name: `odds-ai-chat` (must match exactly)
- Paste the contents of `supabase/functions/odds-ai-chat/index.ts`
- **Leave "Verify JWT" ON** (the default). Do NOT disable it — the app calls it
  with the signed-in user's token, same as generate-qhp-report.

## 2. Check a key exists (usually nothing to do)
Edge Functions → **Secrets**: if `LOVABLE_API_KEY` or `GEMINI_API_KEY` is listed,
you are done. Only if NEITHER exists, add `GEMINI_API_KEY` (Google AI Studio →
Get API key).

## 3. Smoke test
Sign in to the app as a CRM → Dashboard → **Odds AI** card → ask
"Which clients have fewer than 3 sessions left?"

Expected first-use flow: the header shows "Updating client data…" once
(first sync, a few seconds), then answers arrive grounded in that CRM's clients.
The function's response includes which route/model answered (`provider`, `model`)
if you ever need to check.

## Troubleshooting
- "No AI key configured..." → step 2: neither secret name exists yet.
- HTTP 401 on invoke → function deployed with Verify JWT off/on mismatch; redeploy
  with Verify JWT ON.
- "context required (client data cache is empty)" → the sync hasn't run; tap the
  refresh icon in the Odds AI header.
- 429 from the provider → rate limit; wait a minute or raise the key's quota.
