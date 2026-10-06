"""Verify offline URL coverage and PC-host embedding without console execution."""
import io
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from gen_file_registry import build_manifest, apply_exploit_mode_placeholder
from build_host import build_zip
from unittest.mock import patch


class PackagingTests(unittest.TestCase):
    def test_offline_and_host_assets(self):
        frontend = ROOT / "frontend/autoloader"
        files = [("/app/test/" + p.relative_to(frontend).as_posix(), str(p))
                 for p in frontend.rglob("*") if p.is_file()]
        manifest = build_manifest(files, "test", "test", "/app/test",
                                  "/app/index.html", "/app/test/__complete__")
        cached = manifest.split("CACHE:\n", 1)[1].split("\nNETWORK:", 1)[0].splitlines()
        # The armed iframe URLs must be cached verbatim: AppCache matches the
        # query string, and both chains have to resolve offline.
        for url in ["/app/test/relapse/index.html?autoload=payload.elf",
                    "/app/test/umtx2/index.html?autoload=payload.elf&v=1"]:
            self.assertIn(url, cached, url)
        # No slopkit: the chain is not shipped, so it must not be advertised or
        # cached (a stale entry would only cost the console bandwidth).
        self.assertFalse([e for e in cached if "/slopkit/" in e])
        self.assertEqual(cached[-2:], ["/app/index.html", "/app/test/__complete__"])
        with tempfile.TemporaryDirectory() as overrides:
            archive, _ = build_zip(str(frontend), overrides, "test", "test")
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            names = set(z.namelist())
            for rel in ["relapse/src/utils/rop_slave.js",
                        *[f"relapse/offsets/{v}.js" for v in
                          ("7.00", "12.60", "13.00", "13.40", "13.60")]]:
                self.assertIn("/app/test/" + rel, cached)
                self.assertEqual(z.read(rel), (frontend / rel).read_bytes())
            # The optional jailbreak menu is never sent by the autoloader, and
            # the old per-chain kexp is gone (shared/kexp-ps5.bin is downloaded).
            for rel in ["relapse/payloads/etaHEN.elf", "relapse/payloads/kstuff.elf",
                        "relapse/payloads/shadowmountplus.elf",
                        "relapse/payloads/kexp_2026_05_25.bin",
                        "slopkit/slopkit/poops.html"]:
                self.assertNotIn(rel, names)

    def test_chains_use_the_shared_loader_and_kexp(self):
        """elfldr and kexp are downloaded into shared/, not vendored per chain."""
        relapse = (ROOT / "frontend/autoloader/relapse/src/kexp.js").read_text(encoding="utf-8", errors="replace")
        self.assertIn('const DEFAULT_KEXP = "kexp-ps5.bin"', relapse)
        self.assertIn('const SHARED_BASE = "../shared/"', relapse)
        download = (ROOT / "tools/download_deps.sh").read_text(encoding="utf-8", errors="replace")
        self.assertIn("frontend/autoloader/shared/kexp-ps5.bin", download)
        for path in ["relapse/payloads/kexp_2026_05_25.bin", "slopkit"]:
            self.assertFalse((ROOT / "frontend/autoloader" / path).exists(),
                             path + " must not be shipped any more")

    def test_forced_mode(self):
        for mode in ("relapse", "umtx2"):
            with patch.dict("os.environ", {"FORCE_EXPLOIT": mode}):
                result = apply_exploit_mode_placeholder("/app/test/app.js",
                                                        b"[[EXPLOIT_MODE]]", "/app/test")
            self.assertEqual(result, mode.encode("utf-8"))
        # A removed chain must not be accepted as a build-time override either.
        with patch.dict("os.environ", {"FORCE_EXPLOIT": "poops"}):
            result = apply_exploit_mode_placeholder("/app/test/app.js",
                                                    b"[[EXPLOIT_MODE]]", "/app/test")
        self.assertEqual(result, b"auto")


if __name__ == "__main__":
    unittest.main()