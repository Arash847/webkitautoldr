(function () {
  'use strict';

  var splashEl = document.getElementById('splash');
  var loaderEl = document.getElementById('loader');
  var progressContainer = document.getElementById('progressContainer');
  var progressBar = document.getElementById('progressBar');
  var progressLabel = document.getElementById('progressLabel');
  var exploitEl = document.getElementById('exploit');

  /* After a WebProcess crash the PS5 browser restores this page together with
     the iframe at its last URL — the armed exploit URL, which would auto-run
     the chain again. Blank it as early as possible (the iframe element is
     already in the DOM at script parse) so the chain only runs after the
     splash screen. */
  try {
    exploitEl.src = 'about:blank';
  } catch (e) { }

  var finished = false;
  var chainStarted = false;
  var lastFrameUrl = '';
  var mirrorTimer = 0;

  /* Build-time exploit override: "auto" (firmware table), "umtx2" (FW
     1.00-5.50), "poops" (FW 7.00-12.00) or "relapse" (FW 7.00-13.60).
     Replaced by tools/gen_file_registry.py / build_host.py / dev_server.py
     from the FORCE_EXPLOIT env (default "auto"); left as the raw placeholder
     when served straight from source -> auto. A ?force= query on this page
     overrides it at runtime (handy for make dev). */
  var EXPLOIT_MODE = '[[EXPLOIT_MODE]]';
  if (EXPLOIT_MODE.indexOf('[[') === 0) EXPLOIT_MODE = 'auto';

  /* Firmware support definitions:
     - <= 5.50: umtx2
     - 7.00 - 12.00: poops
     - 7.00 - 13.60 (except 9.05, 11.40): relapse */
  function isUmtx2Supported(num) {
    var n = typeof num === 'number' ? num : parseFloat(num);
    return n > 0 && n <= 5.50;
  }

  function isPoopsSupported(num) {
    var n = typeof num === 'number' ? num : parseFloat(num);
    return n >= 7.00 && n <= 12.00;
  }

  function isRelapseSupported(num, str) {
    var n = typeof num === 'number' ? num : parseFloat(num);
    var s = str || (typeof num === 'string' ? num : '');
    var isExcluded = (s === '9.05' || s === '11.40' ||
                      Math.abs(n - 9.05) < 0.001 || Math.abs(n - 11.40) < 0.001);
    return n >= 7.00 && n <= 13.60 && !isExcluded;
  }

  var UMTX2_URL =
    'umtx2/index.html?autoload=payload.elf&v=1';
  /* Keep in sync with gen_file_registry.py iframe URLs — the AppCache
     manifest lists these exact URLs so the console can serve them offline
     (AppCache matches URLs including the query string). */
  var POOPS_URL =
    'slopkit/slopkit/poops.html?go=1&auto=1&production=1&trigger=netcontrol&attempts=8&only=ps0_preflight,ps1_prepare,ps3_stage0,ps4_validate,ps5_stage1,ps6_stage2,ps8_stage3,ps9_stage4,ps10_stage5&log=debug&payload=1&autoload=payload.elf&v=final';
  var RELAPSE_URL =
    'relapse/index.html?autoload=payload.elf';

  /* The slopkit chain (poops 7.00-12.00) keeps a one-shot latch and its
     "stopped at …" marker in sessionStorage under shared "slopkit-poops:*"
     keys. On the PS5 browser the shortcut session can outlive a console
     reboot, so a previous interrupted run would otherwise block every retry.
     Clear them right before arming so the full chain restarts from the top. */
  function clearSlopkitState() {
    try {
      sessionStorage.removeItem('slopkit-poops:next');
      sessionStorage.removeItem('slopkit-poops:latch');
    } catch (e) { }
  }

  var exploitMode = null;
  var progressPercent = 0;

  /* This build ships the compact UI: no log terminal, no footer. The progress
     bar and its label are the whole status surface, so uiLog() is a no-op —
     everything that used to go to the log reaches the user through
     setProgressLabel() / advance*Progress() / markProgressFailed() below. The
     export is kept because the exploit pages expect it to exist. */
  function uiLog(message, type, deferScroll) {
    return null;
  }

  function updateProgress(percent, message) {
    progressPercent = percent;
    /* The bar is a full-width pill scaled on the x axis (see style.css), not a
       sized element — so it can never reflow the label sitting on top of it. */
    progressBar.style.transform = 'scaleX(' + percent / 100 + ')';
    if (message) {
      progressLabel.textContent = message;
    }
  }

  window.uiLog = uiLog;
  window.updateProgress = updateProgress;

  function detectFirmware() {
    var m = /PlayStation 5\/(\d+\.\d+)/.exec(navigator.userAgent);
    if (!m) return null;
    return { str: m[1], num: parseFloat(m[1]) };
  }

  /* Choose which exploit to arm. Forced modes (build-time EXPLOIT_MODE or a
     ?force= query on this page) bypass the firmware table so a specific chain
     can be exercised on any firmware — the exploit page's own firmware guard
     still applies. Returns 'umtx2' | 'poops' | 'relapse' | null. */
  function pickExploit() {
    var fw = detectFirmware();
    var forced = null;
    try {
      var q = new URLSearchParams(window.location.search).get('force');
      if (q === 'umtx2' || q === 'poops' || q === 'relapse') forced = q;
    } catch (e) { }
    if (forced) {
      uiLog('[force] using ' + forced + ' on firmware ' + (fw ? fw.str : 'unknown'), 'warning');
      return forced;
    }
    if (EXPLOIT_MODE === 'umtx2' || EXPLOIT_MODE === 'poops' || EXPLOIT_MODE === 'relapse') {
      uiLog('[force] using ' + EXPLOIT_MODE + ' on firmware ' + (fw ? fw.str : 'unknown'), 'warning');
      return EXPLOIT_MODE;
    }
    if (!fw) {
      uiLog('[ERROR] Not a PlayStation 5 browser.', 'error');
      return null;
    }
    if (isUmtx2Supported(fw.num)) return 'umtx2';

    var hasPoops = isPoopsSupported(fw.num);
    var hasRelapse = isRelapseSupported(fw.num, fw.str);

    if (hasPoops && hasRelapse) {
      /* 7.00-12.00 supports both chains, so the installer page's choice is
         authoritative: localStorage first (the console never leaves the cached
         origin), then the native /selected_exploit route the installer wrote. */
      var stored = null;
      try {
        stored = localStorage.getItem('wkal_exploit');
      } catch (e) { }
      if (!stored) {
        try {
          var xhr = new XMLHttpRequest();
          xhr.open('GET', 'selected_exploit', false);
          xhr.send();
          if (xhr.status === 200 && xhr.responseText) {
            stored = xhr.responseText.trim();
          }
        } catch (e) { }
      }
      if (stored === 'relapse') return 'relapse';
      if (stored === 'poops') return 'poops';
      return 'relapse'; // default to relapse on dual firmwares
    }

    if (hasRelapse) return 'relapse';
    if (hasPoops) return 'poops';

    uiLog('[ERROR] Unsupported firmware ' + fw.str +
      ' (supported: 1.00-5.50 via umtx2, 7.00-12.00 via poops, 7.00-13.60 via relapse).', 'error');
    return null;
  }

  function revealExploit() {
    splashEl.classList.add('hide');
    setTimeout(function () {
      splashEl.hidden = true;
      loaderEl.hidden = false;
    }, 480);
  }

  function onAutoloadResult(data) {
    if (finished) return;
    if (exploitMode === 'poops') {
      mirrorSlopkit();
    } else {
      mirrorConsole(exploitMode);
    }
    finished = true;

    /* Success is terminal — stop mirroring so the page stays idle while the
       payload runs alongside it. On failure keep mirroring so the label holds
       the last state the chain reached. */
    if (data.ok && mirrorTimer) {
      clearInterval(mirrorTimer);
      mirrorTimer = 0;
    }
    if (data.ok) {
      markProgressFailed(false);
      uiLog('Payload loaded (' + data.bytes + ' bytes sent to elfldr).', 'success');
      updateProgress(100, 'Autoload finished.');

      /* Payload is running as its own process now — unload the iframe to
         free the memory it held and avoid a browser OOM dialog.
         NOTE: only safe for umtx2. relapse's document has to stay open: its
         ROP worker is still parked on a hijacked return slot, and tearing the
         document down would unwind that thread. Poops holds parked racers and
         fds for the same reason. */
      if (exploitMode === 'umtx2') {
        try { exploitEl.src = 'about:blank'; } catch (e) { }
      }
    } else {
      markProgressFailed(true);
      uiLog('[ERROR] Autoload failed: ' + (data.why || 'unknown error'), 'error');
      updateProgress(0, 'Autoload failed.');
    }
    setTimeout(function () {
      if (data.ok) {
        uiLog('Payload running on the console.', 'success');
      }
    }, 1500);
  }

  /* Mirror a chain's live #console log (#console > div) from the same-origin
     exploit iframe, so the UI shows what the chain is doing instead of a
     generic progress message.

     Both fast chains append to #console, so one mirror covers them. umtx2 marks
     severity with a class (LOG-ERROR / LOG-WARN / LOG-SUCCESS) and relapse
     with a text prefix ([+] info/success, [-] error, [*] log). Both also
     rewrite their last line in place for progress messages (umtx2's
     "Race attempt N-M"), so we re-read the last line after the loop. */
  var consoleMirror = { lines: 0, lastText: '' };

  function consoleSeverity(text, cls) {
    if (/LOG-ERROR/.test(cls) || /^\[-\]/.test(text)) return 'error';
    if (/LOG-WARN/.test(cls)) return 'warning';
    if (/LOG-SUCCESS/.test(cls) || /^\[\+\]/.test(text)) return 'success';
    return 'info';
  }

  /* Strip the exploit's "[*] " / "[+] " marker and clip to one line, so the
     slim progress label stays readable. Change-guarded — the mirror repaints
     on a timer and most ticks bring nothing new. */
  var lastLabel = '';
  function setProgressLabel(text) {
    var label = text.replace(/^\[[*+\-]\]\s*/, '').replace(/\s+/g, ' ');
    if (label.length > 68) label = label.slice(0, 65) + '...';
    if (label && label !== lastLabel) {
      lastLabel = label;
      progressLabel.textContent = label;
    }
  }

  /* Failures the user can actually do something about. Relapse's KASLR leak
     needs a network interface that holds an IPv4 address: with no lease (or
     no link at all) every address is 0.0.0.0 and the stage throws
     "kaslr: no interface has an address", which tells a user nothing. Internet
     access is NOT required — any interface with an address is enough, so a LAN
     lease or a static IP in the console's network settings both work. */
  var ERROR_HINTS = [
    { re: /no interface has an address/, label: 'Kernel: no interface address — connect a network, then reload' },
    { re: /routing socket|no routing reply/, label: 'Kernel: routing socket unavailable — connect a network, then reload' },
    { re: /Worker failed to load|never answered/, label: 'Chain stalled — reload the page to retry' }
  ];

  function hintFor(text) {
    for (var i = 0; i < ERROR_HINTS.length; i++) {
      if (ERROR_HINTS[i].re.test(text)) return ERROR_HINTS[i].label;
    }
    return null;
  }

  /* Relapse reports stages rather than a numerical percent. Advance the bar
     only when a known stage has completed; never move it backwards mid-run. */
  function advanceRelapseProgress(text) {
    var percent = 0;
    if (/Starting WebKit exploit/.test(text)) percent = 10;
    else if (/ARW ready/.test(text)) percent = 20;
    else if (/Worker chain: ready/.test(text)) percent = 35;
    else if (/Kernel: Starting kernel exploit/.test(text)) percent = 45;
    else if (/Kernel: read and write ready/.test(text)) percent = 60;
    else if (/Kernel: privileges ready/.test(text)) percent = 75;
    else if (/Kernel: payloads loaded|elfldr is listening/.test(text)) percent = 85;
    else if (/elfldr is up, sending/.test(text)) percent = 95;
    if (percent > progressPercent) updateProgress(percent);
  }

  /* Without a log view an error line would otherwise be gone by the next tick,
     and a chain that dies mid-stage just looks stalled. Tint the whole pill red
     on the first error and keep it there until the run recovers, so "this
     attempt failed" stays visible next to the progress it made. */
  function markProgressFailed(failed) {
    if (failed) {
      progressContainer.classList.add('bad');
    } else {
      progressContainer.classList.remove('bad');
    }
  }

  function mirrorConsole(prefix) {
    var doc;
    try {
      doc = exploitEl.contentDocument;
    } catch (e) {
      return;
    }
    if (!doc) return;

    /* Detect iframe navigation/reload: reset the mirror so a fresh document
       streams its log from the top. */
    var frameUrl = '';
    try {
      frameUrl = exploitEl.contentWindow.location.href;
    } catch (e) { }
    if (frameUrl !== lastFrameUrl) {
      lastFrameUrl = frameUrl;
      consoleMirror = { lines: 0, lastText: '' };
    }
    /* The iframe is intentionally empty until the chain is armed — nothing
       to mirror yet. */
    if (!chainStarted) return;

    var lines = doc.querySelectorAll('#console > div');
    if (lines.length === 0) {
      /* #console is created by the exploit page's own script, so it is absent
         while the document parses, and on any page that is not the exploit
         (a 404, an AppCache fallback, or a crash). Warn once per document
         once it has finished loading. Never re-arm from here: the chains
         start the moment they load, so a second load would race the first
         rather than recover from it — the user reloads instead. */
      if (doc.readyState === 'complete' && mirrorConsole.warned !== frameUrl) {
        mirrorConsole.warned = frameUrl;
        setProgressLabel('[iframe] no exploit log at "' + (frameUrl || 'about:blank')
          + '" — the chain may not have started. Reload the page to retry.');
        markProgressFailed(true);
      }
      return;
    }

    /* If the log shrank (the exploit caps it, or a fresh document replaced
       it), re-anchor the counter WITHOUT re-logging — those lines were
       already streamed, and re-streaming them would double the status. */
    if (lines.length < consoleMirror.lines) {
      consoleMirror.lines = lines.length;
    }
    for (; consoleMirror.lines < lines.length; consoleMirror.lines++) {
      showConsoleLine(prefix, lines[consoleMirror.lines]);
    }

    /* A rewrite of the last line never reaches the loop above, so re-read it. */
    if (lines.length > 0) {
      var last = lines[lines.length - 1];
      var lastText = (last.textContent || '').trim();
      if (lastText && lastText !== consoleMirror.lastText) {
        showConsoleLine(prefix, last);
      }
    }
  }

  /* One mirrored #console line -> the label, the bar and the failure tint.
     Centralised because a line arrives either as a new element or as a
     rewrite of the last one. */
  function showConsoleLine(prefix, el) {
    var text = (el.textContent || '').trim();
    if (!text) return;
    var severity = consoleSeverity(text, el.className || '');
    consoleMirror.lastText = text;
    uiLog('[' + prefix + '] ' + text, severity);
    if (severity === 'error') {
      markProgressFailed(true);
      /* An ordinary error keeps the last progress text in the label — where
         the run got to is still the useful thing. An error we can explain
         replaces it: the run is over, and the remedy is what matters now. */
      var hint = hintFor(text);
      if (hint) setProgressLabel(hint);
    } else {
      if (prefix === 'relapse') advanceRelapseProgress(text);
      if (severity === 'info' || severity === 'success') {
        /* Neither chain has a separate stage/progress element, so surface the
           newest non-error line as the progress label — that is the only
           "what is it doing right now" signal the exploit gives us. */
        setProgressLabel(text);
      }
    }
  }

  var slopkitMirroredLines = 0;
  var slopkitLastStageText = '';
  var slopkitLastStageCls = '';
  var slopkitLastSummaryText = '';
  var slopkitRepairCount = 0;
  var slopkitEarlyLinesLogged = 0;

  /* Same monotonic rule as relapse: the bar only grows, so a late stage line
     can never rewind a run that already reported a later stage. */
  function advancePoopsProgress(text) {
    var percent = 0;
    if (/STAGE0|STAGE 0|PREFLIGHT/i.test(text)) percent = 20;
    else if (/STAGE1|STAGE 1/i.test(text)) percent = 35;
    else if (/STAGE2|STAGE 2/i.test(text)) percent = 50;
    else if (/STAGE3|STAGE 3/i.test(text)) percent = 65;
    else if (/STAGE4|STAGE 4/i.test(text)) percent = 80;
    else if (/STAGE5|STAGE 5|POOPS-COMPLETE|POOPS-VERDICT/i.test(text)) percent = 95;
    if (percent > progressPercent) updateProgress(percent);
  }

  function mirrorSlopkit() {
    var doc;
    try {
      doc = exploitEl.contentDocument;
    } catch (e) {
      return;
    }
    if (!doc) return;

    var frameUrl = '';
    try {
      frameUrl = exploitEl.contentWindow.location.href;
    } catch (e) { }
    if (frameUrl !== lastFrameUrl) {
      lastFrameUrl = frameUrl;
      slopkitMirroredLines = 0;
      slopkitLastStageText = '';
      slopkitLastStageCls = '';
      slopkitLastSummaryText = '';
      slopkitEarlyLinesLogged = 0;
    }
    if (!chainStarted) return;

    var scr = doc.getElementById('scr');
    if (!scr) {
      var isArmedUrl = frameUrl.length > POOPS_URL.length &&
        frameUrl.slice(-POOPS_URL.length) === POOPS_URL;
      if (frameUrl === 'about:blank' || doc.readyState !== 'complete' || isArmedUrl) {
        return;
      }
      var arm = doc.getElementById('arm');
      var start = doc.getElementById('start');
      var isSlopkitPage = !!start || (arm && !arm.hidden);
      if (chainStarted && isSlopkitPage && slopkitRepairCount < 5) {
        slopkitRepairCount++;
        setProgressLabel('[iframe] re-arming (attempt ' + slopkitRepairCount + ')');
        try {
          exploitEl.src = POOPS_URL;
        } catch (e) { }
      }
      return;
    }

    var lines = scr.textContent.split('\n');
    if (lines.length < slopkitMirroredLines) {
      slopkitMirroredLines = lines.length;
    }
    for (; slopkitMirroredLines < lines.length; slopkitMirroredLines++) {
      var line = lines[slopkitMirroredLines].trim();
      if (!line) continue;
      if (/^>/.test(line) || /^\[\+\]/.test(line)
        || /^(STAGE[0-5]|ALLPROC-CHECK|ALIASES-REPAIRED|POOPS-COMPLETE|POOPS-VERDICT|LATCH-HELD|LATCH-READ|OFFSETS-READY|WEBKIT-BASE|MODULE-BASES|SOCKETS|SPAWN|WAKEGATE)/.test(line)) {
        uiLog('[poops] ' + line, 'info');
        advancePoopsProgress(line);
      } else if (/FAIL|ERROR|REFUSED|REBOOT|failed|panic|exception/i.test(line)
        || /^\[-\]/.test(line)) {
        uiLog('[poops] ' + line, 'error');
        /* Poops failures are its own report lines, so the label can take the
           stage verdict; the pill tint is what makes it stick. */
        setProgressLabel(line);
        markProgressFailed(true);
      }
    }

    var stage = doc.getElementById('stage');
    if (stage && stage.textContent !== slopkitLastStageText) {
      slopkitLastStageText = stage.textContent;
      slopkitLastStageCls = stage.className || '';
      setProgressLabel(slopkitLastStageText);
      advancePoopsProgress(slopkitLastStageText);
      if (slopkitLastStageCls.indexOf('bad') !== -1) {
        uiLog('[stage] ' + slopkitLastStageText, 'error');
        markProgressFailed(true);
      } else if (slopkitLastStageCls.indexOf('ok') !== -1) {
        uiLog('[stage] ' + slopkitLastStageText, 'success');
      } else {
        uiLog('[stage] ' + slopkitLastStageText, 'info');
      }
    }

    var summary = doc.getElementById('summary');
    if (summary && summary.textContent && summary.textContent !== slopkitLastSummaryText) {
      var summaryLines = summary.textContent.split('\n');
      for (var i = 0; i < summaryLines.length; i++) {
        var sline = summaryLines[i].trim();
        if (sline && /FAIL|ERROR|REFUSED|REBOOT|failed|panic/i.test(sline)) {
          uiLog('[summary] ' + sline, 'error');
          markProgressFailed(true);
        }
      }
      slopkitLastSummaryText = summary.textContent;
    }

    var early = doc.getElementById('early');
    if (early && early.textContent) {
      var earlyLines = early.textContent.split('\n');
      if (earlyLines.length < slopkitEarlyLinesLogged) {
        slopkitEarlyLinesLogged = 0;
      }
      for (; slopkitEarlyLinesLogged < earlyLines.length; slopkitEarlyLinesLogged++) {
        var eline = earlyLines[slopkitEarlyLinesLogged].trim();
        if (eline) {
          uiLog('[early] ' + eline, /ERROR|FAIL/i.test(eline) ? 'error' : 'info');
          if (/ERROR|FAIL/i.test(eline)) markProgressFailed(true);
        }
      }
    }
  }

  function start() {
    uiLog('WebKit Autoloader by PLK', 'success');
    updateProgress(0, 'Waiting to start...');

    window.addEventListener('message', function (event) {
      var data = event.data;
      if (event.source !== exploitEl.contentWindow || !data || data.type !== 'wkal') return;
      if (data.kind === 'log' && exploitMode === 'relapse') {
        mirrorConsole(exploitMode);
        return;
      }
      if (data.kind === 'autoload') {
        onAutoloadResult(data);
      }
    });

    /* No iframe 'load' listener: it used to reset the mirror counters, which
       re-streamed the whole log mid-run. The URL-diff branch in
       mirrorConsole() and the shrink re-anchor already cover a fresh
       document (its #console starts empty, so its lines stream normally). */

    var picked = pickExploit();
    if (!picked) {
      updateProgress(0, 'Unsupported firmware.');
      return;
    }
    exploitMode = picked;
    var exploitUrl = picked === 'umtx2' ? UMTX2_URL
      : picked === 'poops' ? POOPS_URL
        : RELAPSE_URL;
    updateProgress(5);

    if (picked === 'poops') {
      mirrorTimer = setInterval(mirrorSlopkit, 500);
      clearSlopkitState();
    } else {
      mirrorTimer = setInterval(function () { mirrorConsole(exploitMode); }, 500);
    }

    /* umtx2 auto-runs its chain on load when sessionStorage 'on_load_autorun'
       is set (it clears it itself once main() starts); clear it on the
       relapse/poops paths so a stale key never re-triggers it. */
    try {
      if (picked === 'umtx2') {
        sessionStorage.setItem('on_load_autorun', 'kernel');
        sessionStorage.setItem('wkal_autoload', 'payload.elf');
      } else {
        sessionStorage.removeItem('on_load_autorun');
        sessionStorage.removeItem('wkal_autoload');
      }
    } catch (e) { }

    chainStarted = true;
    try {
      exploitEl.src = exploitUrl;
    } catch (e) { }

    setTimeout(revealExploit, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();