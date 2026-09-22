"""Must match scripts/source-fingerprint.mjs, including path sorting and exclusions."""
from pathlib import Path
import hashlib

def source_fingerprint(root):
    root=Path(root)
    names=['package.json']
    for scope in ['packages','scripts','tests','samples','.github']:
        for p in (root/scope).rglob('*'):
            if not p.is_file() or any(x in {'compiled','node_modules','__pycache__','worker-assets','worker'} for x in p.relative_to(root).parts):continue
            name=p.relative_to(root).as_posix()
            if name!='samples/ControlCatalog/index.html':names.append(name)
    digest=hashlib.sha256()
    for name in sorted(names):
        digest.update((name+'\0'+hashlib.sha256((root/name).read_bytes()).hexdigest()+'\n').encode())
    return digest.hexdigest()
