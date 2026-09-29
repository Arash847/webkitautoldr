// Host-only integration tests for the relapse chain wiring. No browser and no
// kernel exploit is executed: app.js is run in a vm against a stubbed DOM, and
// the patched relapse sources are driven with a mocked syscall chain.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('frontend/autoloader/app.js');

function element() {
  return { style: {}, className: '', hidden: false, textContent: '', classList: { add() {}, remove() {} },
    children: [], parentNode: null, appendChild(e) { this.children.push(e); this.parentNode = this; },
    get childElementCount() { return this.children.length; }, get lastChild() { return this.children[this.children.length - 1]; } };
}

/* Run app.js as the page would, and return the pieces a test needs. */
function route(fw, force = '') {
  const elements = {};
  const events = {};
  const context = {
    document: { getElementById(id) { return elements[id] ||= element(); }, createElement: element, body: element() },
    navigator: { userAgent: fw ? 'PlayStation 5/' + fw : 'Desktop' },
    window: { location: { search: force, origin: 'http://localhost' },
      addEventListener(name, fn) { events[name] = fn; } },
    sessionStorage: { setItem() {}, removeItem() {} },
    setTimeout() {}, setInterval() { return 1; }, clearInterval() {}, URLSearchParams,
  };
  vm.runInNewContext(app, context);
  events.load();
  return { elements, events, context };
}

/* --- firmware routing -------------------------------------------------- */

// Relapse is the only 7.00+ route; poops/p2jb were dropped upstream in v0.5.0.
for (const fw of ['7.00', '9.00', '12.00', '12.60', '12.70', '13.00', '13.40', '13.60']) {
  assert.equal(route(fw).elements.exploit.src, 'relapse/index.html?autoload=payload.elf', fw);
  assert.ok(fs.existsSync(path.join(root, 'frontend/autoloader/relapse/offsets', fw + '.js')), 'offsets for ' + fw);
}
// 9.05/11.40 have no relapse offsets, and the slopkit fallbacks are gone.
for (const fw of ['9.05', '11.40', '13.50', '13.61', '14.00', '6.00', null])
  assert.equal(route(fw).elements.exploit.src, 'about:blank', 'unsupported: ' + fw);
assert.match(route('5.50').elements.exploit.src, /^umtx2\//);
assert.match(route('1.00').elements.exploit.src, /^umtx2\//);
assert.match(route('13.40', '?force=relapse').elements.exploit.src, /^relapse\//);
assert.match(route('12.00', '?force=umtx2').elements.exploit.src, /^umtx2\//);
// ?force= must not resurrect a removed chain: it is ignored and the firmware
// table decides.
assert.match(route('12.00', '?force=p2jb').elements.exploit.src, /^relapse\//);
assert.match(route('9.05', '?force=poops').elements.exploit.src, /^about:blank$/);

// --- message isolation --------------------------------------------------

const routed = route('13.40');
const before = routed.elements.progressLabel.textContent;
routed.events.message({ source: {}, origin: 'http://localhost',
  data: { type: 'wkal', kind: 'autoload', ok: true } });
assert.equal(routed.elements.progressLabel.textContent, before,
  'a message from another same-origin document must be ignored');
assert.equal(routed.elements.exploit.src, 'relapse/index.html?autoload=payload.elf',
  'a foreign message must not tear the armed exploit down');

/* --- offsets are loaded from a stable, cacheable URL ------------------- */

function offsets() {
  let script;
  const context = { URLSearchParams,
    window: { location: { search: '?autoload=payload.elf' }, fw_str: '13.40', firmware: { rejection: () => null } },
    document: { createElement: () => ({ setAttribute(k, v) { if (k === 'src') this.src = v; } }),
      body: { appendChild(s) { script = s; } } } };
  vm.runInNewContext(read('frontend/autoloader/relapse/src/main.js'), context);
  // AppCache matches URLs exactly, so a per-page-load cache-buster would 404
  // the offsets script the moment the console goes off the network.
  assert.equal(script.src, 'offsets/13.40.js');
}

/* --- payload handoff --------------------------------------------------- */

async function transfer({ badElf = false, failWrite = false, notFound = false } = {}) {
  class Int64 { constructor(low, hi = 0) { this.low = low; this.hi = hi; } add32(n) { return new Int64(this.low + n, this.hi); } }
  const calls = [];
  const bytes = new Uint8Array(0x1004);
  bytes.set(badElf ? [0, 0, 0, 0] : [0x7f, 0x45, 0x4c, 0x46]);
  let fetchPath;
  const context = { int64: Int64, URLSearchParams, Uint8Array,
    window: { location: { search: '?autoload=payload.elf' } },
    fetch: async url => { fetchPath = url; return { ok: !notFound, status: 404, arrayBuffer: async () => bytes.buffer }; },
    SYS_MMAP: 'mmap', SYS_MUNMAP: 'munmap', SYS_SOCKET: 'socket', SYS_CONNECT: 'connect',
    SYS_CLOSE: 'close', SYS_WRITE: 'write', setTimeout };
  // Strip the ES module syntax so the file can run as a plain script; the
  // import strip has to tolerate CRLF (a Windows submodule checkout).
  const source = read('frontend/autoloader/relapse/src/kexp.js')
    .replace(/^import .*;\r?\n/gm, '').replaceAll('export async function', 'async function');
  vm.runInNewContext(source, context);
  const p = { malloc: () => new Int64(0x20000), write8() {}, write4() {}, write1() {}, read4: () => 0x464c457f };
  const chain = { async syscall(name, ...args) {
    calls.push([name, ...args]);
    return new Int64(name === 'mmap' ? 0x10000 : name === 'socket' ? 3 :
      name === 'write' ? (failWrite ? -1 : Math.min(1024, args[2])) : 0);
  } };
  // The patch's signature: (p, chain, autoload name, base dir, log).
  const result = context.loadAutoloadPayload(p, chain, 'payload.elf', '../payloads/', () => {});
  if (badElf || notFound) {
    await assert.rejects(result, badElf ? /not an ELF/ : /HTTP 404/);
    assert.equal(calls.length, 0, 'a bad payload must not touch the syscall chain');
  } else {
    if (failWrite) await assert.rejects(result, /socket write failed/);
    else {
      assert.equal(await result, bytes.length);
      assert.ok(calls.some(c => c[0] === 'write'), 'the payload is written to the socket');
    }
    // close must happen on every path that opened the socket, or elfldr's
    // fd table leaks into the rest of the session.
    assert.equal(calls.at(-1)[0], 'close');
  }
  assert.equal(fetchPath, '../payloads/payload.elf');
}

(async () => {
  offsets();
  await transfer();
  await transfer({ failWrite: true });
  await transfer({ badElf: true });
  await transfer({ notFound: true });
  console.log('PASS: routing, message isolation, offset readiness, payload handoff and failure cleanup');
})().catch(e => { console.error(e); process.exitCode = 1; });
