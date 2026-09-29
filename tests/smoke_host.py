"""Exercise the built host over local HTTP without executing console code."""
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[1]
host = root / "webkit-autoloader-host.py"
log = root / "build/host-smoke-test.log"
log.parent.mkdir(parents=True, exist_ok=True)
with log.open("w") as output:
    process = subprocess.Popen([
        sys.executable, str(host), "--no-dns", "--no-https", "--http-port", "18080",
        "--ip", "127.0.0.1", "--no-update-check", "--no-color",
    ], stdout=output, stderr=subprocess.STDOUT)
    try:
        for attempt in range(30):
            if process.poll() is not None:
                raise RuntimeError(log.read_text())
            try:
                with urllib.request.urlopen("http://127.0.0.1:18080/app.js", timeout=1) as response:
                    assert b"RELAPSE_FIRMWARES" in response.read()
                break
            except OSError:
                time.sleep(0.25)
        else:
            raise RuntimeError("Host did not start: " + log.read_text())
        for route, expected in [
            ("/relapse/offsets/12.60.js", root / "frontend/autoloader/relapse/offsets/12.60.js"),
            ("/relapse/offsets/13.40.js", root / "frontend/autoloader/relapse/offsets/13.40.js"),
            ("/relapse/offsets/13.60.js", root / "frontend/autoloader/relapse/offsets/13.60.js"),
            ("/relapse/payloads/kexp_2026_05_25.bin", root / "frontend/autoloader/relapse/payloads/kexp_2026_05_25.bin"),
            ("/payloads/payload.elf", root / "installer.elf"),
        ]:
            with urllib.request.urlopen("http://127.0.0.1:18080" + route, timeout=5) as response:
                assert response.read() == expected.read_bytes(), route
        with urllib.request.urlopen("http://127.0.0.1:18080/relapse/index.html?autoload=payload.elf", timeout=5) as response:
            assert b"./src/site.js" in response.read()
        print("PASS: live HTTP serves 12.60/13.40/13.60 offsets, the kexp binary, "
              "the iframe URL and the exact installer ELF")
    finally:
        if process.poll() is None:
            process.send_signal(signal.SIGINT)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
