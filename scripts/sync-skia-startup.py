"""Synchronize the reviewed, immutable Skia startup runtime; never rebuild native binaries."""
import argparse, hashlib, json, shutil, subprocess, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
REVISION = "d5a9e8573c747804930eb76a81d05d2c5dde2d3a"
WASM = "698921da1c2d684dc52b9607cb2031aee9d9f4ddb06a6dca107265d684a73505"
def digest(data): return hashlib.sha256(data).hexdigest()
def load(p): return json.loads(p.read_text(encoding="utf-8"))
def save(p, data): p.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
def synchronize(upstream):
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=upstream, text=True).strip()
    if revision != REVISION: raise RuntimeError("Expected the reviewed upstream merge, not a moving branch.")
    inventory = load(upstream/"dist/package/build-manifest.json")
    pkg = load(upstream/"package.json")
    if pkg["version"] != "0.5.1" or inventory["version"] != "0.5.1": raise RuntimeError("Upstream version drift.")
    if digest((upstream/"dist/vendor/canvaskit.wasm").read_bytes()) != WASM:
        raise RuntimeError("Qualified native WASM changed.")
    files = [*inventory["files"], "dist/package/build-manifest.json", "package.json", "LICENSE"]
    for name in files:
        path = Path(name)
        if path.is_absolute() or ".." in path.parts: raise RuntimeError("Unsafe upstream path.")
        if name not in ("package.json","LICENSE") and not name.startswith(("dist/lib/","dist/vendor/","dist/package/","dist/licenses/")):
            raise RuntimeError("Unapproved upstream scope: " + name)
        source = upstream/path
        if source.is_symlink() or not source.is_file(): raise RuntimeError("Invalid upstream file: " + name)
        data = source.read_bytes()
        if source.suffix.lower() in {".ttf",".otf",".woff",".woff2",".ttc",".otc",".eot",".pfa",".pfb"} or data[:4] in {b"\x00\x01\x00\x00",b"OTTO",b"ttcf",b"wOFF",b"wOF2"}:
            raise RuntimeError("Font binary excluded: " + name)
        if name in inventory["files"] and digest(data) != inventory["files"][name]:
            raise RuntimeError("Upstream inventory mismatch: " + name)
    native = load(upstream/"dist/vendor/native-build-manifest.json")
    for name, expected in native["artifacts"].items():
        if digest((upstream/"dist/vendor"/name).read_bytes()) != expected:
            raise RuntimeError("Native artifact mismatch: " + name)
    evidence = {"Repository":"wieslawsoltes/SkiaSharpWeb","PullRequest":9,
                "Url":"https://github.com/wieslawsoltes/SkiaSharpWeb/pull/9",
                "Merged":True,"MergeCommit":REVISION,"PackageVersion":"0.5.1",
                "HeadCommit":"6436b43150f0568d99c79699ed48f472a10e1da0",
                "PackageReadinessRun":35768154418,"BlazorRun":35768153200,
                "AllValidatedJobsSucceeded":True,"NativeWasmSha256":WASM,
                "NativeWasmChanged":False,"RuntimeFilesVerified":len(files),
                "LoaderTransformation":native["loaderTransformation"],
                "NpmPublication":"Separate upstream release pipeline; source consumption is pinned to the reviewed merge.",
                "PreviousTextRasterUpstreamEvidence":"docs/SKIASHARPWEB-UPSTREAM.json"}
    destination = ROOT/"vendor/skiasharpweb"
    # Validate the complete inventory before replacing any vendored content.
    with tempfile.TemporaryDirectory(prefix="skia-sync-", dir=ROOT.parent) as temp:
        staged = Path(temp)/"skiasharpweb";staged.mkdir()
        for name in files:
            target=staged/name;target.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(upstream/name,target)
        save(staged/"UPSTREAM.json", evidence)
        shutil.rmtree(destination)
        shutil.copytree(staged,destination)
    dependency = "git+https://github.com/wieslawsoltes/SkiaSharpWeb.git#" + REVISION
    for name in ("skia","browser"):
        path=ROOT/"packages"/name/"package.json";package=load(path)
        package["dependencies"]["@wieslawsoltes/skiasharpweb"]=dependency;save(path,package)
    lockpath=ROOT/"docs/upstream-lock.json";lock=load(lockpath)
    lock["inspectedAt"]="2026-09-22"
    lock["SkiaSharpWeb"].update(commit=REVISION,packageVersion="0.5.1",sourcePullRequest=9,sourceDependency=dependency)
    lock["SkiaSharpWeb"].pop("browserTextExportPublishedToNpm",None)
    lock["SkiaSharpWeb"]["publicationStatus"]="See upstream 0.5.1 release; this checkout consumes exact reviewed source."
    save(lockpath,lock);save(ROOT/"docs/STARTUP-UPSTREAM.json",evidence)
    oldpin="git+https://github.com/wieslawsoltes/SkiaSharpWeb.git#0a33427592e788d042ab69eedeb4bd7f29f35564"
    testpath=ROOT/"tests/upstream-skia.test.mjs";text=testpath.read_text()
    if text.count(oldpin)==1: testpath.write_text(text.replace(oldpin,dependency))
    elif dependency not in text: raise RuntimeError("Unexpected upstream test pin.")
    vendorfiles=sorted(p for p in (ROOT/"vendor").rglob("*") if p.is_file())
    save(ROOT/"docs/vendor-integrity.json",{"algorithm":"SHA-256","files":{
        p.relative_to(ROOT).as_posix():digest(p.read_bytes()) for p in vendorfiles}})
    print(json.dumps(evidence,indent=2))
if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("upstream",type=Path)
    synchronize(parser.parse_args().upstream.resolve())
