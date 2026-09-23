"""Restore the exact reviewed MultiBinding sources from the supplied source ZIP.
Validate every baseline/output hash before writing; no fuzzy patch or code eval.
Temporary transfer bytes are removed before build, tests and source fingerprints.
"""
from pathlib import Path
import hashlib, json, lzma
ROOT = Path(__file__).resolve().parent.parent
parts = [ROOT/f'.maintenance/multibinding.part{i:03d}' for i in range(3)]
if not any(p.exists() for p in parts):
    print('No pending MultiBinding transfer.'); raise SystemExit(0)
compressed = b''.join(p.read_bytes() for p in parts)
assert len(compressed) == 24264
assert hashlib.sha256(compressed).hexdigest() == '13f97fe3e891a0f922414f79aeee4c45093fb02cc2de1c2621f5c97bbe0be5ce'
spec = json.loads(lzma.decompress(compressed, memlimit=128*1024*1024))
assert spec['Schema'] == 1 and spec['OffsetUnit'] == 'UnicodeCodePoint'
planned = []; seen = set()
for item in spec['Files']:
    name = item['Path']; p = Path(name)
    assert name not in seen and not p.is_absolute() and '..' not in p.parts and '\\' not in name
    assert p.parts[0] in {'packages','scripts','tests','samples','docs'}
    assert not set(p.parts) & {'.git','node_modules','worker-assets','vendor'}
    seen.add(name); file = ROOT/p
    assert not any(parent.is_symlink() for parent in [file,*file.parents])
    if item['Before'] is None:
        assert not file.exists(), name; text = ''
    else:
        data = file.read_bytes()
        assert hashlib.sha256(data).hexdigest() == item['Before'], 'Baseline mismatch: '+name
        text = data.decode('utf-8')
    end = len(text)
    for edit in sorted(item['Edits'], key=lambda e:e['Start'], reverse=True):
        start, count = edit['Start'], edit['Delete']; assert 0 <= start <= start+count <= end
        text = text[:start]+edit['Insert']+text[start+count:]; end = start
    data = text.encode('utf-8')
    assert hashlib.sha256(data).hexdigest() == item['After'], 'Output mismatch: '+name
    planned.append((file,data))
assert len(planned) == 20
for file,data in planned: file.parent.mkdir(parents=True,exist_ok=True); file.write_bytes(data)
for part in parts: part.unlink()
print('Restored 20 exact source files. Temporary transfer removed.')
