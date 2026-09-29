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
     1.00-5.50) or "relapse" (FW 7.00-13.60). Replaced by
     tools/gen_file_registry.py / build_host.py / dev_server.py from the
     FORCE_EXPLOIT env (default "auto"); left as the raw placeholder when
     served straight from source -> auto. A ?force= query on this page
     overrides it at runtime (handy for make dev). */
  var EXPLOIT_MODE = '[[EXPLOIT_MODE]]';
  if (EXPLOIT_MODE.indexOf('[[') === 0) EXPLOIT_MODE = 'auto';

  /* Firmwares supported by each exploit, keyed on the exact UA firmware
     string (/PlayStation 5/x.xx/). Keep in sync with the exploits' own lists:
     relapse's src/firmware.js and umtx2's document/en/ps5/main.js. */
  var UMTX2_FIRMWARES = ["1.00", "1.01", "1.02", "1.05", "1.10", "1.11", "1.12", "1.13", "1.14", "2.00", "2.20", "2.25", "2.26", "2.30", "2.50", "2.70", "3.00", "3.10", "3.20", "3.21", "4.00", "4.02", "4.03", "4.50", "4.51", "5.00", "5.02", "5.10", "5.50"];
  var RELAPSE_FIRMWARES = ["7.00", "7.01", "7.20", "7.40", "7.60", "7.61", "8.00", "8.20", "8.40", "8.60", "9.00", "9.20", "9.40", "9.60", "10.00", "10.01", "10.20", "10.40", "10.60", "11.00", "11.20", "11.60", "12.00", "12.02", "12.20", "12.40", "12.60", "12.70", "13.00", "13.20", "13.40", "13.42", "13.60"];

  var UMTX2_URL =
    'umtx2/index.html?autoload=payload.elf&v=1';
  /* Keep in sync with relapse_iframe_url in tools/gen_file_registry.py — the
     AppCache manifest lists these exact URLs so the console can serve them
     offline (AppCache matches URLs including the query string). Both chains
     auto-run on load; only umtx2 needs the sessionStorage key set below. */
  var RELAPSE_URL =
    'relapse/index.html?autoload=payload.elf';

  var exploitMode = null;
  var progressPercent = 0;

  /* This build ships the compact UI: no log terminal, no footer. The progress
     bar and its label are the whole status surface, so uiLog() is a no-op —
     everything that used to go to the log reaches the user through
     setProgressLabel() / advanceRelapseProgress() / markProgressFailed() below.
     The export is kept because the exploit pages expect it to exist. */
  function uiLog(message, type) {
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
     still applies. Returns 'umtx2' | 'relapse' | null. */
  function pickExploit() {
    var fw = detectFirmware();
    var forced = null;
    try {
      var q = new URLSearchParams(window.location.search).get('force');
      if (q === 'umtx2' || q === 'relapse') forced = q;
    } catch (e) { }
    if (forced) {
      uiLog('[force] using ' + forced + ' on firmware ' + (fw ? fw.str : 'unknown'), 'warning');
      return forced;
    }
    if (EXPLOIT_MODE === 'umtx2' || EXPLOIT_MODE === 'relapse') {
      uiLog('[force] using ' + EXPLOIT_MODE + ' on firmware ' + (fw ? fw.str : 'unknown'), 'warning');
      return EXPLOIT_MODE;
    }
    if (!fw) {
      uiLog('[ERROR] Not a PlayStation 5 browser.', 'error');
      return null;
    }
    if (UMTX2_FIRMWARES.indexOf(fw.str) !== -1) return 'umtx2';
    if (RELAPSE_FIRMWARES.indexOf(fw.str) !== -1) return 'relapse';
    uiLog('[ERROR] Unsupported firmware ' + fw.str +
      ' (supported: 1.00-5.50 via umtx2, 7.00-13.60 via relapse).', 'error');
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
    /* The iframe can finish between timer ticks. Capture its final lines
       before success stops the fallback mirror. */
    mirrorConsole(exploitMode);
    finished = true;
    /* Success is terminal — stop mirroring so the page stays idle while the
       payload runs alongside it. On failure keep streaming the iframe's
       output into the label for diagnostics. */
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
         document down would unwind that thread. */
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

     Both chains append to #console, so one mirror covers them. umtx2 marks
     severity with a class (LOG-ERROR / LOG-WARN / LOG-SUCCESS) and relapse
     with a text prefix ([+] info/success, [-] error, [*] log). Both also
     rewrite their last line in place for progress messages (umtx2's
     "Race attempt N-M"), so we update our matching last line in place too. */
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

  /* Without a log view an error line would otherwise be gone by the next
     tick, and a chain that dies mid-stage just looks stalled. Tint the whole
     pill red on the first error and keep it there until the run recovers, so
     "this attempt failed" stays visible next to the progress it made. */
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
         once it has finished loading. Never re-arm from here: both chains
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

    /* Both chains rewrite their last line in place for progress messages
       (umtx2's "Race attempt N-M", relapse's writeLog(..., replace)), so the
       loop above never sees those as new lines. Re-read the last one and
       refresh the label and the bar from its current text. */
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
    var exploitUrl = picked === 'umtx2' ? UMTX2_URL : RELAPSE_URL;
    updateProgress(5);

    /* Keep a low-frequency fallback for both chains. Relapse also requests a
       mirror update on each log write, so short successful runs are captured. */
    mirrorTimer = setInterval(function () { mirrorConsole(exploitMode); }, 500);

    /* umtx2 auto-runs its chain on load when sessionStorage 'on_load_autorun'
       is set (it clears it itself once main() starts); clear it on the
       relapse path so a stale key never re-triggers it. relapse auto-runs
       from its own URL and keeps no session state. */
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

  window.addEventListener('load', start);
})();
