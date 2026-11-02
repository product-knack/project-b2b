/* The Team Wallet checkout page the WebView loads as inline HTML (2 Nov 2026). It cannot come from the server: the
   Supabase functions gateway rewrites every HTML answer to text/plain with a sandbox CSP, so a WebView given that URL
   shows a blank page. The page holds only what wallet-create-order answered (public key id, order id, amount, prefill,
   the row id in the notes), never a secret; it loads Razorpay Standard Checkout, opens it at once and posts ONE message
   to the app through window.ReactNativeWebView.postMessage:
     { ok: true, razorpay_order_id, razorpay_payment_id, razorpay_signature }   the app then calls wallet-verify-payment
     { dismissed: true }                                                       the sheet was closed (row stays pending 30 min)
     { failed: true, reason }                                                  an attempt failed (Razorpay offers a retry)
   Pure: no React, no network; tested in node (tests/rules/wallet_checkout_html_test.js); copied byte for byte to iOS. */

export type CheckoutPageInput = {
  key_id: string;
  order_id: string;
  amount_paise: number;
  tx_id: string;
  name: string;
  email: string;
  contact: string;
};

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** JSON for a <script>: no "</" sequence can close the tag. */
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
const jsonForScript = (v: unknown) => JSON.stringify(v).replace(/<\//g, '<\\/').split(LS).join('\\u2028').split(PS).join('\\u2029');

/** "Rs 1,00,000" with Indian grouping (the same rule as teamWallet.ts; repeated so this file has no imports). */
const rupees = (paise: number): string => {
  const n = Math.round(Math.abs(Number(paise) || 0) / 100);
  const s = String(n);
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return `Rs ${rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3}`;
};

export const CHECKOUT_JS = 'https://checkout.razorpay.com/v1/checkout.js';

export const walletCheckoutHtml = (o: CheckoutPageInput): string => {
  const amount = rupees(o.amount_paise);
  const options = {
    key: o.key_id,
    amount: Math.round(Number(o.amount_paise) || 0),
    currency: 'INR',
    name: 'Odds Fitness',
    description: 'Team Wallet top-up',
    order_id: o.order_id,
    prefill: { name: o.name || '', email: o.email || '', contact: o.contact || '' },
    notes: { purpose: 'team_wallet_topup', wallet_tx_id: o.tx_id },
    theme: { color: '#F08A3C', backdrop_color: '#0e0a09' },
    retry: { enabled: true, max_count: 3 },
    remember_customer: false,
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1"><title>Pay ${esc(amount)}</title><style>
  html,body{margin:0;height:100%;background:#0e0a09;color:#fff;font-family:-apple-system,system-ui,"Segoe UI",Roboto,sans-serif}
  .box{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;box-sizing:border-box}
  .t{font-size:22px;font-weight:700}.s{font-size:14px;color:#a8a09a;line-height:1.5;max-width:320px}
  button{margin-top:8px;padding:12px 22px;border-radius:12px;border:1px solid #f08a3c;background:rgba(240,138,60,0.14);color:#f08a3c;font-weight:700;font-size:15px}
  .spin{width:28px;height:28px;border-radius:50%;border:3px solid rgba(255,255,255,0.15);border-top-color:#f08a3c;animation:r 0.9s linear infinite}@keyframes r{to{transform:rotate(360deg)}}
</style></head><body><div class="box"><div class="spin" id="spin"></div><div class="t">Paying ${esc(amount)}</div><div class="s" id="s">Opening the Razorpay checkout. Choose UPI, a card or net banking.</div><button id="again" style="display:none">Open the checkout again</button></div><script>
  window.__post = function (m) { var s = JSON.stringify(m); try { if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) { window.ReactNativeWebView.postMessage(s); return true; } } catch (e) {} return false; };
  var opts = ${jsonForScript(options)};
  var s = document.getElementById('s'), again = document.getElementById('again'), spin = document.getElementById('spin');
  function status(t) { s.textContent = t; }
  opts.handler = function (r) {
    spin.style.display = 'none'; status('Payment received. Adding it to your wallet...');
    if (!window.__post({ ok: true, razorpay_order_id: r.razorpay_order_id, razorpay_payment_id: r.razorpay_payment_id, razorpay_signature: r.razorpay_signature })) status('Payment received. Go back to the Odds app: your wallet updates in a moment.');
  };
  opts.modal = { ondismiss: function () { spin.style.display = 'none'; status('Checkout closed. Nothing was charged yet.'); again.style.display = 'inline-block'; window.__post({ dismissed: true }); }, escape: true, backdropclose: false, confirm_close: false };
  var rzp = null;
  function openCheckout() {
    try {
      if (!rzp) { rzp = new Razorpay(opts); rzp.on('payment.failed', function (e) { var why = (e && e.error && e.error.description) || 'The payment did not go through'; status('Payment failed: ' + why + '. You can try again.'); window.__post({ failed: true, reason: why }); }); }
      spin.style.display = 'block'; again.style.display = 'none'; status('Opening the Razorpay checkout...');
      rzp.open();
    } catch (e) { spin.style.display = 'none'; status('The checkout could not open. Close this page and try again.'); again.style.display = 'inline-block'; }
  }
  again.onclick = openCheckout;
  var tag = document.createElement('script'); tag.src = ${jsonForScript(CHECKOUT_JS)}; tag.onload = openCheckout;
  tag.onerror = function () { spin.style.display = 'none'; status('Razorpay could not load. Check your connection, then open the checkout again.'); again.style.display = 'inline-block'; };
  document.head.appendChild(tag);
</script></body></html>`;
};
