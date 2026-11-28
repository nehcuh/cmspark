"""Reproduce the ARM64 runtime ZIP using the upstream Whisper ZIP and MSYS2 package.

uv run --no-project python companion/scripts/package-windows-arm64-whisper.py WHISPER.zip OPENMP.pkg.tar.zst
See companion/THIRD_PARTY_NOTICES for the two distribution sources.
"""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
import subprocess
import sys
import tarfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

project = Path(__file__).resolve().parents[1]
output = project / "vendor/whisper/whisper-win-arm64-b5907-llvm23.zip"


def pinned_file(path, digest):
    data = Path(path).read_bytes()
    if sha256(data).hexdigest() != digest:
        raise ValueError(f"unexpected input digest for {path}")
    return data


def member(archive, name, data):
    # Fixed timestamps and modes keep output independent of the build machine.
    m = ZipInfo(name)
    m.create_system = 3
    m.external_attr = 0o100644 << 16
    archive.writestr(m, data, compress_type=ZIP_DEFLATED, compresslevel=9)


whisper = pinned_file(sys.argv[1], "4e522946827dcbc517d3cd7ee8d6cfe760e8143076924ac8513622694aa3ccfd")
openmp = pinned_file(sys.argv[2], "fc74b3331fab294a787811d922bea91cc4ace1eee9e2b351afebfae56f28618e")
tar = subprocess.run(["zstd", "-dc"], input=openmp, stdout=subprocess.PIPE, check=True).stdout
with ZipFile(BytesIO(whisper)) as cli, tarfile.open(fileobj=BytesIO(tar)) as llvm, ZipFile(output, "w") as result:
    for name in ("whisper-cli.exe", "whisper.dll", "ggml.dll", "ggml-base.dll", "ggml-cpu.dll"):
        member(result, name, cli.read("Release/" + name))
    # Keep the import name expected by ggml-cpu.dll. MSYS2's LLVM build exports
    # the eight OpenMP functions used by ggml; its only imports are from Windows.
    member(result, "libomp140.aarch64.dll", llvm.extractfile("clangarm64/bin/libomp.dll").read())
    member(result, "LICENSE.openmp.txt", llvm.extractfile("clangarm64/share/licenses/openmp/LICENSE").read())
    member(result, "LICENSE.whisper.txt", (output.parent / "LICENSE.whisper.txt").read_bytes())
print(f"{sha256(output.read_bytes()).hexdigest()}  {output}")
