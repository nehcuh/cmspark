"""Build a thin, relocatable Whisper release input with the Apple Command Line Tools.

Source: https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/5eaee0cc9024eb9e9a99469199920c8b7f5cb9ec
Run with 'uv run --no-project python package-macos-whisper.py SOURCE.tar.gz arm64|x64'.
The checked-in artifacts use Apple clang 21.0.0 (2100.3.34.2) and the 26.5 SDK.
"""
from hashlib import sha256
from pathlib import Path
from shutil import copyfile
import subprocess
import sys
import tarfile
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

project = Path(__file__).resolve().parents[2]
revision = "5eaee0cc9024eb9e9a99469199920c8b7f5cb9ec"
source_archive = Path(sys.argv[1])
arch = sys.argv[2]
machine = {"arm64": "arm64", "x64": "x86_64"}[arch]
if sha256(source_archive.read_bytes()).hexdigest() != "2779bca626cadd18674fdd41ffa73e4fbf2dd90df5977d96fd36c97c1c9b68c9":
    raise ValueError("Whisper source archive does not match b5907")
cmake = ["uv", "tool", "run", "--from", "cmake==4.4.5", "cmake"]
sdk = subprocess.check_output(["xcrun", "--sdk", "macosx26.5", "--show-sdk-path"], text=True).strip()
cli = f"cmspark-whisper-darwin-{arch}"
libs = ["libwhisper.1.dylib", "libggml.1.dylib", "libggml-cpu.1.dylib", "libggml-base.1.dylib"]
with tempfile.TemporaryDirectory() as tmp:
    work = Path(tmp).resolve()
    src, build, generation = work / f"whisper.cpp-{revision}", work / "build", work / "generation"
    with tarfile.open(source_archive) as archive:
        archive.extractall(work, filter="data")
    subprocess.run([*cmake, "-S", src, "-B", build, "-DCMAKE_BUILD_TYPE=Release",
                    f"-DCMAKE_OSX_SYSROOT={sdk}", f"-DCMAKE_OSX_ARCHITECTURES={machine}", "-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0",
                    f"-DCMAKE_C_FLAGS=-ffile-prefix-map={work}=.", f"-DCMAKE_CXX_FLAGS=-ffile-prefix-map={work}=.",
                    "-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-headerpad_max_install_names", "-DCMAKE_EXE_LINKER_FLAGS=-Wl,-headerpad_max_install_names",
                    "-DCMAKE_INSTALL_NAME_DIR=@rpath", "-DCMAKE_BUILD_WITH_INSTALL_NAME_DIR=ON", "-DCMAKE_SKIP_RPATH=ON",
                    "-DBUILD_SHARED_LIBS=ON", "-DGGML_NATIVE=OFF", "-DGGML_OPENMP=OFF", "-DGGML_METAL=OFF", "-DGGML_BLAS=OFF",
                    "-DGGML_ACCELERATE=ON", "-DGGML_AVX2=OFF", "-DGGML_BMI2=OFF", "-DGGML_FMA=OFF", "-DGGML_CCACHE=OFF",
                    "-DWHISPER_BUILD_TESTS=OFF", "-DWHISPER_BUILD_SERVER=OFF"], check=True)
    subprocess.run([*cmake, "--build", build, "--target", "whisper-cli", "--parallel", "5"], check=True)
    (generation / "bin").mkdir(parents=True)
    (generation / "lib").mkdir()
    for name in [cli, *libs]:
        primary = name == cli
        file = generation / ("bin" if primary else "lib") / name
        copyfile(build / "bin" / ("whisper-cli" if primary else name), file)
        file.chmod(0o755)
        change = [] if primary else ["-id", f"@loader_path/{name}"]
        for line in subprocess.check_output(["otool", "-L", file], text=True).splitlines()[1:]:
            dep = line.split(" (compatibility version ")[0].strip()
            if dep.startswith(("/System/Library/", "/usr/lib/")):
                continue
            soname = Path(dep).name
            if soname not in libs:
                raise ValueError(f"unknown Whisper dependency: {dep}")
            if not primary and soname == name:
                continue
            prefix = "@loader_path/../lib" if primary else "@loader_path"
            change.extend(["-change", dep, f"{prefix}/{soname}"])
        subprocess.run(["install_name_tool", *change, file], check=True)
        subprocess.run(["codesign", "--force", "--sign", "-", "--timestamp=none", file], check=True)
        subprocess.run(["codesign", "--verify", "--strict", file], check=True)
        subprocess.run(["lipo", file, "-verify_arch", machine], check=True)
    subprocess.run(["node", project / "scripts/verify-macos-whisper-closure.mjs", generation, cli], check=True)
    subprocess.run(["node", project / "scripts/whisper-generation.mjs", "seal", generation, f"darwin-{arch}"], check=True)
    output = project / f"companion/vendor/whisper/whisper-darwin-{arch}-b5907.zip"
    with ZipFile(output, "w") as package:
        for f in sorted(generation.rglob("*")):
            if f.is_file():
                info = ZipInfo(f.relative_to(generation).as_posix())
                info.create_system = 3
                info.external_attr = (0o100755 if f.name == cli else 0o100644) << 16
                package.writestr(info, f.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
    for f in [output, generation / "manifest.json", generation / "bin" / cli]:
        print(f"{sha256(f.read_bytes()).hexdigest()}  {f.name}")
