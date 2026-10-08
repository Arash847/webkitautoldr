// Presentation only: runs through the standalone builder's awaited --js hook.
// Keep the actual console, payloads and exploit in this document.
//
// This fork ships the compact UI: the progress pill is the whole status
// surface, so the console stays hidden (style.css) and there is no log
// terminal. Everything worth seeing arrives through update().
(function () {
  'use strict';
  var output = document.getElementById('console');
  if (!output || document.getElementById('loader')) return;

  var NAME = 'PS Torghabeh WebkitAutoldr';
  var config = window.WKAL_PAGE || {};
  var version = config.version ? ' v' + config.version : '';
  document.title = NAME + version;

  function element(tag, id, parent, text) {
    var node = document.createElement(tag);
    node.id = id;
    if (text) node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  /* Splash screen: brand mark plus name, fading out once the chain reports
     its first milestone (or after a short fallback, so a silent chain never
     leaves the user staring at the splash). */
  var splash = document.createElement('div');
  splash.id = 'splash';
  splash.setAttribute('aria-hidden', 'false');
  splash.innerHTML =
    '<svg class="logo" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg" ' +
    'role="img" aria-label="' + NAME + '">' +
    '<defs><linearGradient id="wkalMark" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#1d4ed8"/>' +
    '<stop offset="45%" stop-color="#2563eb"/>' +
    '<stop offset="100%" stop-color="#38bdf8"/>' +
    '</linearGradient></defs>' +
    '<circle cx="64" cy="64" r="52" fill="none" stroke="url(#wkalMark)" ' +
    'stroke-width="5" opacity="0.85"/>' +
    '<circle cx="64" cy="64" r="39" fill="none" stroke="rgba(56,189,248,0.3)" ' +
    'stroke-width="2"/>' +
    '<path d="M72 30 L46 71 h14 l-6 27 26-42 h-15 z" fill="url(#wkalMark)"/>' +
    '</svg><h1>' + NAME + '</h1>';
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
  function update(next, message, state) {
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