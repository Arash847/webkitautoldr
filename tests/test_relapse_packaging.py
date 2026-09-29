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
        # query string, and relapse/umtx2 are the only chains left.
        self.assertIn("/app/test/relapse/index.html?autoload=payload.elf", cached)
        self.assertIn("/app/test/umtx2/index.html?autoload=payload.elf&v=1", cached)
        self.assertEqual(cached[-2:], ["/app/index.html", "/app/test/__complete__"])
        with tempfile.TemporaryDirectory() as overrides:
            archive, _ = build_zip(str(frontend), overrides, "test", "test")
        with zipfile.ZipFile(io.BytesIO(archive)) as z:
            names = set(z.namelist())
            for rel in ["relapse/src/utils/rop_slave.js",
                        "relapse/payloads/kexp_2026_05_25.bin",
                        *[f"relapse/offsets/{v}.js" for v in
                          ("7.00", "12.60", "13.00", "13.40", "13.60")]]:
                self.assertIn("/app/test/" + rel, cached)
                self.assertEqual(z.read(rel), (frontend / rel).read_bytes())
            # relapse boots the shared elfldr (frontend/autoloader/shared/),
            # and the optional jailbreak menu is never sent by the autoloader.
            for rel in ["relapse/payloads/etaHEN.elf", "relapse/payloads/kstuff.elf",
                        "relapse/payloads/shadowmountplus.elf"]:
                self.assertNotIn(rel, names)

    def test_forced_mode(self):
        for mode in ("relapse", "umtx2"):
            with patch.dict("os.environ", {"FORCE_EXPLOIT": mode}):
                result = apply_exploit_mode_placeholder("/app/test/app.js",
                                                        b"[[EXPLOIT_MODE]]", "/app/test")
            self.assertEqual(result, mode.encode("utf-8"))


if __name__ == "__main__":
    unittest.main()
