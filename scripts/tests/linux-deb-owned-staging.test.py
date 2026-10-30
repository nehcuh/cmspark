#!/usr/bin/env python3
"""Exercise the real DEB script with owned files and inert tool stubs."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "build-linux-deb.sh"


class OwnedStagingTest(unittest.TestCase):
    def test_existing_directory_survives_and_failed_builds_use_distinct_roots(self):
        with tempfile.TemporaryDirectory(prefix="cmspark-deb-test-") as directory:
            root = Path(directory)
            staging, output, tools = (root / name for name in ("staging", "output", "tools"))
            for directory_path in (staging, output, tools):
                directory_path.mkdir()
            for name in (
                "cmspark-agent.js", "launch-companion.sh", "node", "assets/cmspark.png",
                "chrome-extension/manifest.json", "node_modules/systray2/traybin/tray_linux_release",
            ):
                path = staging / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("owned fixture\n")
                path.chmod(0o755)
            existing = output / ".deb-root-linux-x64"
            existing.mkdir()
            marker = existing / "marker"
            marker.write_text("retain me\n")
            previous_deb = output / "cmspark_0.7.0-1_amd64.deb"
            previous_deb.write_text("previous package\n")
            log = root / "install.log"
            stubs = {
                "node": "printf 0.7.0\n",
                "dpkg-deb": "exit 99\n",
                "md5sum": "exit 99\n",
                "install": 'printf "%s\\n" "$2" >> "$CMSPARK_TEST_LOG"\nexit 90\n',
            }
            realpath = shutil.which("grealpath") or shutil.which("realpath")
            self.assertIsNotNone(realpath)
            stubs["realpath"] = f'exec "{realpath}" "$@"\n'
            for name, content in stubs.items():
                path = tools / name
                path.write_text("#!/bin/sh\n" + content)
                path.chmod(0o755)
            env = dict(os.environ, PATH=f"{tools}:/usr/bin:/bin", CMSPARK_TEST_LOG=str(log))
            for _ in range(2):
                result = subprocess.run(
                    ["/bin/bash", str(SCRIPT), "linux-x64", str(staging), str(output)],
                    env=env, capture_output=True, check=False,
                )
                self.assertEqual(result.returncode, 90, result.stderr.decode(errors="replace"))
                self.assertEqual(marker.read_text(), "retain me\n")
                self.assertEqual(previous_deb.read_text(), "previous package\n")
            roots = [Path(line).parent.parent for line in log.read_text().splitlines()]
            self.assertEqual(len(roots), 2)
            self.assertNotEqual(roots[0], roots[1])
            self.assertTrue(all(path.parent == output and path.is_dir() for path in roots))
            nested = staging / "nested output"
            result = subprocess.run(
                ["/bin/bash", str(SCRIPT), "linux-x64", str(staging), str(nested)],
                env=env, capture_output=True, check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"output must not be inside staging", result.stderr)
            self.assertFalse(nested.exists())
            previous_deb.unlink()
            previous_deb.symlink_to(marker)
            result = subprocess.run(
                ["/bin/bash", str(SCRIPT), "linux-x64", str(staging), str(output)],
                env=env, capture_output=True, check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(previous_deb.is_symlink())
            self.assertEqual(marker.read_text(), "retain me\n")
            previous_deb.unlink()
            previous_deb.write_text("previous package\n")
            (tools / "install").write_text('#!/bin/sh\nexec /usr/bin/install "$@"\n')
            (tools / "md5sum").write_text('#!/bin/sh\nexit 0\n')
            (tools / "dpkg-deb").write_text(
                '#!/bin/sh\ncase "$CMSPARK_BUILDER_MODE" in\n'
                ' fail) exit 91 ;;\n empty) : > "$4" ;;\n'
                ' link) ln -s "$CMSPARK_TEST_TARGET" "$4" ;;\n'
                ' success) printf "new package\\n" > "$4" ;;\n'
                'esac\n'
            )
            move = shutil.which("gmv") or shutil.which("mv")
            self.assertIsNotNone(move)
            (tools / "mv").write_text(f'#!/bin/sh\nexec "{move}" "$@"\n')
            (tools / "mv").chmod(0o755)
            env["CMSPARK_TEST_TARGET"] = str(marker)
            for mode in ("fail", "empty", "link", "success"):
                env["CMSPARK_BUILDER_MODE"] = mode
                result = subprocess.run(
                    ["/bin/bash", str(SCRIPT), "linux-x64", str(staging), str(output)],
                    env=env, capture_output=True, check=False,
                )
                if mode == "success":
                    self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
                    self.assertEqual(previous_deb.read_text(), "new package\n")
                else:
                    self.assertNotEqual(result.returncode, 0, mode)
                    self.assertEqual(previous_deb.read_text(), "previous package\n")
                self.assertEqual(marker.read_text(), "retain me\n")


if __name__ == "__main__":
    unittest.main()
