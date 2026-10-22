// Host-only checks for the compact UI in frontend/autoloader/app.js.
//
// The page scripts log with the error type for "I could not do X" as well as
// for real failures, so the pill must not treat an error-typed line as a
// verdict: it hijacked the label mid-run and the run looked broken when it
// was not. These tests drive app.js with a tiny fake DOM and synthetic log
// lines and pin the behaviour that matters on a TV:
//
//   * an error line alone changes nothing;
//   * the queue's closing line is the only authoritative verdict;
//   * a run that dies before any closing line reports its last message.
//
//   node tests/ui_progress.test.cjs
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = path.join(__dirname, "..", "frontend", "autoloader", "app.js");

function node(tag) {
  return {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    id: "",
    className: "",
    textContent: "",
    alt: "",
    src: "",
    style: {},
    attrs: {},
    children: [],
    parentNode: null,
    scrollTop: 0,
    scrollHeight: 0,
    setAttribute(key, value) { this.attrs[key] = value; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    get firstElementChild() { return this.children.length ? this.children[0] : null; },
  };
}

function byId(root, id) {
  if (root.id === id) return root;
  for (const child of root.children) {
    const hit = byId(child, id);
    if (hit) return hit;
  }
  return null;
}

// A page with just enough DOM for app.js: a #console to watch, no #loader, and
// a clock the test drives by hand.
function environment() {
  const body = node("body");
  const output = node("div");
  output.id = "console";
  body.appendChild(output);

  const timeouts = [];
  const intervals = [];
  let clock = 0;

  const document = {
    body,
    createElement: (tag) => node(tag),
    getElementById: (id) => byId(body, id),
    get title() { return this._title || ""; },
    set title(v) { this._title = v; },
  };

  const sandbox = {
    document,
    window: {
      WKAL_PAGE: { version: "0.0.0-test", buildTime: "2026-01-01 00:00:00 UTC" },
      performance: { now: () => clock },
    },
    MutationObserver: class {
      constructor(cb) { this.cb = cb; sandbox.observer = this; }
      observe() {}
      disconnect() {}
    },
    setTimeout: (fn, ms) => { timeouts.push({ fn, at: clock + (ms || 0) }); return timeouts.length; },
    clearTimeout: () => {},
    setInterval: (fn, ms) => { intervals.push({ fn, every: ms || 1000 }); return intervals.length; },
    clearInterval: () => {},
    Math,
    Number,
    String,
    console,
  };
  sandbox.window.window = sandbox.window;

  return {
    sandbox,
    output,
    body,
    advance(ms) { clock += ms; },
    tick() { for (const i of intervals) i.fn(); },
  };
}

function boot(env) {
  vm.runInNewContext(fs.readFileSync(APP, "utf8"), env.sandbox);
  return {
    label: () => env.sandbox.document && labelText(env),
    // Feed one log line the way the page scripts write them.
    line(text, cls) {
      const n = node("div");
      n.className = "log-line " + cls;
      n.textContent = text;
      env.output.appendChild(n);
      env.sandbox.observer.cb([{ target: env.output, addedNodes: [n], removedNodes: [] }]);
      env.advance(10);
    },
  };
}

function labelText(env) {
  const el = byId(env.body, "progressLabel");
  return el ? el.textContent : null;
}

function pill(env) {
  return byId(env.body, "progressContainer");
}

function percent(env) {
  const el = pill(env);
  return el ? Number(el.attrs["aria-valuenow"]) : null;
}

// 1. An error-typed line on its own must not touch the label or the tint.
{
  const env = environment();
  const ui = boot(env);
  assert.strictEqual(labelText(env), "Starting WebKit exploit...");
  ui.line("Starting WebKit exploit...", "log-setup");
  assert.strictEqual(percent(env), 10);
  ui.line("[-] kaslr: no interface has an address", "log-error");
  assert.strictEqual(labelText(env), "Starting WebKit exploit...", "error line hijacked the label");
  assert.notStrictEqual(pill(env).className, "bad", "error line turned the pill red");
  assert.strictEqual(percent(env), 10, "error line moved the bar");
}

// 2. A clean run: the queue's summary is the verdict, and no red anywhere.
{
  const env = environment();
  const ui = boot(env);
  ui.line("ARW ready", "log-info");
  ui.line("[-] probe: nothing listening yet", "log-error"); // routine mid-run noise
  ui.line("Worker chain: ready", "log-info");
  ui.line("=== [1/3] elfldr-check.js ===", "log-success");
  assert.strictEqual(labelText(env), "Checking ELF loader...");
  ui.line("=== [2/3] relapse.js ===", "log-success");
  ui.line("read and write ready", "log-success");
  ui.line("=== [3/3] autoload.js ===", "log-success");
  assert.strictEqual(labelText(env), "Loading autoload payload...");
  ui.line("Autoload: sent 2526736 bytes of autoload.elf to elfldr.", "log-success");
  ui.line("=== queue finished: 3/3 completed, 0 failed ===", "log-success");
  assert.strictEqual(percent(env), 100);
  assert.strictEqual(labelText(env), "Autoload finished.");
  assert.notStrictEqual(pill(env).className, "bad", "a successful run ended up red");
}

// 3. A failed queue reports its reason instead of a generic banner.
{
  const env = environment();
  const ui = boot(env);
  ui.line("=== [1/3] elfldr-check.js ===", "log-success");
  ui.line("[-] The exploit did not complete; no ELF was sent.", "log-error");
  assert.notStrictEqual(pill(env).className, "bad", "red before the run had actually failed");
  ui.line("=== queue finished: 1/3 completed, 1 failed ===", "log-error");
  assert.strictEqual(pill(env).className, "bad", "a failed run did not turn the pill red");
  assert.strictEqual(labelText(env), "The exploit did not complete; no ELF was sent.");
}

// 4. The page dies before any summary: silence is the only signal, and it
//    reports the last thing the chain said.
{
  const env = environment();
  const ui = boot(env);
  ui.line("=== [2/3] relapse.js ===", "log-success");
  ui.line("[-] socket() failed", "log-error");
  assert.notStrictEqual(pill(env).className, "bad");
  env.advance(19000);
  env.tick();
  assert.notStrictEqual(pill(env).className, "bad", "19s of quiet is not a failure");
  env.advance(2000); // now past 20s of silence
  env.tick();
  assert.strictEqual(pill(env).className, "bad");
  assert.strictEqual(labelText(env), "socket() failed");
}

// 5. A quiet but healthy run says "Still working" rather than turning red.
{
  const env = environment();
  const ui = boot(env);
  ui.line("=== [2/3] relapse.js ===", "log-success");
  env.advance(25000);
  env.tick();
  assert.strictEqual(labelText(env), "Still working...");
  assert.notStrictEqual(pill(env).className, "bad", "a quiet run turned red with no error seen");
}

// 6. Once a closing line has landed, the watchdog is disarmed: 60s of silence
//    after a terminal verdict must not overwrite what it said.
{
  const env = environment();
  const ui = boot(env);
  ui.line("=== [1/3] elfldr-check.js ===", "log-success");
  ui.line("[-] The ELF loader did not start on port 9021.", "log-error");
  ui.line("=== queue finished: 1/3 completed, 1 failed ===", "log-error");
  const verdict = labelText(env);
  assert.strictEqual(verdict, "The ELF loader did not start on port 9021.");
  assert.strictEqual(pill(env).className, "bad");
  env.advance(60000);
  env.tick();
  assert.strictEqual(labelText(env), verdict, "the watchdog spoke over a finished run");
  assert.strictEqual(pill(env).className, "bad");
}

console.log("Compact UI checks passed: error lines never hijack the pill, the queue summary decides, silence reports the last message.");