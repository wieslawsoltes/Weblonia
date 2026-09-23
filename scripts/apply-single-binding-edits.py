"""One-time exact source restoration, validated before writing any source file.
Transfer bytes are removed before fingerprints/tests. No fuzzy patching, external
requests or evaluation of payload contents. Later invocations are no-ops.
"""
from pathlib import Path
import hashlib, json, lzma
ROOT = Path(__file__).resolve().parent.parent
parts = [ROOT/f'.maintenance/single-binding.part{i:03d}' for i in range(2)]
if not any(p.exists() for p in parts):
    print('No pending single-binding source edits.'); raise SystemExit(0)
compressed = b''.join(p.read_bytes() for p in parts)
assert len(compressed) == 9376
assert hashlib.sha256(compressed).hexdigest() == 'd5af83181a23ed44e0451b050309ec32944fe759abcd428c949296e6d6ad3942'
spec = json.loads(lzma.decompress(compressed, memlimit=128*1024*1024))
assert spec['Schema'] == 1 and spec['OffsetUnit'] == 'UnicodeCodePoint'
planned = []; seen = set()
for item in spec['Files']:
    name = item['Path']; path = Path(name)
    assert name not in seen and not path.is_absolute() and '..' not in path.parts and '\\' not in name
    assert path.parts[0] in {'packages','scripts','tests','docs'}
    assert not set(path.parts) & {'.git','node_modules','worker-assets','vendor'}
    seen.add(name); file = ROOT/path
    assert not any(parent.is_symlink() for parent in [file,*file.parents])
    if item['Before'] is None:
        assert not file.exists(), name; text = ''
    else:
        data = file.read_bytes()
        assert hashlib.sha256(data).hexdigest() == item['Before'], 'Source baseline mismatch: '+name
        text = data.decode('utf-8')
    end = len(text)
    for edit in sorted(item['Edits'], key=lambda e:e['Start'], reverse=True):
        start, count = edit['Start'], edit['Delete']; assert 0 <= start <= start+count <= end
        text = text[:start]+edit['Insert']+text[start+count:]; end = start
    data = text.encode('utf-8')
    assert hashlib.sha256(data).hexdigest() == item['After'], 'Result mismatch: '+name
    planned.append((file,data))
assert len(planned) == 11
for file,data in planned: file.parent.mkdir(parents=True,exist_ok=True); file.write_bytes(data)
for part in parts: part.unlink()
print('Materialized 11 exact source files; transfer removed.')
