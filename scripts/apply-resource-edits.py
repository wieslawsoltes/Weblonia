"""Materialize reviewed text exactly once, validating all bytes before writing.
No fuzzy patch, downloaded executable, evaluation or external process is involved.
Transfer bytes are removed before fingerprinting and testing; repeats are no-ops.
"""
from pathlib import Path
import hashlib, json, lzma
ROOT=Path(__file__).resolve().parent.parent
manifest_path=ROOT/'.maintenance/resource-transfer.json'
if not manifest_path.exists():
    print('No pending resource source transfer.');raise SystemExit(0)
m=json.loads(manifest_path.read_text());assert m['Schema']==1 and 1<=m['Parts']<=32
parts=[ROOT/f'.maintenance/resource.part{i:03d}' for i in range(m['Parts'])]
compressed=b''.join(p.read_bytes() for p in parts)
assert len(compressed)==m['Bytes'] and hashlib.sha256(compressed).hexdigest()==m['Sha256']
spec=json.loads(lzma.decompress(compressed,memlimit=128*1024*1024))
assert spec['Schema']==1 and spec['OffsetUnit']=='UnicodeCodePoint'
planned=[];seen=set()
for item in spec['Files']:
    name=item['Path'];p=Path(name)
    assert name not in seen and not p.is_absolute() and '..' not in p.parts and '\\' not in name
    assert p.parts[0] in {'packages','scripts','tests','samples','docs'}
    assert not set(p.parts)&{'.git','node_modules','worker-assets','vendor','compiled','worker'}
    seen.add(name);file=ROOT/p
    assert not any(parent.is_symlink() for parent in [file,*file.parents])
    if item['Before'] is None:assert not file.exists();text=''
    else:
        data=file.read_bytes();assert hashlib.sha256(data).hexdigest()==item['Before'],'Baseline mismatch: '+name
        text=data.decode('utf-8')
    if 'Content' in item:text=item['Content']
    else:
        end=len(text)
        for edit in sorted(item['Edits'],key=lambda e:e['Start'],reverse=True):
            start,count=edit['Start'],edit['Delete'];assert 0<=start<=start+count<=end
            text=text[:start]+edit['Insert']+text[start+count:];end=start
    data=text.encode('utf-8');assert hashlib.sha256(data).hexdigest()==item['After'],'Output mismatch: '+name
    planned.append((file,data))
assert len(planned)==m['SourceFiles']
for file,data in planned:file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(data)
for part in parts:part.unlink()
manifest_path.unlink()
print('Materialized',len(planned),'hash-verified source files; transfer removed.')
