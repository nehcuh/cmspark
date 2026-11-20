"""Run the released Windows package and a real local minutes model on a clean Windows VM."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen
import wave
import zipfile

if os.name != "nt" or os.environ.get("GITHUB_ACTIONS") != "true":
    raise RuntimeError("Requires a disposable Windows Actions runner")

tag = sys.argv[1]
if not re.fullmatch(r"v\d+\.\d+\.\d+", tag):
    raise ValueError("invalid release")
base = Path(tempfile.mkdtemp(prefix="cmspark-e2e-", dir=os.environ["RUNNER_TEMP"]))
data = base / "data"
data.mkdir()
public = Path(os.environ["RUNNER_TEMP"]) / "meeting-result"
release = json.load(urlopen("https://api.github.com/repos/nehcuh/cmspark/releases/tags/" + tag))
assert release["tag_name"] == tag and not release["draft"] and not release["prerelease"]
assert len(release["assets"]) == 19 and any(a["name"] == "SHA256SUMS-INSTALLERS.txt" for a in release["assets"])



def fetch(url, path, sha=None):
    print("Downloading", path.name, flush=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    h = hashlib.sha256()
    if url.startswith("https://huggingface.co/"):
        url += ("&" if "?" in url else "?") + "download=true&request=" + str(time.time_ns())
    with urlopen(Request(url, headers={"User-Agent":"CMspark-release-acceptance"}), timeout=100) as source, path.open("xb") as dest:
        while block := source.read(1024 * 1024):
            h.update(block)
            dest.write(block)
    if sha and h.hexdigest() != sha:
        raise ValueError("digest mismatch: " + path.name)
    return path


def unpack(archive, directory):
    with zipfile.ZipFile(archive) as z:
        for name in z.namelist():
            if not (directory / name).resolve().is_relative_to(directory.resolve()):
                raise ValueError("invalid archive path")
        z.extractall(directory)


def asset(name, directory):
    entry, = [a for a in release["assets"] if a["name"] == name]
    assert re.fullmatch(r"sha256:[a-f0-9]{64}", entry["digest"])
    unpack(fetch(entry["browser_download_url"], base / name, entry["digest"][7:]), directory)


asset(f"cmspark-{tag}-windows-x64.zip", base / "package")
asset(f"CMspark-Chrome-Extension-{tag}.zip", base / "extension")
node, = [p for p in (base / "package").rglob("node.exe") if p.with_name("cmspark-agent.js").is_file()]
bundle = node.with_name("cmspark-agent.js")
assert bundle.is_file()
manifest, = [p for p in (base / "extension").rglob("manifest.json") if "side_panel" in json.loads(p.read_text(encoding="utf-8"))]
env = dict(os.environ, CMSPARK_DATA_DIR=str(data))
version = subprocess.check_output([node, bundle, "--version"], env=env, text=True)
assert tag in version
checkout = Path(os.environ["GITHUB_WORKSPACE"])
expected = json.loads((checkout / "companion/assets/whisper-models.manifest.json").read_text())["models"]["large-v3-turbo"]["files"][0]
fetch(expected["url"], data / "models/whisper/large-v3-turbo" / expected["name"], expected["sha256"])
whisper = json.loads((checkout / "companion/assets/whisper-binary.manifest.json").read_text())["binaries"]["win-x64"]
if not (node.parent / "bin/cmspark-whisper-win-x64.exe").is_file():
    with zipfile.ZipFile(fetch(whisper["url"], base / "whisper.zip", whisper["sha256"])) as z:
        out = node.parent / "bin"
        out.mkdir(exist_ok=True)
        for entry in whisper["extract"]["files"]:
            payload = z.read(whisper["extract"]["stripPrefix"] + entry["src"])
            assert hashlib.sha256(payload).hexdigest() == entry["sha256"]
            (out / entry["dest"]).write_bytes(payload)

llama_url = "https://github.com/ggml-org/llama.cpp/releases/download/b12556/llama-b12556-bin-win-cpu-x64.zip"
unpack(fetch(llama_url, base / "llama.zip", "98882a3ca45688ffa585c3adba49213ca90c5b2dbbf1bc2af41ac437a0987d17"), base / "llama")
server, = (base / "llama").rglob("llama-server.exe")
model = fetch("https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf", base / "minutes.gguf", "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e")
config = {"port":23401, "llm":{"base_url":"http://127.0.0.1:18839/v1", "api_key":"owned-local-test", "model_name":"meeting-local", "temperature":0.1, "max_tokens":1024, "context_window":8192}, "voice":{"sttEngine":"local","localModelId":"large-v3-turbo"}}
(data / "config.json").write_text(json.dumps(config), encoding="utf-8")
recording = fetch("https://groups.inf.ed.ac.uk/ami/AMICorpusMirror/amicorpus/ES2002a/audio/ES2002a.Mix-Headset.wav", base / "meeting.wav")
clip = base / "clip.wav"
with wave.open(str(recording), "rb") as source, wave.open(str(clip), "wb") as dest:
    assert (source.getframerate(), source.getnchannels(), source.getsampwidth()) == (16000, 1, 2)
    source.setpos(30 * 16000)
    dest.setparams(source.getparams())
    dest.writeframes(source.readframes(120 * 16000))


def wait_healthy(p, url):
    end = time.monotonic() + 90
    while p.poll() is None and time.monotonic() < end:
        try:
            with urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except OSError:
            pass
        time.sleep(.3)
    raise RuntimeError("owned service failed to start: " + url)


children = []
try:
    print("Starting local minutes model", flush=True)
    llm = subprocess.Popen([server, "-m", model, "--alias", "meeting-local", "--host", "127.0.0.1", "--port", "18839", "-c", "8192", "-t", "4"], cwd=server.parent, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    children.append(llm)
    wait_healthy(llm,"http://127.0.0.1:18839/health")
    print("Starting released Companion", flush=True)
    daemon = subprocess.Popen([node,bundle,"start"], cwd=node.parent, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    children.append(daemon)
    wait_healthy(daemon,"http://127.0.0.1:23401/healthz")
    subprocess.run([sys.executable, Path(__file__).with_name("released_meeting_ui.py"), "--version", tag[1:], "--extension", manifest.parent, "--data",data,"--audio",clip,"--profile",base / "profile","--output",public], check=True)
    receipt_path = public / "receipt.json"
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    receipt.update({
        "companion_asset": next({"name":a["name"], "digest":a["digest"]} for a in release["assets"] if a["name"] == f"cmspark-{tag}-windows-x64.zip"),
        "extension_asset": next({"name":a["name"], "digest":a["digest"]} for a in release["assets"] if a["name"] == f"CMspark-Chrome-Extension-{tag}.zip"),
        "speech_model": {"id":"large-v3-turbo", "sha256":expected["sha256"]},
        "minutes_model":"Qwen2.5-1.5B-Instruct-Q4_K_M via local llama.cpp b12556",
    })
    receipt_path.write_text(json.dumps(receipt, indent=2, ensure_ascii=False), encoding="utf-8")
finally:
    for p in reversed(children):
        if p.poll() is None: p.terminate()
        p.wait(timeout=10)
