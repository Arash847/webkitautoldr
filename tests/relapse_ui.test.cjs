// Host-only check for this build's compact UI: no log view, the glass progress
// pill driven by the chain's own lines. No browser, no exploit — app.js runs in
// a vm against a fake #console and a stub iframe.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '..', 'frontend/autoloader/app.js'), 'utf8');

function element() {
  return {
    style: {}, className: '', hidden: false, textContent: '', children: [], parentNode: null,
    appendChild(e) { this.children.push(e); this.parentNode = this; },
    get childElementCount() { return this.children.length; },
    get lastChild() { return this.children[this.children.length - 1]; },
  };
}

/* Minimal classList that keeps className in sync, so the failure tint is
   observable the way the browser would report it. */
function trackedElement() {
  const el = element();
  const classes = new Set();
  el.classList = {
    add(name) { classes.add(name); el.className = [...classes].join(' '); },
    remove(name) { classes.delete(name); el.className = [...classes].join(' '); },
  };
  return el;
}

/* Boot app.js on a 13.40 page with an armed relapse iframe. */
function setup() {
  const lines = [];
  const iframeDoc = { readyState: 'complete', title: 'PS5-Relapse',
    getElementById: () => null, querySelectorAll: () => lines };
  const elements = {};
  const events = {};
  let tick = null;
  const context = {
    document: { getElementById(id) { return elements[id] ||= trackedElement(); },
      createElement: element, body: trackedElement() },
    navigator: { userAgent: 'Mozilla/5.0 (PlayStation 5/13.40) AppleWebKit/605.1' },
    window: { location: { search: '', origin: 'http://127.0.0.1:18181' },
      addEventListener(name, fn) { events[name] = fn; } },
    sessionStorage: { setItem() {}, removeItem() {} },
    setTimeout() {}, setInterval(fn) { tick = fn; return 1; }, clearInterval() {}, URLSearchParams,
  };
  const iframe = elements.exploit || (elements.exploit = trackedElement());
  iframe.contentDocument = iframeDoc;
  iframe.contentWindow = { location: { href: 'http://127.0.0.1:18181/app/v/relapse/index.html?autoload=payload.elf' } };
  vm.runInNewContext(app, context);
  events.load();
  return {
    lines, events, iframe, elements,
    push(text, cls = 'LOG-LOG') { lines.push({ textContent: text, className: cls }); tick(); },
    /* A postMessage from the armed iframe, which is the only accepted source. */
    fromExploit(data) { events.message({ source: iframe.contentWindow, origin: 'http://127.0.0.1:18181', data }); },
    pct() {
      const m = /scaleX\(([\d.]+)\)/.exec(elements.progressBar.style.transform || '');
      return Math.round(Number(m[1]) * 100);
    },
    label() { return elements.progressLabel.textContent; },
    tint() { return elements.progressContainer.className; },
  };
}

const ui = setup();
assert.equal(ui.iframe.src, 'relapse/index.html?autoload=payload.elf');
assert.equal(ui.label(), 'Waiting to start...');
assert.equal(ui.pct(), 5, 'the run starts with a visible sliver of the bar');

/* Relapse reports stages, not a percentage: each known stage must move the
   bar forward, and nothing may move it backwards. */
ui.push('[+] Credits: ntfargo, ufm42, ...');
assert.match(ui.label(), /^Credits: ntfargo/, 'the marker prefix is stripped');
assert.equal(ui.pct(), 5, 'a line with no stage leaves the bar alone');
for (const [line, want] of [
  ['[*] Starting WebKit exploit', 10],
  ['[+] ARW ready', 20],
  ['[*] Worker chain: ready', 35],
  ['[+] Kernel: Starting kernel exploit', 45],
  ['[+] Kernel: read and write ready', 60],
  ['[+] Kernel: privileges ready', 75],
  ['[+] Kernel: payloads loaded', 85],
  ['[+] elfldr is up, sending payload.elf', 95],
]) {
  ui.push(line);
  assert.equal(ui.pct(), want, line);
}
assert.equal(ui.tint(), '', 'success lines must not tint the pill');

/* Retry lines are normal progress: the label follows them, but the bar does
   not invent progress from them. */
ui.push('[*] Retry: placement attempt 4');
assert.equal(ui.label(), 'Retry: placement attempt 4');
assert.equal(ui.pct(), 95);

/* A long line is clipped so the pill label stays on one line. */
ui.push('[+] ' + 'x'.repeat(200));
assert.ok(ui.label().length <= 68 && ui.label().endsWith('...'));

/* An error has to outlive the next tick. It tints the pill, but it must not
   overwrite the label: the last progress text is what tells the user where the
   run actually got to. */
const labelBeforeError = ui.label();
ui.push('[-] Kernel: stopped: aio steering failed');
assert.equal(ui.tint(), 'bad');
assert.equal(ui.label(), labelBeforeError);
ui.push('[*] Attempt 5');
assert.equal(ui.tint(), 'bad', 'the tint stays until the run recovers');

/* A foreign same-origin document must not be able to finish the run. */
const before = ui.label();
ui.events.message({ source: {}, origin: 'http://127.0.0.1:18181',
  data: { type: 'wkal', kind: 'autoload', ok: true, bytes: 10 } });
assert.equal(ui.label(), before, 'foreign autoload message ignored');
assert.equal(ui.iframe.src, 'relapse/index.html?autoload=payload.elf',
  'a foreign message must not tear the armed exploit down');

/* A successful handoff pins the bar and clears the tint. */
ui.fromExploit({ type: 'wkal', kind: 'autoload', ok: true, bytes: 10 });
assert.equal(ui.label(), 'Autoload finished.');
assert.equal(ui.tint(), '');
assert.equal(ui.pct(), 100);

/* A run that fails the handoff tints the pill and resets the bar. One result
   per page: the second message must be ignored, exactly like a real run. */
const failed = setup();
failed.push('[-] Kernel: stopped: aio steering failed');
failed.fromExploit({ type: 'wkal', kind: 'autoload', ok: false, why: 'elfldr did not start' });
assert.equal(failed.label(), 'Autoload failed.');
assert.equal(failed.tint(), 'bad');
assert.equal(failed.pct(), 0);
failed.fromExploit({ type: 'wkal', kind: 'autoload', ok: true, bytes: 10 });
assert.equal(failed.label(), 'Autoload failed.', 'a second result is ignored');

console.log('PASS: relapse drives the compact UI (label, stages, failure tint, message isolation)');
