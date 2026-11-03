# iOS handoff: Create Plan entry (AI generated / Manual plan), automatic charge after the draft, negative wallet (3 Nov 2026)

Plan with every decision: docs/create-plan-entry-plan.md. The server part (migration 20261103110000) is shared; iOS
builds nothing on the server. Replaces the "bill sheet with Deduct" rule of the 2 Nov Team Wallet handoff (card 10):
the AiBillSheet now serves only a bill from before this change.

## 1. What the user sees
- Client page > Plan tab > Create Plan opens the chooser with two cards: **AI generated** and **Manual plan**.
- The AI card carries a chip and a line with the trainer's standing for THIS client, before anything is generated:
  "2 FREE LEFT" + "2 free AI plans left. After that Rs 30 to 50 a plan from your wallet." / "FREE FOR ESSENTIALS" +
  "Free for Essentials clients." / "RS 33" + "Rs 33 from your wallet · balance Rs 28" / "ADD FUNDS" (red) + "Your wallet
  is at Rs -5. Add funds to make the next plan with Odds AI."
- Tapping AI generated: opens the AI builder, unless the balance is **negative**: then the popup **"Add funds"** with the
  sentence above and the buttons **Build manually** (opens the manual builder) and **Add money** (opens the Wallet).
  A balance below the price never blocks.
- In the AI builder the Generate button reads "Generate workout plan for Rs 33" (billed) or "Generate workout plan"
  (free); the hint under it: "Deducted from your wallet after the draft is made. The draft always lands." After the
  draft, a line: "Rs 33 deducted. Wallet Rs -5." (red when negative, green otherwise). No bill sheet, no Deduct tap.
- Wallet screen: a negative balance is red ("Rs -5"), the sentence under it, the top button reads **Add funds**; the
  next top-up clears the negative first (Rs 500 at Rs -5 shows Rs 495).
- Never below minus one plan's price (Rs -50): the server refuses a second charge while negative; the draft still lands.

## 2. Data / server contract (migration 20261103110000; the owner runs it)
- `team_wallet_ai_plan_gate(p_user, p_essentials, p_client)` → adds `bill_paise` (the exact bill for the client when
  billed), `negative`, `line`; `ok` is false only for `WALLET_NEGATIVE` or `WALLET_BILL_PENDING` (old bills);
  `floor_paise` is 0 now. The 2-argument version is gone (the app never calls it directly).
- `team_wallet_charge_ai_plan(user, client, name, draft_ref, preview)` → `{tx_id, bill_paise, blocks, balance_paise,
  negative, row}`: one PAID ai_plan row after the draft; refuses `WALLET_NEGATIVE: Your wallet is at Rs -5. Add funds
  to make the next plan with Odds AI.` while the balance is below zero.
- `ai-plan-draft` draft answer for a billed trainer: the draft as always plus `wallet: { charged: true, charged_paise,
  balance_paise, negative, tx_id, free_left: 0, free_total }`; when the charge was refused or failed: the draft plus
  `wallet: { charged: false, charged_paise: 0, balance_paise, negative, error }`. A free draft: `wallet: { free: true,
  essentials, free_left, free_total }` (unchanged). The `{ bill, preview }` answer is sent only while the migration is
  not run (fallback to the 2 Nov design).
- `get_my_team_wallet` adds `negative` and `negative_line`; `ai_floor_paise` is 0.
- Constraint `team_wallet_ai_floor`: `balance_after_paise >= -5000` on ai_plan rows.

## 3. Code to port (diff hunks of the Android tree, `git diff -U4`)
```diff
diff --git a/src/components/AiPlanAssistant.tsx b/src/components/AiPlanAssistant.tsx
index 17b3033..7acfe5f 100644
--- a/src/components/AiPlanAssistant.tsx
+++ b/src/components/AiPlanAssistant.tsx
@@ -13,9 +13,9 @@ import { Body, Mono, Serif } from './primitives';
 import { trackEvent } from '../lib/amplitude';
 import { useAiPlanDraft } from '../lib/aiPlanQueries';
 import { SPLITS, splitOf, aiPromptLine, sourcesLine, draftExerciseCount, draftNewExercises, type AiPlanPreview, type AiPlanResult, type SplitKey } from '../lib/aiPlanDraft';
 import { useStore } from '../store';
-import { walletCardState, rupees } from '../lib/teamWallet';
+import { walletCardState, rupees, afterChargeLine } from '../lib/teamWallet';
 import { AiBillSheet, type AiBillTarget } from './AiBillSheet';
 
 const AI = '#A78BFA';
 const STEPS = ['Reading the QHP', 'Checking blood markers and medical history', 'Picking exercises from the Odds library', 'Setting sets, reps and rest', 'Checking every exercise against the library'];
@@ -30,20 +30,24 @@ export function AiPlanAssistant({ clientId, clientName, preview, onApply }: {
 }) {
   const draftM = useAiPlanDraft();
   const { go } = useStore();
   const [open, setOpen] = React.useState(true);
-  /* Team Wallet (2 Nov 2026): a trainer's draft is held behind a bill of Rs 30 to 50 until Deduct from wallet.
-     The panel shows the wallet line, refuses Generate under Rs 50 or while a bill waits, and opens the bill sheet
-     after the draft (or for the waiting bill the preview reports). */
+  /* Team Wallet (2 Nov 2026, charge rule revised 3 Nov 2026): after the 3 free plans a trainer's draft is charged
+     automatically the moment it is made (Rs 30 + Rs 5 per data block, cap Rs 50); the balance may go negative, and
+     only a negative balance blocks the next one. The panel shows the standing line, the Generate button names the
+     price, and after the draft a line says what was deducted. The bill sheet survives only for a bill from before
+     the rule change (the server still reports it as pending). */
   const [bill, setBill] = React.useState<AiBillTarget>(null);
   const [billNote, setBillNote] = React.useState<string | null>(null);
+  const [charged, setCharged] = React.useState<{ text: string; tone: 'red' | 'green' } | null>(null);
   const wallet = walletCardState(preview.wallet);
   const pendingBill = preview.wallet?.pending_bill ?? null;
   const openPendingBill = () => {
     if (!pendingBill || !preview.wallet) return;
     setBill({ tx_id: pendingBill.tx_id, bill_paise: pendingBill.bill_paise, balance_paise: preview.wallet.balance_paise, preview: pendingBill.preview, clientName: pendingBill.client_name ?? clientName });
   };
-  const walletBlocks = wallet.state === 'floor' || wallet.state === 'bill_pending';
+  const walletBlocks = wallet.state === 'negative' || wallet.state === 'bill_pending';
+  const priceLabel = preview.wallet?.billed && preview.wallet.bill_paise != null ? ` for ${rupees(preview.wallet.bill_paise)}` : '';
   const [split, setSplit] = React.useState<SplitKey | null>(null);
   const [note, setNote] = React.useState('');
   const [result, setResult] = React.useState<AiPlanResult | null>(null);
   const [step, setStep] = React.useState(0);
@@ -74,9 +78,13 @@ export function AiPlanAssistant({ clientId, clientName, preview, onApply }: {
         return;
       }
       const r = a.result;
       setResult(r);
-      trackEvent('AI Plan Generated', { client_id: clientId, split, model: r.model, exercises: draftExerciseCount(r.draft), not_in_db: draftNewExercises(r.draft).length, dropped: r.dropped.length });
+      // 3 Nov 2026: what the wallet did for this draft (charged after the draft; the draft lands either way).
+      if (r.wallet?.charged) setCharged(afterChargeLine(r.wallet.charged_paise, r.wallet.balance_paise));
+      else if (r.wallet?.error) setCharged({ text: `Not charged: ${r.wallet.error}`, tone: 'red' });
+      else setCharged(null);
+      trackEvent('AI Plan Generated', { client_id: clientId, split, model: r.model, exercises: draftExerciseCount(r.draft), not_in_db: draftNewExercises(r.draft).length, dropped: r.dropped.length, charged_paise: r.wallet?.charged_paise ?? 0 });
       onApply(r, aiPromptLine(r.draft.split_label || splitOf(split)?.label || split, note));
     } catch (e: any) {
       trackEvent('AI Plan Generate Failed', { client_id: clientId, split, error: String(e?.message ?? e).slice(0, 120) });
     }
@@ -171,15 +179,16 @@ export function AiPlanAssistant({ clientId, clientName, preview, onApply }: {
             style={{ borderRadius: 14, overflow: 'hidden', opacity: !split || walletBlocks ? 0.5 : 1 }}>
             <LinearGradient colors={['#8B5CF6', '#6D28D9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 }}>
               {draftM.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="sparkle" size={15} color="#fff" strokeWidth={2.2} />}
               <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: '#fff' }}>
-                {draftM.isPending ? `Drafting… ${secs}s` : !split ? 'Choose a split first' : result ? 'Generate again' : 'Generate workout plan'}
+                {draftM.isPending ? `Drafting… ${secs}s` : !split ? 'Choose a split first' : result ? `Generate again${priceLabel}` : `Generate workout plan${priceLabel}`}
               </Text>
             </LinearGradient>
           </Pressable>
           {draftM.isPending ? <Body style={{ fontSize: 11, color: AI, textAlign: 'center' }}>{STEPS[step]}…</Body> : null}
           {draftM.error && !draftM.isPending ? <Body style={{ fontSize: 11.5, color: C.red }}>{(draftM.error as Error).message.replace(/^WALLET_[A-Z_]+:\s*/, '')}</Body> : null}
-          {wallet.state === 'ok' && !result ? <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center' }}>Rs 30 to 50 a draft, shown after it is made. Deduct in one tap or discard it.</Body> : null}
+          {wallet.state === 'ok' && !result ? <Body style={{ fontSize: 10.5, color: C.muted3, textAlign: 'center' }}>Deducted from your wallet after the draft is made. The draft always lands.</Body> : null}
+          {charged ? <Body style={{ fontSize: 11.5, color: charged.tone === 'red' ? '#FF9B8F' : C.green, textAlign: 'center' }}>{charged.text}</Body> : null}
 
           {result && !draftM.isPending ? (
             <View style={{ gap: 9, padding: 12, borderRadius: 14, backgroundColor: hexA(C.green, 0.07), borderWidth: 1, borderColor: hexA(C.green, 0.3) }}>
               <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
diff --git a/src/lib/aiPlanDraft.ts b/src/lib/aiPlanDraft.ts
index ee61e9b..f4bc235 100644
--- a/src/lib/aiPlanDraft.ts
+++ b/src/lib/aiPlanDraft.ts
@@ -46,9 +46,11 @@ export type AiPlanSources = {
 };
 /** wallet (Team Wallet, 2 Nov 2026): does the caller pay for drafts (trainers), the balance and a waiting bill;
     null while the wallet is not on the server. */
 export type AiPlanPreview = { eligible: boolean; allowed: boolean; essentials: boolean; client_name: string; sources: AiPlanSources; model: string; wallet: WalletGate | null };
-export type AiPlanResult = { draft: AiPlanDraft; dropped: string[]; sources: AiPlanSources; model: string; generated_at: string };
+/** wallet (3 Nov 2026): what the server charged for this draft (trainers after their free plans); the draft always lands. */
+export type AiDraftCharge = { charged: boolean; charged_paise: number; balance_paise: number; negative: boolean; free_left: number | null; error: string | null };
+export type AiPlanResult = { draft: AiPlanDraft; dropped: string[]; sources: AiPlanSources; model: string; generated_at: string; wallet?: AiDraftCharge | null };
 
 const str = (v: unknown) => (v == null ? '' : String(v));
 
 /** One draft set as the form's strings (load stays empty: the trainer sets kilograms in the session). */
diff --git a/src/lib/teamWallet.ts b/src/lib/teamWallet.ts
index 76349b3..5c4e232 100644
--- a/src/lib/teamWallet.ts
+++ b/src/lib/teamWallet.ts
@@ -35,8 +35,11 @@ export type TeamWalletRead = {
   today_room_paise: number;
   min_topup_paise: number;
   daily_cap_paise: number;
   ai_floor_paise: number;
+  /** 3 Nov 2026: the balance is below zero (an AI plan took it there); the owner's sentence for the screen. */
+  negative: boolean;
+  negative_line: string | null;
   charges_ai: boolean;
   free_total: number;
   free_used: number;
   free_left: number;
@@ -47,10 +50,12 @@ export type TeamWalletRead = {
     Free drafts (owner, 2 Nov 2026): a trainer's first 3 AI plans for non-Essentials clients are free (free_left), an
     Essentials client is always free; free_this = this draft costs nothing, billed = the bill sheet will follow. */
 export type WalletGate = {
   charges: boolean; balance_paise: number; floor_paise: number;
+  /** 3 Nov 2026: the balance is below zero (only this blocks a paid draft), and the exact bill for the client asked about. */
+  negative: boolean; bill_paise: number | null; line: string | null;
   free_total: number; free_used: number; free_left: number; essentials: boolean; free_this: boolean; billed: boolean;
-  pending_bill: PendingBill | null; ok: boolean; reason: 'WALLET_FLOOR' | 'WALLET_BILL_PENDING' | null;
+  pending_bill: PendingBill | null; ok: boolean; reason: 'WALLET_FLOOR' | 'WALLET_BILL_PENDING' | 'WALLET_NEGATIVE' | null;
 };
 export const FREE_DRAFTS = 3;
 export type AiBill = { tx_id: string; bill_paise: number; balance_paise: number; blocks: string[] };
 export type Tone = 'green' | 'amber' | 'red' | 'grey';
@@ -120,9 +125,11 @@ export const parseWalletRead = (d: any): TeamWalletRead => ({
   today_topup_paise: num(d?.today_topup_paise),
   today_room_paise: num(d?.today_room_paise, DAILY_CAP_PAISE),
   min_topup_paise: num(d?.min_topup_paise, MIN_TOPUP_PAISE),
   daily_cap_paise: num(d?.daily_cap_paise, DAILY_CAP_PAISE),
-  ai_floor_paise: num(d?.ai_floor_paise, AI_FLOOR_PAISE),
+  ai_floor_paise: num(d?.ai_floor_paise, 0),
+  negative: d?.negative === true || num(d?.balance_paise) < 0,
+  negative_line: d?.negative_line ? String(d.negative_line) : num(d?.balance_paise) < 0 ? negativeBalanceLine(num(d?.balance_paise)) : null,
   charges_ai: d?.charges_ai === true,
   free_total: num(d?.free_total, FREE_DRAFTS),
   free_used: num(d?.free_used),
   free_left: num(d?.free_left),
@@ -130,15 +137,17 @@ export const parseWalletRead = (d: any): TeamWalletRead => ({
   rows: (Array.isArray(d?.rows) ? d.rows : []).map(parseWalletRow).filter(Boolean) as WalletRow[],
 });
 export const parseWalletGate = (w: any): WalletGate | null => {
   if (!w || typeof w !== 'object') return null;
-  const reason = w.reason === 'WALLET_FLOOR' || w.reason === 'WALLET_BILL_PENDING' ? w.reason : null;
+  const reason = w.reason === 'WALLET_FLOOR' || w.reason === 'WALLET_BILL_PENDING' || w.reason === 'WALLET_NEGATIVE' ? w.reason : null;
   const charges = w.charges === true;
   const free_left = num(w.free_left);
   const essentials = w.essentials === true;
   const free_this = typeof w.free_this === 'boolean' ? w.free_this : !charges || essentials || free_left > 0;
+  const balance_paise = num(w.balance_paise);
   return {
-    charges, balance_paise: num(w.balance_paise), floor_paise: num(w.floor_paise, AI_FLOOR_PAISE),
+    charges, balance_paise, floor_paise: num(w.floor_paise, 0),
+    negative: w.negative === true || balance_paise < 0, bill_paise: w.bill_paise == null ? null : num(w.bill_paise), line: w.line == null ? null : String(w.line),
     free_total: num(w.free_total, FREE_DRAFTS), free_used: num(w.free_used), free_left, essentials, free_this,
     billed: typeof w.billed === 'boolean' ? w.billed : charges && !free_this,
     pending_bill: parsePendingBill(w.pending_bill), ok: w.ok !== false && !reason, reason,
   };
@@ -239,21 +248,39 @@ export const billPreviewLine = (p: BillPreview | null | undefined): string => {
   if (!p) return '';
   const n = p.sections.length;
   return `${n} section${n === 1 ? '' : 's'}, ${p.exercise_count} exercise${p.exercise_count === 1 ? '' : 's'}`;
 };
-export type WalletCardState = 'free' | 'essentials' | 'free_left' | 'ok' | 'floor' | 'bill_pending' | 'unknown';
+export type WalletCardState = 'free' | 'essentials' | 'free_left' | 'ok' | 'negative' | 'bill_pending' | 'unknown';
 /** "3 free AI plans left" / "1 free AI plan left" */
 export const freeLeftLine = (n: number): string => `${n} free AI plan${n === 1 ? '' : 's'} left`;
-/** The Create Plan AI card: what the wallet allows and the line to show. */
+/** "Rs -5" in the owner's form for a balance (rupees() prints "- Rs 5" for amounts). */
+export const balanceText = (paise: number): string => (num(paise) < 0 ? `Rs -${rupees(-num(paise)).slice(3)}` : rupees(paise));
+/** The owner's sentence for a wallet below zero (3 Nov 2026). */
+export const negativeBalanceLine = (balancePaise: number): string => `Your wallet is at ${balanceText(balancePaise)}. Add funds to make the next plan with Odds AI.`;
+/** The Create Plan AI card: what the wallet allows and the line to show. Since 3 Nov 2026 only a negative balance
+    blocks; a balance below the price does not (the plan is charged after the draft and may take the wallet negative). */
 export const walletCardState = (w: WalletGate | null | undefined): { state: WalletCardState; line: string | null; action: 'wallet' | 'bill' | null } => {
   if (!w) return { state: 'unknown', line: null, action: null };
   if (!w.charges) return { state: 'free', line: null, action: null };
   if (w.essentials) return { state: 'essentials', line: 'Free for Essentials clients.', action: null };
   if (w.free_left > 0) return { state: 'free_left', line: `${freeLeftLine(w.free_left)}. After that Rs 30 to 50 a plan from your wallet.`, action: null };
   if (w.pending_bill) return { state: 'bill_pending', line: 'Settle or discard your last draft first.', action: 'bill' };
-  if (w.balance_paise < w.floor_paise) return { state: 'floor', line: `Wallet ${rupees(w.balance_paise)}. You need at least ${rupees(w.floor_paise)} in your wallet to make an AI plan.`, action: 'wallet' };
-  return { state: 'ok', line: `Free AI plans used. Wallet ${rupees(w.balance_paise)}, Rs 30 to 50 a plan.`, action: null };
+  if (w.negative) return { state: 'negative', line: w.line ?? negativeBalanceLine(w.balance_paise), action: 'wallet' };
+  const price = w.bill_paise != null ? rupees(w.bill_paise) : 'Rs 30 to 50';
+  return { state: 'ok', line: `${price} from your wallet · balance ${balanceText(w.balance_paise)}`, action: null };
 };
+/** The chooser card's chip (3 Nov 2026): "2 FREE LEFT" / "FREE FOR ESSENTIALS" / "RS 33" / "ADD FUNDS". */
+export const aiOptionChip = (w: WalletGate | null | undefined): { text: string; tone: Tone } | null => {
+  if (!w || !w.charges) return null;
+  if (w.essentials) return { text: 'FREE FOR ESSENTIALS', tone: 'green' };
+  if (w.free_left > 0) return { text: `${w.free_left} FREE LEFT`, tone: 'green' };
+  if (w.pending_bill) return { text: 'BILL WAITING', tone: 'amber' };
+  if (w.negative) return { text: 'ADD FUNDS', tone: 'red' };
+  return { text: w.bill_paise != null ? rupees(w.bill_paise).toUpperCase() : 'RS 30 TO 50', tone: 'amber' };
+};
+/** After a charged draft: "Rs 33 deducted. Wallet Rs -5." (red when negative). */
+export const afterChargeLine = (chargedPaise: number, balancePaise: number): { text: string; tone: 'red' | 'green' } =>
+  chargedPaise > 0 ? { text: `${rupees(chargedPaise)} deducted. Wallet ${balanceText(balancePaise)}.`, tone: balancePaise < 0 ? 'red' : 'green' } : { text: `Wallet ${balanceText(balancePaise)}.`, tone: balancePaise < 0 ? 'red' : 'green' };
 
 /** The sentence after "WALLET_CODE:" of a server refusal, else null. */
 export const codedWalletSentence = (e: unknown): string | null => {
   const msg = String((e as { message?: unknown } | null)?.message ?? '').trim();
diff --git a/src/lib/teamWalletQueries.ts b/src/lib/teamWalletQueries.ts
index fec249c..6b55e5f 100644
--- a/src/lib/teamWalletQueries.ts
+++ b/src/lib/teamWalletQueries.ts
@@ -111,14 +111,17 @@ export function useVerifyTopup() {
 
 /** The ai-plan-draft answer shape, also what the settle call returns. */
 export const parseAiPlanResult = (d: any): AiPlanResult => {
   if (!d?.draft || !Array.isArray(d.draft.sections)) throw new Error('Odds AI returned no plan. Try Generate again.');
+  const w = d.wallet && typeof d.wallet === 'object' ? d.wallet : null;
   return {
     draft: d.draft,
     dropped: Array.isArray(d.dropped) ? d.dropped : [],
     sources: d.sources ?? null,
     model: String(d.model ?? ''),
     generated_at: String(d.generated_at ?? new Date().toISOString()),
+    // 3 Nov 2026: the charge made for this draft (free drafts answer charged false with the free count left)
+    wallet: w ? { charged: w.charged === true, charged_paise: Number(w.charged_paise) || 0, balance_paise: Number(w.balance_paise) || 0, negative: w.negative === true, free_left: w.free_left == null ? null : Number(w.free_left), error: w.error ? String(w.error) : null } : null,
   };
 };
 /** Deduct from wallet: the bill becomes paid and the held draft comes back. */
 export function useSettleAiBill() {
diff --git a/src/screens/createPlan.tsx b/src/screens/createPlan.tsx
index 733e6d4..3a9d523 100644
--- a/src/screens/createPlan.tsx
+++ b/src/screens/createPlan.tsx
@@ -18,9 +18,9 @@ import { enqueueOutbox, getIsOnline, useIsOnline, getOutbox, updateOutboxItem }
 import { useDragReorder } from '../lib/useDragReorder';
 import { AiPlanAssistant } from '../components/AiPlanAssistant';
 import { useAiPlanPreview } from '../lib/aiPlanQueries';
 import { draftToBodyParts, shouldFill, draftExerciseCount, aiChoice, planSource, type AiPlanResult, type PlanBuildMode } from '../lib/aiPlanDraft';
-import { walletCardState } from '../lib/teamWallet';
+import { walletCardState, aiOptionChip, negativeBalanceLine } from '../lib/teamWallet';
 import { trackEvent } from '../lib/amplitude';
 
 /* ============ CREATE WORKOUT PLAN ============
    Mirrors the web app's Create Workout Plan form end-to-end (client, plan meta,
@@ -251,10 +251,26 @@ export function CreatePlan() {
   const aiPreviewQ = useAiPlanPreview(selectedClientId, !isEdit && isOnline);
   const aiAllowed = !isEdit && aiPreviewQ.data?.allowed === true;
   const [mode, setMode] = React.useState<PlanBuildMode | null>(isEdit ? 'manual' : null);
   const aiPick = aiChoice({ online: isOnline, clientId: selectedClientId, modality, allowed: isEdit ? false : aiPreviewQ.data ? aiPreviewQ.data.allowed : null });
-  // Team Wallet (2 Nov 2026): a trainer pays Rs 30 to 50 a draft; the card says what the wallet allows (the panel holds the buttons).
+  // Team Wallet (2 Nov 2026, rule revised 3 Nov 2026): after the 3 free plans a draft is charged automatically once it is
+  // made; the card shows the standing (free count, the exact price and balance, or ADD FUNDS); only a NEGATIVE balance
+  // blocks, with the owner's popup and a button to the Wallet. A balance below the price never blocks.
   const walletCard = walletCardState(aiPreviewQ.data?.wallet ?? null);
+  const aiChip = aiOptionChip(aiPreviewQ.data?.wallet ?? null);
+  const aiChipColor = aiChip?.tone === 'red' ? C.red : aiChip?.tone === 'amber' ? C.gold : C.green;
+  const chooseAi = () => {
+    if (!aiPick.enabled) return;
+    if (walletCard.state === 'negative') {
+      trackEvent('AI Plan Blocked Negative Wallet', { client_id: selectedClientId, balance_paise: aiPreviewQ.data?.wallet?.balance_paise ?? null });
+      Alert.alert('Add funds', walletCard.line ?? negativeBalanceLine(aiPreviewQ.data?.wallet?.balance_paise ?? 0), [
+        { text: 'Build manually', onPress: () => chooseMode('manual') },
+        { text: 'Add money', onPress: () => go('wallet') },
+      ]);
+      return;
+    }
+    chooseMode('ai');
+  };
   const chooseMode = (m: PlanBuildMode) => {
     setMode(m);
     // An AI draft is a Strength Training plan (it covers the Strength and Cardio days).
     if (m === 'ai' && !modality) setModality('Strength Training');
@@ -502,31 +518,38 @@ export function CreatePlan() {
               <Serif style={{ fontSize: 24 }}>Create Plan</Serif>
               <Body style={{ fontSize: 12.5, color: C.muted, marginTop: 1 }}>How do you want to build {first}'s plan?</Body>
             </View>
           </View>
-          <Pressable onPress={() => chooseMode('ai')} disabled={!aiPick.enabled} hitSlop={6} accessibilityRole="button" accessibilityState={{ disabled: !aiPick.enabled }}
-            style={{ padding: 16, borderRadius: 20, backgroundColor: 'rgba(76,52,140,0.32)', borderWidth: 1, borderColor: hexA('#A78BFA', aiPick.enabled ? 0.55 : 0.25), opacity: aiPick.enabled ? 1 : 0.6, gap: 10 }}>
+          <Pressable onPress={chooseAi} disabled={!aiPick.enabled} hitSlop={6} accessibilityRole="button" accessibilityState={{ disabled: !aiPick.enabled }}
+            style={{ padding: 16, borderRadius: 20, backgroundColor: 'rgba(76,52,140,0.32)', borderWidth: 1, borderColor: hexA(walletCard.state === 'negative' ? C.red : '#A78BFA', aiPick.enabled ? 0.55 : 0.25), opacity: aiPick.enabled ? 1 : 0.6, gap: 10 }}>
             <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
               <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: hexA('#A78BFA', 0.16), borderWidth: 1, borderColor: hexA('#A78BFA', 0.45), alignItems: 'center', justifyContent: 'center' }}>
                 <Icon name="sparkle" size={19} color="#A78BFA" strokeWidth={2} />
               </View>
               <View style={{ flex: 1 }}>
-                <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>Generate with Odds AI</Text>
+                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 }}>
+                  <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>AI generated</Text>
+                  {aiChip ? (
+                    <View style={{ paddingVertical: 2.5, paddingHorizontal: 8, borderRadius: 999, backgroundColor: hexA(aiChipColor, 0.14), borderWidth: 1, borderColor: hexA(aiChipColor, 0.45) }}>
+                      <Text style={{ fontFamily: F.bodyBold, fontSize: 9.5, color: aiChipColor }}>{aiChip.text}</Text>
+                    </View>
+                  ) : null}
+                </View>
                 <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2, lineHeight: 16 }}>Drafts a Strength Training plan from the QHP, medical and blood reports. You edit everything before it goes for review.</Body>
               </View>
               <Icon name="chevRight" size={16} color="#A78BFA" strokeWidth={2.4} />
             </View>
             {aiPick.reason ? <Body style={{ fontSize: 11, color: C.gold }}>{aiPick.reason}</Body> : null}
-            {!aiPick.reason && walletCard.line ? <Body style={{ fontSize: 11, color: walletCard.state === 'ok' ? C.muted2 : C.gold }}>{walletCard.line}</Body> : null}
+            {!aiPick.reason && walletCard.line ? <Body style={{ fontSize: 11, color: walletCard.state === 'negative' ? '#FF9B8F' : walletCard.state === 'ok' ? C.ink3 : C.gold }}>{walletCard.line}</Body> : null}
           </Pressable>
           <Pressable onPress={() => chooseMode('manual')} hitSlop={6} accessibilityRole="button"
             style={{ padding: 16, borderRadius: 20, backgroundColor: 'rgba(50,30,19,0.45)', borderWidth: 1, borderColor: hexA(C.orange, 0.4), gap: 10 }}>
             <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
               <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.4), alignItems: 'center', justifyContent: 'center' }}>
                 <Icon name="dumbbell" size={19} color={C.orange} strokeWidth={2} />
               </View>
               <View style={{ flex: 1 }}>
-                <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>Build it manually</Text>
+                <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#fff' }}>Manual plan</Text>
                 <Body style={{ fontSize: 11.5, color: C.muted2, marginTop: 2, lineHeight: 16 }}>The plan builder as it is today: modality, sections, exercises and sets.</Body>
               </View>
               <Icon name="chevRight" size={16} color={C.orange} strokeWidth={2.4} />
             </View>
diff --git a/src/screens/wallet.tsx b/src/screens/wallet.tsx
index 905263e..bb2ada9 100644
--- a/src/screens/wallet.tsx
+++ b/src/screens/wallet.tsx
@@ -13,9 +13,9 @@ import { useStore } from '../store';
 import { useKeyboardHeight } from '../lib/useKeyboardHeight';
 import { useIsOnline } from '../lib/offline';
 import { useTeamWallet, useTeamWalletPage, useCreateTopup, useVerifyTopup, useWalletRealtime, walletErrorText, type TopupOrder } from '../lib/teamWalletQueries';
 import {
-  DAILY_CAP_PAISE, TEST_TOPUP_PAISE, TOPUP_PICKS, fmtWhen, freeLeftLine, groupByMonth, isPendingBill, isPendingTopup, methodLabel, parseRupeeInput, rowAmountText, rowChip, rowSecondLine, rowTitle, rupees,
+  DAILY_CAP_PAISE, TEST_TOPUP_PAISE, TOPUP_PICKS, balanceText, negativeBalanceLine, fmtWhen, freeLeftLine, groupByMonth, isPendingBill, isPendingTopup, methodLabel, parseRupeeInput, rowAmountText, rowChip, rowSecondLine, rowTitle, rupees,
   signedRupees, topupExpired, topupProblem, topupRoomLine, type Tone, type WalletRow,
 } from '../lib/teamWallet';
 import { WalletCheckout, type CheckoutMessage } from '../components/WalletCheckout';
 import { trackEvent } from '../lib/amplitude';
@@ -291,28 +291,31 @@ export function Wallet() {
 
   if (!session) return <AccessPending />;
   const groups = groupByMonth(rows);
   const notSetUp = q.isError && /not set up/i.test(String((q.error as Error)?.message ?? ''));
+  const negative = !!data && (data.negative || data.balance_paise < 0);
 
   return (
     <Page gap={16} pt={6}>
       <TitleBlock title="Wallet" sub="Add money, see your history" />
 
       <Card colors={['rgba(60,38,24,0.5)', 'rgba(18,14,14,0.55)']} radius={20} style={{ padding: 18, gap: 6 }}>
         <Mono style={{ fontSize: 9, letterSpacing: 1.2, color: C.muted3 }}>BALANCE</Mono>
         {q.isPending ? <ActivityIndicator color={C.orange} style={{ alignSelf: 'flex-start', marginVertical: 8 }} /> : (
-          <Serif style={{ fontSize: 38, color: (data?.balance_paise ?? 0) < 0 ? C.red : '#fff' }}>{rupees(data?.balance_paise ?? 0)}</Serif>
+          <Serif style={{ fontSize: 38, color: negative ? C.red : '#fff' }}>{balanceText(data?.balance_paise ?? 0)}</Serif>
         )}
+        {/* Below zero (3 Nov 2026): an AI plan took the wallet negative; the next top-up clears it first. */}
+        {negative ? <Body style={{ fontSize: 12, color: '#FF9B8F', lineHeight: 16 }}>{data?.negative_line ?? negativeBalanceLine(data?.balance_paise ?? 0)}</Body> : null}
         <Body style={{ fontSize: 11.5, color: C.muted2 }}>
           {!online ? 'Offline, last known balance' : updatedAt ? `Updated ${fmtWhen(new Date(updatedAt).toISOString())}` : notSetUp ? 'The wallet is not set up on the server yet.' : q.isError ? walletErrorText(q.error, 'Could not load the wallet. Pull to refresh.') : ''}
         </Body>
-        {data?.charges_ai ? <Body style={{ fontSize: 11, color: C.muted3, marginTop: 2 }}>{data.free_left > 0 ? `${freeLeftLine(data.free_left)}. After that Odds AI plans cost Rs 30 to 50 each, deducted here.` : 'Odds AI plans cost Rs 30 to 50 each, deducted here. Essentials clients stay free.'}</Body> : null}
+        {data?.charges_ai && !negative ? <Body style={{ fontSize: 11, color: C.muted3, marginTop: 2 }}>{data.free_left > 0 ? `${freeLeftLine(data.free_left)}. After that Odds AI plans cost Rs 30 to 50 each, deducted here after the draft.` : 'Odds AI plans cost Rs 30 to 50 each, deducted here after the draft. Essentials clients stay free.'}</Body> : null}
       </Card>
 
-      <Pressable onPress={() => { setAddErr(null); setAddOpen(true); }} disabled={!online || notSetUp} accessibilityRole="button" accessibilityLabel="Add money" style={{ borderRadius: 13, overflow: 'hidden', opacity: online && !notSetUp ? 1 : 0.5 }}>
-        <LinearGradient colors={ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 }}>
+      <Pressable onPress={() => { setAddErr(null); setAddOpen(true); }} disabled={!online || notSetUp} accessibilityRole="button" accessibilityLabel={negative ? 'Add funds' : 'Add money'} style={{ borderRadius: 13, overflow: 'hidden', opacity: online && !notSetUp ? 1 : 0.5 }}>
+        <LinearGradient colors={negative ? [C.red, '#B2402E'] : ORANGE_GRAD} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 13 }}>
           <Icon name="plus" size={15} color="#fff" strokeWidth={2.6} />
-          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>Add money</Text>
+          <Text style={{ fontFamily: F.bodyBold, fontSize: 13.5, color: '#fff' }}>{negative ? 'Add funds' : 'Add money'}</Text>
         </LinearGradient>
       </Pressable>
       {!online ? <Body style={{ fontSize: 11.5, color: C.gold, marginTop: -8 }}>{OFFLINE_LINE}</Body> : null}
       {verifyM.isPending ? (
diff --git a/tests/rules/team_wallet_test.js b/tests/rules/team_wallet_test.js
index 88967f4..d59e651 100644
--- a/tests/rules/team_wallet_test.js
+++ b/tests/rules/team_wallet_test.js
@@ -87,18 +87,32 @@ eq('read: empty', W.parseWalletRead(null).rows, []);
 
 // 7. the AI bill
 eq('bill lines', W.billLines(4000, 200000), { bill: 'Your bill is Rs 40.', after: 'Wallet Rs 2,000, after this Rs 1,960' });
 eq('preview line', W.billPreviewLine({ sections: ['Push', 'Pull', 'Legs', 'Conditioning'], exercise_count: 27 }), '4 sections, 27 exercises');
-const gate = (o) => W.parseWalletGate({ charges: true, balance_paise: 200000, floor_paise: 5000, free_total: 3, free_used: 3, free_left: 0, essentials: false, free_this: false, billed: true, pending_bill: null, ok: true, reason: null, ...o });
+const gate = (o) => W.parseWalletGate({ charges: true, balance_paise: 200000, floor_paise: 0, bill_paise: 3300, negative: false, free_total: 3, free_used: 3, free_left: 0, essentials: false, free_this: false, billed: true, pending_bill: null, ok: true, reason: null, ...o });
 eq('card: not charged', W.walletCardState(gate({ charges: false, free_this: true, billed: false })).state, 'free');
-eq('card: ok (free used up)', W.walletCardState(gate({})), { state: 'ok', line: 'Free AI plans used. Wallet Rs 2,000, Rs 30 to 50 a plan.', action: null });
+eq('card: ok (free used up): the exact price and the balance', W.walletCardState(gate({})), { state: 'ok', line: 'Rs 33 from your wallet · balance Rs 2,000', action: null });
+eq('card: ok without a bill yet', W.walletCardState(gate({ bill_paise: null })).line, 'Rs 30 to 50 from your wallet · balance Rs 2,000');
+eq('card: balance below the price is NOT a block (3 Nov 2026)', W.walletCardState(gate({ balance_paise: 2800 })), { state: 'ok', line: 'Rs 33 from your wallet · balance Rs 28', action: null });
 eq('card: 3 free left', W.walletCardState(gate({ free_used: 0, free_left: 3, free_this: true, billed: false })), { state: 'free_left', line: '3 free AI plans left. After that Rs 30 to 50 a plan from your wallet.', action: null });
 eq('card: 1 free left (singular)', W.walletCardState(gate({ free_used: 2, free_left: 1, free_this: true, billed: false })).line, '1 free AI plan left. After that Rs 30 to 50 a plan from your wallet.');
 eq('card: Essentials client is free even with 0 left', W.walletCardState(gate({ essentials: true, free_this: true, billed: false, balance_paise: 0 })), { state: 'essentials', line: 'Free for Essentials clients.', action: null });
-eq('card: floor', W.walletCardState(gate({ balance_paise: 3000, ok: false, reason: 'WALLET_FLOOR' })), { state: 'floor', line: 'Wallet Rs 30. You need at least Rs 50 in your wallet to make an AI plan.', action: 'wallet' });
+eq('card: negative balance blocks with the owner sentence', W.walletCardState(gate({ balance_paise: -500, negative: true, ok: false, reason: 'WALLET_NEGATIVE', line: 'Your wallet is at Rs -5. Add funds to make the next plan with Odds AI.' })), { state: 'negative', line: 'Your wallet is at Rs -5. Add funds to make the next plan with Odds AI.', action: 'wallet' });
+eq('card: negative without a server line builds it', W.walletCardState(gate({ balance_paise: -500, negative: true, ok: false, reason: 'WALLET_NEGATIVE' })).line, 'Your wallet is at Rs -5. Add funds to make the next plan with Odds AI.');
 eq('card: bill pending', W.walletCardState(gate({ pending_bill: read.pending_bill, ok: false, reason: 'WALLET_BILL_PENDING' })), { state: 'bill_pending', line: 'Settle or discard your last draft first.', action: 'bill' });
 eq('card: unknown', W.walletCardState(null).state, 'unknown');
-eq('gate parse', W.parseWalletGate({ charges: true, balance_paise: 3000, floor_paise: 5000, pending_bill: null, ok: false, reason: 'WALLET_FLOOR' }).reason, 'WALLET_FLOOR');
+eq('gate parse', W.parseWalletGate({ charges: true, balance_paise: -3000, floor_paise: 0, pending_bill: null, ok: false, reason: 'WALLET_NEGATIVE' }).reason, 'WALLET_NEGATIVE');
+eq('gate parse: negative inferred from the balance', W.parseWalletGate({ charges: true, balance_paise: -100 }).negative, true);
+eq('balance text', [W.balanceText(-500), W.balanceText(46700), W.balanceText(0)], ['Rs -5', 'Rs 467', 'Rs 0']);
+eq('negative line', W.negativeBalanceLine(-500), 'Your wallet is at Rs -5. Add funds to make the next plan with Odds AI.');
+eq('option chip: free left', W.aiOptionChip(gate({ free_left: 2, free_this: true, billed: false })), { text: '2 FREE LEFT', tone: 'green' });
+eq('option chip: essentials', W.aiOptionChip(gate({ essentials: true, free_this: true, billed: false })), { text: 'FREE FOR ESSENTIALS', tone: 'green' });
+eq('option chip: price', W.aiOptionChip(gate({})), { text: 'RS 33', tone: 'amber' });
+eq('option chip: negative', W.aiOptionChip(gate({ negative: true, balance_paise: -500 })), { text: 'ADD FUNDS', tone: 'red' });
+eq('option chip: not charged', W.aiOptionChip(gate({ charges: false })), null);
+eq('after charge: negative is red', W.afterChargeLine(3300, -500), { text: 'Rs 33 deducted. Wallet Rs -5.', tone: 'red' });
+eq('after charge: positive is green', W.afterChargeLine(3300, 46700), { text: 'Rs 33 deducted. Wallet Rs 467.', tone: 'green' });
+eq('read: negative flag and line', [W.parseWalletRead({ balance_paise: -700 }).negative, W.parseWalletRead({ balance_paise: -700 }).negative_line], [true, 'Your wallet is at Rs -7. Add funds to make the next plan with Odds AI.']);
 eq('gate parse: old server answer without free fields is billed', [gate({}).billed, W.parseWalletGate({ charges: true, balance_paise: 3000 }).free_this], [true, false]);
 eq('free left line', [W.freeLeftLine(3), W.freeLeftLine(1)], ['3 free AI plans left', '1 free AI plan left']);
 const freeRow = W.parseWalletRow({ id: 'h', seq: 10, kind: 'ai_plan', amount_paise: 0, status: 'paid', balance_after_paise: 50000, created_at: t0, paid_at: t0, razorpay: null, meta: { free: true, essentials: false, client_name: 'Riya S' } });
 eq('free row: amount, line, chip', [W.rowAmountText(freeRow), W.rowStatusLine(freeRow, now), W.rowChip(freeRow, now), W.rowTitle(freeRow)], ['Free', 'Free plan, not charged', { text: 'FREE', tone: 'green' }, 'Odds AI plan, Riya']);
```

### Server (reference)
```sql
-- ============================================================================
-- Team Wallet: the Odds AI plan is charged automatically after the draft; the balance may go negative (3 Nov 2026)
-- Owner (3 Nov 2026, replacing the 2 Nov "bill sheet with Deduct"): deduct AFTER the draft is made, automatically, no
-- Deduct tap, the draft always lands; the balance may go negative (Rs 28 wallet, Rs 33 plan: the wallet shows Rs -5),
-- never below minus one plan's price (the maximum bill, Rs 50); only a NEGATIVE balance blocks the next AI plan; the
-- next top-up clears the negative first. Plan: odds-app/docs/create-plan-entry-plan.md.
--
-- 1. Constraint team_wallet_ai_floor: an ai_plan row may leave balance_after_paise negative, never below -5000.
-- 2. team_wallet_charge_ai_plan(user, client, name, draft_ref, preview): ONE paid ai_plan row written after the draft,
--    refused only while the balance is already negative (WALLET_NEGATIVE). No held draft, nothing to settle.
-- 3. team_wallet_ai_plan_gate(user, essentials, client): the Rs 50 floor is gone; for a billed draft the gate answers
--    bill_paise for the client and blocks only when negative (reason WALLET_NEGATIVE, with the figure) or while a bill
--    from the old design is still pending (WALLET_BILL_PENDING). The 2-argument version is dropped (one signature).
-- 4. get_my_team_wallet adds 'negative' and 'negative_line' for the Wallet screen.
-- The old create_ai_bill / settle / discard functions stay for bills written before this change (the sweep cancels
-- them after 24 hours). A rolled-back probe (9 checks) at the end.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The floor: minus one plan's price
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_wallet DROP CONSTRAINT IF EXISTS team_wallet_ai_floor;
ALTER TABLE public.team_wallet ADD CONSTRAINT team_wallet_ai_floor
  CHECK (kind <> 'ai_plan' OR balance_after_paise IS NULL OR balance_after_paise >= -5000);

/** "Rs -5" for the owner's sentences (the apps print the same). */
CREATE OR REPLACE FUNCTION public.team_wallet_rs(p_paise bigint)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_paise < 0 THEN 'Rs -' || (abs(p_paise) / 100)::text ELSE 'Rs ' || (p_paise / 100)::text END
$$;
GRANT EXECUTE ON FUNCTION public.team_wallet_rs(bigint) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The gate, now with the client's bill and the negative rule
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.team_wallet_ai_plan_gate(uuid, boolean);
DROP FUNCTION IF EXISTS public.team_wallet_ai_plan_gate(uuid);
CREATE OR REPLACE FUNCTION public.team_wallet_ai_plan_gate(p_user uuid, p_essentials boolean DEFAULT false, p_client uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_charges boolean;
  v_bal bigint;
  v_used integer := 0;
  v_left integer := 0;
  v_free_this boolean;
  v_bill bigint := NULL;
  v_blocks jsonb := NULL;
  v_pending public.team_wallet;
  v_pending_json jsonb := NULL;
  v_reason text := NULL;
  v_line text := NULL;
BEGIN
  SELECT p.role::text INTO v_role FROM public.profiles p WHERE p.id = p_user;
  v_charges := (v_role = 'trainer');
  v_bal := public.team_wallet_balance(p_user);
  IF v_charges THEN
    v_used := public.team_wallet_free_used(p_user);
    v_left := GREATEST(public.team_wallet_free_total() - v_used, 0);
  END IF;
  v_free_this := NOT v_charges OR COALESCE(p_essentials, false) OR v_left > 0;
  IF v_charges AND NOT v_free_this AND p_client IS NOT NULL THEN
    SELECT (b->>'bill_paise')::bigint, b->'blocks' INTO v_bill, v_blocks FROM public.team_wallet_ai_plan_bill(p_client) b;
  END IF;
  SELECT * INTO v_pending FROM public.team_wallet w
   WHERE w.user_id = p_user AND w.kind = 'ai_plan' AND w.status = 'pending' ORDER BY w.seq DESC LIMIT 1;
  IF v_pending.id IS NOT NULL THEN
    v_pending_json := jsonb_build_object('tx_id', v_pending.id, 'bill_paise', -v_pending.amount_paise,
      'client_id', v_pending.meta->>'client_id', 'client_name', v_pending.meta->>'client_name',
      'created_at', v_pending.created_at, 'preview', v_pending.meta->'preview');
  END IF;
  IF v_charges AND NOT v_free_this THEN
    IF v_pending.id IS NOT NULL THEN
      v_reason := 'WALLET_BILL_PENDING'; v_line := 'Settle or discard your last draft first.';
    ELSIF v_bal < 0 THEN
      v_reason := 'WALLET_NEGATIVE'; v_line := 'Your wallet is at ' || public.team_wallet_rs(v_bal) || '. Add funds to make the next plan with Odds AI.';
    END IF;
  END IF;
  RETURN jsonb_build_object('charges', v_charges, 'balance_paise', v_bal, 'negative', v_bal < 0,
    'floor_paise', 0, 'bill_paise', v_bill, 'blocks', v_blocks,
    'free_total', public.team_wallet_free_total(), 'free_used', v_used, 'free_left', v_left,
    'essentials', COALESCE(p_essentials, false), 'free_this', v_free_this, 'billed', v_charges AND NOT v_free_this,
    'pending_bill', v_pending_json, 'ok', v_reason IS NULL, 'reason', v_reason, 'line', v_line);
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_ai_plan_gate(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_ai_plan_gate(uuid, boolean, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. The charge, written after the draft
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_wallet_charge_ai_plan(p_user uuid, p_client uuid, p_client_name text, p_draft_ref text, p_preview jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_bal bigint;
  v_bill jsonb;
  v_amount bigint;
  v_row public.team_wallet;
BEGIN
  SELECT p.role::text INTO v_role FROM public.profiles p WHERE p.id = p_user;
  IF v_role IS DISTINCT FROM 'trainer' THEN RAISE EXCEPTION 'WALLET_FORBIDDEN: Only trainers are billed for AI plans.' USING ERRCODE = '42501'; END IF;
  PERFORM public.team_wallet_lock(p_user);
  v_bal := public.team_wallet_balance(p_user);
  IF v_bal < 0 THEN
    RAISE EXCEPTION 'WALLET_NEGATIVE: Your wallet is at %. Add funds to make the next plan with Odds AI.', public.team_wallet_rs(v_bal);
  END IF;
  v_bill := public.team_wallet_ai_plan_bill(p_client);
  v_amount := (v_bill->>'bill_paise')::bigint;
  IF v_bal - v_amount < -5000 THEN
    RAISE EXCEPTION 'WALLET_NEGATIVE: The wallet cannot go further below zero. Add funds first.';
  END IF;
  INSERT INTO public.team_wallet (user_id, role, kind, amount_paise, status, balance_after_paise, paid_at, meta)
  VALUES (p_user, v_role, 'ai_plan', -v_amount, 'paid', v_bal - v_amount, now(),
          jsonb_build_object('note', 'Odds AI plan', 'created_by', p_user, 'draft_ref', p_draft_ref, 'client_id', p_client,
                             'client_name', p_client_name, 'blocks', v_bill->'blocks', 'preview', COALESCE(p_preview, '{}'::jsonb), 'auto', true))
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('tx_id', v_row.id, 'bill_paise', v_amount, 'blocks', v_bill->'blocks', 'balance_paise', v_bal - v_amount,
                            'negative', v_bal - v_amount < 0, 'row', public.team_wallet_public(v_row));
END;
$$;
REVOKE ALL ON FUNCTION public.team_wallet_charge_ai_plan(uuid, uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.team_wallet_charge_ai_plan(uuid, uuid, text, text, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. The app's read: the negative state
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_team_wallet(p_limit integer DEFAULT 50, p_before timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_day date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_today bigint;
  v_gate jsonb;
  v_bal bigint;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'WALLET_SIGN_IN: Sign in to see your wallet.' USING ERRCODE = '42501'; END IF;
  SELECT COALESCE(SUM(w.amount_paise), 0) INTO v_today FROM public.team_wallet w
   WHERE w.user_id = v_uid AND w.kind = 'topup' AND w.status IN ('pending', 'paid')
     AND (w.created_at AT TIME ZONE 'Asia/Kolkata')::date = v_day;
  v_gate := public.team_wallet_ai_plan_gate(v_uid, false, NULL);
  v_bal := public.team_wallet_balance(v_uid);
  RETURN jsonb_build_object(
    'balance_paise', v_bal,
    'negative', v_bal < 0,
    'negative_line', CASE WHEN v_bal < 0 THEN 'Your wallet is at ' || public.team_wallet_rs(v_bal) || '. Add funds to make the next plan with Odds AI.' ELSE NULL END,
    'today_topup_paise', v_today,
    'today_room_paise', GREATEST(public.team_wallet_daily_cap_paise() - v_today, 0),
    'min_topup_paise', public.team_wallet_min_topup_paise(),
    'daily_cap_paise', public.team_wallet_daily_cap_paise(),
    'ai_bill_min_paise', 3000,
    'ai_bill_max_paise', 5000,
    'ai_floor_paise', 0,
    'charges_ai', v_gate->'charges',
    'free_total', v_gate->'free_total',
    'free_used', v_gate->'free_used',
    'free_left', v_gate->'free_left',
    'pending_bill', v_gate->'pending_bill',
    'rows', COALESCE((SELECT jsonb_agg(public.team_wallet_public(w) ORDER BY w.seq DESC)
      FROM (SELECT * FROM public.team_wallet w2 WHERE w2.user_id = v_uid AND (p_before IS NULL OR w2.created_at < p_before)
             ORDER BY w2.seq DESC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))) w), '[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.get_my_team_wallet(integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_team_wallet(integer, timestamptz) TO authenticated, service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- Probe: Sagar and a client, inside a block that is always rolled back. 9 checks.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS charge_probe (step int, check_name text, expected text, result text);
TRUNCATE charge_probe;

DO $probe$
DECLARE
  v_user uuid; v_admin uuid; v_client uuid; v_client_name text; v_bill bigint;
  x jsonb; g jsonb; v_res text; v_n int;
  v_names text[] := '{}'; v_expected text[] := '{}'; v_results text[] := '{}';
BEGIN
  SELECT p.id INTO v_user FROM public.profiles p WHERE p.role::text = 'trainer' AND p.email = 'sagaroddsfitness@gmail.com' LIMIT 1;
  IF v_user IS NULL THEN SELECT p.id INTO v_user FROM public.profiles p WHERE p.role::text = 'trainer' LIMIT 1; END IF;
  SELECT p.id INTO v_admin FROM public.profiles p WHERE p.role::text IN ('admin', 'super_admin') LIMIT 1;
  SELECT c.id, COALESCE(c.first_name, 'Client') INTO v_client, v_client_name FROM public.clients c ORDER BY c.created_at DESC NULLS LAST LIMIT 1;
  BEGIN
    v_bill := public.team_wallet_ai_plan_bill_paise(v_client);
    -- use up the free drafts so the charge path is exercised
    v_n := 0;
    WHILE (public.team_wallet_ai_plan_gate(v_user, false, v_client)->>'free_left')::int > 0 AND v_n < 5 LOOP
      x := public.team_wallet_record_free_draft(v_user, v_client, v_client_name, false, 'probe-free-' || v_n, NULL); v_n := v_n + 1;
    END LOOP;
    -- 1. a balance below the price is NOT a block; the gate names the bill
    g := public.team_wallet_ai_plan_gate(v_user, false, v_client);
    v_names := array_append(v_names, 'gate at Rs 0: billed, ok, bill named, not negative'); v_expected := array_append(v_expected, 'billed true, ok true, bill ' || v_bill || ', negative false');
    v_results := array_append(v_results, 'billed ' || (g->>'billed') || ', ok ' || (g->>'ok') || ', bill ' || (g->>'bill_paise') || ', negative ' || (g->>'negative'));
    -- 2. charge on Rs 0: the balance goes negative by the bill
    x := public.team_wallet_charge_ai_plan(v_user, v_client, v_client_name, 'probe-charge-1', '{"sections":["Push"],"exercise_count":9}'::jsonb);
    v_names := array_append(v_names, 'charge on Rs 0 goes negative by the bill'); v_expected := array_append(v_expected, 'balance ' || (-v_bill) || ', negative true');
    v_results := array_append(v_results, 'balance ' || (x->>'balance_paise') || ', negative ' || (x->>'negative'));
    -- 3. the next plan is blocked with the owner's sentence
    g := public.team_wallet_ai_plan_gate(v_user, false, v_client);
    v_names := array_append(v_names, 'negative balance blocks the next plan'); v_expected := array_append(v_expected, 'WALLET_NEGATIVE | Your wallet is at Rs -' || (v_bill / 100) || '. Add funds to make the next plan with Odds AI.');
    v_results := array_append(v_results, (g->>'reason') || ' | ' || (g->>'line'));
    BEGIN x := public.team_wallet_charge_ai_plan(v_user, v_client, v_client_name, 'probe-charge-2', NULL); v_res := 'charged'; EXCEPTION WHEN others THEN v_res := SQLERRM; END;
    v_names := array_append(v_names, 'a charge while negative is refused'); v_expected := array_append(v_expected, 'WALLET_NEGATIVE: Your wallet is at Rs -' || (v_bill / 100) || '. Add funds to make the next plan with Odds AI.');
    v_results := array_append(v_results, v_res);
    -- 4. an Essentials draft is still free while negative
    g := public.team_wallet_ai_plan_gate(v_user, true, v_client);
    v_names := array_append(v_names, 'Essentials stays free while negative'); v_expected := array_append(v_expected, 'free_this true, ok true');
    v_results := array_append(v_results, 'free_this ' || (g->>'free_this') || ', ok ' || (g->>'ok'));
    -- 5. a Rs 500 top-up clears the negative first
    x := public.team_wallet_create_topup(v_user, 50000);
    PERFORM public.team_wallet_set_order((x->>'id')::uuid, 'order_probe_neg');
    x := public.team_wallet_mark_paid((x->>'id')::uuid, 'pay_probe_neg', NULL, 'upi', NULL, 'app_verify');
    v_names := array_append(v_names, 'Rs 500 top-up at a negative balance'); v_expected := array_append(v_expected, 'balance ' || (50000 - v_bill) || ', gate ok');
    v_results := array_append(v_results, 'balance ' || (x->>'balance_after_paise') || ', gate ' || CASE WHEN (public.team_wallet_ai_plan_gate(v_user, false, v_client)->>'ok')::boolean THEN 'ok' ELSE 'blocked' END);
    -- 6. the floor constraint: a row that would land below -5000 is refused
    BEGIN
      INSERT INTO public.team_wallet (user_id, role, kind, amount_paise, status, balance_after_paise, paid_at, meta)
      VALUES (v_user, 'trainer', 'ai_plan', -5000, 'paid', -5100, now(), '{"note":"probe"}'::jsonb);
      v_res := 'inserted';
    EXCEPTION WHEN others THEN v_res := CASE WHEN SQLERRM LIKE '%team_wallet_ai_floor%' THEN 'refused by team_wallet_ai_floor' ELSE SQLERRM END; END;
    v_names := array_append(v_names, 'a balance below -5000 is refused by the constraint'); v_expected := array_append(v_expected, 'refused by team_wallet_ai_floor');
    v_results := array_append(v_results, v_res);
    -- 7. the app read says negative after an adjustment below zero
    IF v_admin IS NOT NULL THEN
      PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
      x := public.team_wallet_adjust(v_user, -(public.team_wallet_balance(v_user) + 700), 'probe: push the wallet to Rs -7');
      PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
      x := public.get_my_team_wallet(5, NULL);
      PERFORM set_config('request.jwt.claim.sub', '', true);
      v_names := array_append(v_names, 'get_my_team_wallet at Rs -7'); v_expected := array_append(v_expected, 'true | Your wallet is at Rs -7. Add funds to make the next plan with Odds AI.');
      v_results := array_append(v_results, (x->>'negative') || ' | ' || (x->>'negative_line'));
    END IF;
    -- 8. the free count is untouched by charged plans
    g := public.team_wallet_ai_plan_gate(v_user, false, v_client);
    v_names := array_append(v_names, 'free_left stays 0 after charges'); v_expected := array_append(v_expected, '0');
    v_results := array_append(v_results, (g->>'free_left'));
    RAISE EXCEPTION 'PROBE_DONE';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'PROBE_DONE' THEN
      v_names := array_append(v_names, 'probe stopped'); v_expected := array_append(v_expected, 'ran'); v_results := array_append(v_results, 'could not run: ' || SQLERRM);
    END IF;
  END;
  INSERT INTO charge_probe (step, check_name, expected, result)
  SELECT n, v_names[n], v_expected[n], v_results[n] FROM generate_subscripts(v_names, 1) AS n;
END
$probe$;

INSERT INTO charge_probe (step, check_name, expected, result)
SELECT 20, 'Rs text', 'Rs -5 | Rs 467', public.team_wallet_rs(-500) || ' | ' || public.team_wallet_rs(46700)
UNION ALL
SELECT 21, 'probe rows left behind', '0', (SELECT count(*)::text FROM public.team_wallet WHERE meta->>'draft_ref' LIKE 'probe-%' OR razorpay->>'order_id' = 'order_probe_neg');

SELECT step, check_name, expected, result FROM charge_probe ORDER BY step;
```

## 4. Check on the iPhone
1. `node tests/rules/team_wallet_test.js`: ALL PASS.
2. As Sagar with free plans left: Plan tab > Create Plan shows "N FREE LEFT" on AI generated; a free draft lands with no charge line.
3. Free plans used, wallet Rs 0: the card reads "RS 33" / "Rs 33 from your wallet · balance Rs 0"; Generate for Rs 33 lands the draft and says "Rs 33 deducted. Wallet Rs -33." in red; the Wallet screen shows "Rs -33" red with Add funds.
4. Create Plan again: tapping AI generated shows the popup "Add funds"; Build manually opens the manual builder; Add money opens the Wallet.
5. Add Rs 500: the Wallet shows Rs 467; Create Plan: the card reads "RS 33 · balance Rs 467" and Generate works.

Not confirmed: the screens were not opened on a phone after the change (tsc, rule tests and the Metro bundle pass; the
migration passed its 11-check probe locally and is not run live yet).
