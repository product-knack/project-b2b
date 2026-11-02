// Rule test for the Odds staff app. ROOT = the repo root; point it at the iOS repo and run: node tests/rules/wallet_checkout_html_test.js
const ROOT = require("path").resolve(__dirname, "../..");
// Team Wallet checkout page (2 Nov 2026): the inline HTML the WebView loads carries exactly the order fields, escapes
// what came from the server, and posts the three messages.
const ts = require(ROOT + '/node_modules/typescript');
const fs = require('fs');
const src = fs.readFileSync(ROOT + '/src/lib/walletCheckoutHtml.ts', 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', 'require', js)(m, m.exports, (n) => { throw new Error('unexpected require ' + n); });
const H = m.exports;
let fails = 0;
const ok = (name, cond, extra) => { if (!cond) fails++; console.log(cond ? 'PASS' : 'FAIL', name, cond ? '' : extra ?? ''); };

const html = H.walletCheckoutHtml({ key_id: 'rzp_live_x', order_id: 'order_1', amount_paise: 200000, tx_id: 'tx-1', name: 'Sagar <b>', email: 'a@b.c', contact: '9999' });
ok('title shows the amount', html.includes('<title>Pay Rs 2,000</title>'));
ok('options carry key, order, amount, notes', /"key":"rzp_live_x"/.test(html) && /"order_id":"order_1"/.test(html) && /"amount":200000/.test(html) && /"wallet_tx_id":"tx-1"/.test(html));
ok('prefill name is JSON, not injected', html.includes('"name":"Sagar <b>"') && !html.includes('<b>Paying'));
ok('no secret key', !/key_secret|rzp_live_[A-Za-z0-9]+:/.test(html));
ok('posts ok, dismissed and failed', html.includes('{ ok: true, razorpay_order_id') && html.includes('{ dismissed: true }') && html.includes('{ failed: true, reason: why }'));
ok('loads checkout.js from Razorpay', html.includes('https://checkout.razorpay.com/v1/checkout.js'));
const sneaky = H.walletCheckoutHtml({ key_id: 'k', order_id: 'o</script><script>alert(1)</script>', amount_paise: 100, tx_id: 't', name: '', email: '', contact: '' });
ok('a closing script tag in a value cannot break out', !sneaky.includes('o</script>'));
ok('Rs 1 title', H.walletCheckoutHtml({ key_id: 'k', order_id: 'o', amount_paise: 100, tx_id: 't', name: '', email: '', contact: '' }).includes('<title>Pay Rs 1</title>'));
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
