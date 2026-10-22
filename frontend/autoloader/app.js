// Presentation only: runs through the standalone builder's awaited --js hook.
// Keep the actual console, payloads and exploit in this document.
//
// This fork ships the compact UI: the progress pill is the whole status
// surface, so the console stays hidden (style.css) and there is no log
// terminal. Everything worth seeing arrives through update().
//
// Motion is event-driven: the bar grows and sweeps once per milestone, the
// pill blooms once at 100%. Nothing loops forever, so the page stays calm
// instead of shimmering for the minutes a chain can take.
(function () {
  'use strict';
  var output = document.getElementById('console');
  if (!output || document.getElementById('loader')) return;

  var NAME = 'PS Torghabeh WebkitAutoldr';
  var config = window.WKAL_PAGE || {};
  var version = config.version ? ' v' + config.version : '';
  document.title = NAME + version;

  /* Our logo, inlined from assets/icon.svg (the 1024px PNG that file wraps,
     palette-reduced to 256px). The page is generated and has no image asset
     to point at, so it travels as a data URI: no extra request, nothing to
     fetch, nothing to flash. ~18KB against a multi-megabyte page.

     The alpha has to survive that reduction: 45% of the source pixels are
     fully transparent, and a palette PNG saved with a made-up transparency
     index bakes the backdrop into opaque black. Save the reduced image as-is
     (mode P plus its own tRNS) - no transparency= argument. */
  var LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAMAAABrrFhUAAADAFBMVEWeYVLeWhrinltpVVpeKR/q1Z3b2s2wmGXdpWBvGAzeUBKiUiSrVRfPWx7p06nix6OmiW6iMAzXtpbQp4nr2srgqZnZTQ7Jbk/UmWE2WGe5z9L822grKC6gbVKWHSNsRizgqF7OOAl8cBLYjjffLAjaPAfjPQWzqpVdNUavpZ0uCQzkjDlhbYJ5gXt+kpO3jlrkijrxxXT8xivTa1G5azcKFUB0WUyGPELbhDjwwn///1XZvaPl0MC7fkSIf4A+QD+q/6q+PRsAAAANAxkuAhf2NAANCSJOAxQqEyhuBRAQFCz7/PL7hxP6eA0rCyP0RwRxFhP2Vwf3aAqMBQmMGAxNFiayuK2SJRLRKQOvJgj6lRb6pS3799GwFwiQl5T6mCesBgVTExD62Y7Lxq365q6tNhAxN0v6yWvSNwj////ORw76t0zMGQJuJCn4qBNKR1Pw2KtpaG0uJjdzdnitppdoGiPw6c7oKgGMKSRHDCLSVg76w1UXKUX99bT85JakrKSHiIb71HX/AAATIzlQJTDGuqazRQ2RNitUWmXOt5d0JBeXMxX4tTHryJKap6JHOkrRmHH6sxj//6q6w7X/VQDJd1D0iCd5hYrneCnSaCpteoetSCrICQP/fwDut2vVpHW0VzAxQ1bP18iXoptSVFr/qlX//wD0qUrLWChXZW8vLELmyqfv7ebkt47U07bJiWk3SGaziG/Xdi2oOiccNEqomo3//380ExTQhlJyNjC0dlSNd23/f3/w5dW5ZDd/f38AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOgz+tAAAAwHRSTlP/7vf//+j3GFMHnv4MIpdr/xZT/6gjXv8n///4/xb//5wgBvHtX5///xAGl////01kqf8RWP8M/zBgA4F1af//A1MA/v7+/v7//v7+/v7//f/+/v/+///+//7+/v7///7///7//f7//f8B//7//////v//////+v////7+//7+///+Af////7///////7////+/wP/A//+//3/////Avz///////8DAf7/////9f///////////wL//////wLR/wL7PnHaAABCgklEQVR42u2di0NTV7bww0M7irZY29p+2namdqaPOzP3zsy9373fvd+TnJyTIElOkgMngYSQkJCUR3kKAoKgCPJSpg4oUhUfU7VWHV/11Tr/2rfW2nufcxISnup07mW3pRDCyVm/vV577cexlf0Xb7ZNAJsANgFsAtgEsAlgE8AmgE0AmwA2AWwC2ASwCWATwCaATQCbAF5JO/oFtL+yht/+lwHwzRdffJVTYHwRfnP0PzGAb763Cr7t/fdfe+2z16i9//42K4jvv/jPB+CLz7js2157+43/+dZbb/3443fffXeA/oW29ccf4bU33nj73W2cwld//U8E4Hsm/La33wDBDyzbvvvxrdffeHsHp3D0PwGAo6bwP353YJUN1OHNd18RA9tL7nv8+tkbb221yhcOJxLx+DC0FLXh4Xh8MNEdzoDQ/dYbb3+ODL7/uwVALu/zt1+39Hw4ER9O9U9N/TFHm/p9f/9wPIPDj6+/vY1f5+8PAN31Zxa9DyeGUfQvv/ySS/yl0VD8qT8Sl6mpqf7hwW6Twf98++WqwUsC8Bn89/6bbwnpu+PQ74bU1dUVbrff7zOa3+93V1RUw6+mmHZM9acGDU146433Oc+/FwBHv4Ivb78lujER75/i3Q2S+31ehyOdbmwk0Quo+RobG9PQvD53RXU115Cp/njC8AegBl+8/fcCAMU3Oh/13pDdC5I7vL6Cs2fPut0geB+269fn5+/BK3Nnzxb0EQW/u5rbRX9c6AEh+OzvAQDc6OdvcqcfjnPpK9w+L4pWgEI2JkNaIBBwGS2ATYuERq/PA4aCAtAGrx8tYqqmZqpf2MJbb74UBC8YAFrqmzzZSaSmWNf7UfiCgrPzjUndKniOFtBCo/OgDvON6UYfKkINYBjutiD44acM4K9fGOKHB/tN6X0oPHS7a3UtoCWvg1GAPRADQNCfsCD44icL4At0fUL3ydu7Qfrr0J/JZYRXobnUbAYAATThejrtr2AIBk1f8PZPEwCY5/vM9YXjU6zzHcFG6MhkIFvevC1LEUbv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';

  function element(tag, id, parent, text) {
    var node = document.createElement(tag);
    node.id = id;
    if (text) node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  /* Splash screen: logo and name, fading out on the first milestone (or after
     a short fallback, so a silent chain never leaves the user on the splash).
     The logo and name sit in #splashStack, which the stylesheet centres by
     translation — see the note there about why flexbox alone was not enough. */
  var splash = document.createElement('div');
  splash.id = 'splash';
  splash.setAttribute('aria-hidden', 'false');
  var stack = document.createElement('div');
  stack.id = 'splashStack';
  var logo = document.createElement('img');
  logo.className = 'logo';
  logo.src = LOGO;
  logo.alt = NAME;
  stack.appendChild(logo);
  var title = document.createElement('h1');
  title.textContent = NAME;
  stack.appendChild(title);
  splash.appendChild(stack);
  document.body.appendChild(splash);

  var splashGone = false;
  var splashTimer = 0;
  function dismissSplash() {
    if (splashGone) return;
    splashGone = true;
    if (splashTimer) clearTimeout(splashTimer);
    splash.className = 'hide';
    splash.setAttribute('aria-hidden', 'true');
  }
  splashTimer = setTimeout(dismissSplash, 2500);

  var loader = element('main', 'loader', document.body);
  var wrapper = element('div', 'logWrapper', loader);
  wrapper.appendChild(output);
  var progress = element('div', 'progressContainer', loader);
  progress.setAttribute('role', 'progressbar');
  progress.setAttribute('aria-valuemin', '0');
  progress.setAttribute('aria-valuemax', '100');
  var bar = element('div', 'progressBar', progress);
  var label = element('div', 'progressLabel', progress);
  element('div', 'brand', loader, NAME);

  var percent = 0;
  var finished = false;
  var sent = false;
  var sweepTimer = 0;
  var lastLineAt = 0;
  var lastProgressAt = 0;
  var lastError = '';

  /* Silence watchdog.

     A standalone page always closes with the queue's summary line, except when
     run() itself throws — site.js catches that and writes one bare error line,
     then the page goes completely quiet forever. 20s of total silence with no
     progress is the only signal available for that, and it is deliberately
     slow: a quiet-but-working chain just says so instead of turning red. */
  var QUIET_MS = 20000;
  var quietTimer = setInterval(function () {
    if (finished) return;
    var t = now();
    if (t - lastLineAt < QUIET_MS) return;
    if (t - lastProgressAt < QUIET_MS) return;
    finished = true;
    if (lastError) update(percent, lastError, 'error');
    else update(percent, 'Still working...', 'stopped');
  }, 1000);
  lastLineAt = lastProgressAt = now();

  /* One pass of light across the bar per milestone, then it stops. Restarting
     the animation needs the class off, a reflow, and the class back on. */
  function sweep() {
    bar.className = '';
    void bar.offsetWidth;
    bar.className = 'sweep';
    if (sweepTimer) clearTimeout(sweepTimer);
    sweepTimer = setTimeout(function () { bar.className = ''; }, 1100);
  }

  /* The failure tint describes the current state, it does not latch. */
  function setFailed(on) {
    progress.className = on ? 'bad' : '';
  }

  function now() {
    return (window.performance && window.performance.now) ? window.performance.now() : Date.now();
  }

  /* One line, no marker, short enough for the pill. */
  function brief(text) {
    var t = String(text).replace(/\s+/g, ' ').replace(/^\[[-+*!]\]\s*/, '').trim();
    return t.length > 96 ? t.slice(0, 95).replace(/\s+\S*$/, '') + '…' : t;
  }

  function update(next, message, state) {
    var grown = next > percent;
    percent = Math.max(percent, next);
    /* The bar is a full-width pill scaled on the x axis (see style.css), not a
       sized element — so it can never reflow the label sitting on top of it. */
    bar.style.transform = 'scaleX(' + (percent / 100) + ')';
    bar.style.webkitTransform = 'scaleX(' + (percent / 100) + ')';
    label.textContent = message;
    progress.setAttribute('aria-valuenow', String(percent));
    progress.setAttribute('aria-valuetext', message);
    progress.setAttribute('data-state', state || 'running');
    if (grown) lastProgressAt = now();
    if (state === 'error') setFailed(true);
    else if (state === 'done' || grown) setFailed(false);
    if (grown && percent < 100) sweep();
    if (percent > 10) dismissSplash();
  }
  update(0, 'Starting WebKit exploit...');

  /* Why an error-typed line is not a failure signal here.

     The page scripts log with the error type for "I could not do X" as well as
     for real failures: a probe that finds nothing listening yet, a payload
     reporting a socket it retried, and site.js's catch-all on any throw all
     land in the console as error lines. Keying the pill on that class made it
     shout "An error occurred" mid-run and then keep shouting, which is worse
     than silence — with the log viewer off the user could not even find out
     what it was complaining about.

     So error-typed lines are captured as a possible reason and otherwise
     ignored. The queue's own closing line is the authoritative verdict
     ("N/M completed, K failed", "queue stopped"), and the watchdog below
     covers the one case it cannot: the page dying before any closing line. */
  function readLine(line) {
    var text = line.textContent || '';
    lastLineAt = now();
    var error = /(?:^|\s)log-(?:error|minus)(?:\s|$)/.test(line.className);
    var summary = /queue finished: \d+\/\d+ completed, (\d+) failed/.exec(text);
    var stopped = /queue stopped:/.test(text);
    /* Captured before the closing lines are handled, and skipped for them: the
       summary is error-typed too when something failed, and it would otherwise
       overwrite the reason it is reporting. */
    if (error && text && !summary && !stopped) lastError = brief(text);
    if (summary) {
      finished = true;
      if (Number(summary[1]) !== 0) {
        setFailed(true);
        update(percent, lastError || 'Autoload failed.', 'error');
      } else {
        update(100, sent ? 'Autoload finished.' : 'Payloads finished.', 'done');
      }
      return;
    }
    if (stopped) {
      finished = true;
      if (error) {
        setFailed(true);
        update(percent, lastError || 'Stopped.', 'error');
      } else if (/ELF loader is already accepting connections/.test(text))
        update(100, 'ELF loader already running. Nothing to do.', 'done');
      else update(percent, 'Stopped.', 'stopped');
      return;
    }
    if (finished) return;
    if (/Autoload: sent \d+ bytes/.test(text)) {
      sent = true;
      update(98, 'Finishing autoload...');
    } else if (/\[3\/3\].*autoload\.js/.test(text)) update(95, 'Loading autoload payload...');
    else if (/payloads loaded|elfldr.*listening/i.test(text)) update(90, 'ELF loader ready...');
    else if (/privileges ready/i.test(text)) update(80, 'Privileges ready...');
    else if (/read and write ready/i.test(text)) update(65, 'Kernel read/write ready...');
    else if (/Starting kernel exploit|\[2\/3\]/i.test(text)) update(40, 'Starting kernel exploit...');
    else if (/\[1\/3\].*elfldr-check\.js/.test(text)) update(35, 'Checking ELF loader...');
    else if (/Worker chain: ready/i.test(text)) update(30, 'WebKit ready...');
    else if (/ARW ready/i.test(text)) update(20, 'Preparing WebKit...');
    else if (/Starting WebKit exploit/i.test(text)) update(10, 'Starting WebKit exploit...');
    else {
      var stage = /\bSTAGE\s*([0-5])\b/i.exec(text);
      if (stage) update(40 + Number(stage[1]) * 10, 'Running kernel exploit...');
    }
  }

  // Observe the native log instead of replacing writeLog or the module APIs.
  // Process only changed lines, including in-place stage updates.
  var observer = new MutationObserver(function (records) {
    var changed = [];
    function remember(node) {
      if (node.nodeType !== 1) node = node.parentNode;
      while (node && node.parentNode !== output) node = node.parentNode;
      if (node && changed.indexOf(node) < 0) changed.push(node);
    }
    records.forEach(function (record) {
      if (record.target === output) {
        for (var i = 0; i < record.addedNodes.length; i++) remember(record.addedNodes[i]);
      } else remember(record.target);
    });
    changed.forEach(readLine);
    while (output.children.length > 80) output.removeChild(output.firstElementChild);
    wrapper.scrollTop = wrapper.scrollHeight;
  });
  observer.observe(output, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
}());