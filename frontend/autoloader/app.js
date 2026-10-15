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
     fetch, nothing to flash. ~24KB against a multi-megabyte page. */
  var LOGO = 'data:image/png;base64,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';

  function element(tag, id, parent, text) {
    var node = document.createElement(tag);
    node.id = id;
    if (text) node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  /* Splash screen: logo and name, fading out on the first milestone (or after
     a short fallback, so a silent chain never leaves the user on the splash). */
  var splash = document.createElement('div');
  splash.id = 'splash';
  splash.setAttribute('aria-hidden', 'false');
  var logo = document.createElement('img');
  logo.className = 'logo';
  logo.src = LOGO;
  logo.alt = NAME;
  splash.appendChild(logo);
  var title = document.createElement('h1');
  title.textContent = NAME;
  splash.appendChild(title);
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
  element('div', 'brand', loader, NAME + version +
    (config.buildTime ? ' (built ' + config.buildTime + ')' : ''));

  var percent = 0;
  var finished = false;
  var sent = false;
  var sweepTimer = 0;

  /* One pass of light across the bar per milestone, then it stops. Restarting
     the animation needs the class off, a reflow, and the class back on. */
  function sweep() {
    bar.className = '';
    void bar.offsetWidth;
    bar.className = 'sweep';
    if (sweepTimer) clearTimeout(sweepTimer);
    sweepTimer = setTimeout(function () { bar.className = ''; }, 1100);
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
    /* Failure tint: without a log view an error would be gone by the next
       tick, and a chain that dies mid-stage just looks stalled. */
    if (state === 'error') progress.className = 'bad';
    if (grown && percent < 100) sweep();
    if (percent > 10) dismissSplash();
  }
  update(0, 'Starting WebKit exploit...');

  function readLine(line) {
    var text = line.textContent || '';
    var error = /(?:^|\s)log-(?:error|minus)(?:\s|$)/.test(line.className);
    var summary = /queue finished: \d+\/\d+ completed, (\d+) failed/.exec(text);
    if (summary) {
      finished = true;
      if (Number(summary[1]) !== 0) update(percent, 'Autoload failed.', 'error');
      else update(100, sent ? 'Autoload finished.' : 'Payloads finished.', 'done');
      return;
    }
    if (/queue stopped:/.test(text)) {
      finished = true;
      if (error) update(percent, 'Stopped.', 'error');
      else if (/ELF loader is already accepting connections/.test(text))
        update(100, 'ELF loader already running. Nothing to do.', 'done');
      else update(percent, 'Stopped.', 'stopped');
      return;
    }
    if (error) {
      update(percent, 'An error occurred.', 'error');
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