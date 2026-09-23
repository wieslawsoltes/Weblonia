"""Materialize a reviewed source transfer with exact baseline/output hashes.
No external code, fuzzy patching, shell commands or downloaded dependencies.
All validation completes before writing; transfer files are removed before tests.
"""
from pathlib import Path
import hashlib,json,lzma
ROOT=Path(__file__).resolve().parent.parent
manifest_path=ROOT/'.maintenance/implicit-transfer.json'
if not manifest_path.exists():
    print('No pending implicit-animation source transfer.');raise SystemExit(0)
manifest=json.loads(manifest_path.read_text());assert manifest['Schema']==1
assert isinstance(manifest['Parts'],int) and 1<=manifest['Parts']<=32
parts=[ROOT/f'.maintenance/implicit.part{i:03d}' for i in range(manifest['Parts'])]
compressed=b''.join(p.read_bytes() for p in parts)
assert len(compressed)==manifest['Bytes'] and hashlib.sha256(compressed).hexdigest()==manifest['Sha256']
spec=json.loads(lzma.decompress(compressed,memlimit=128*1024*1024));assert spec['Schema']==1
planned=[];seen=set()
for item in spec['Files']:
    name=item['Path'];p=Path(name)
    assert name not in seen and not p.is_absolute() and '..' not in p.parts and '\\' not in name
    assert p.parts[0] in {'packages','scripts','tests','samples','docs'} and not set(p.parts)&{'.git','node_modules','worker-assets','vendor'}
    seen.add(name);file=ROOT/p;assert not any(parent.is_symlink() for parent in [file,*file.parents])
    if item['Before'] is None:assert not file.exists();text=''
    else:
        data=file.read_bytes();assert hashlib.sha256(data).hexdigest()==item['Before'],'Input hash mismatch: '+name;text=data.decode('utf-8')
    if 'Content' in item:text=item['Content']
    else:
        end=len(text)
        for edit in sorted(item['Edits'],key=lambda e:e['Start'],reverse=True):
            start,count=edit['Start'],edit['Delete'];assert 0<=start<=start+count<=end
            text=text[:start]+edit['Insert']+text[start+count:];end=start
    data=text.encode('utf-8');assert hashlib.sha256(data).hexdigest()==item['After'],'Output hash mismatch: '+name
    planned.append((file,data))
assert len(planned)==manifest['SourceFiles']
for file,data in planned:file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(data)
for part in parts:part.unlink()
manifest_path.unlink()
print('Materialized',len(planned),'hash-verified source files; temporary transfer removed.')
