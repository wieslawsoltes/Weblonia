"""Materialize reviewed source edits once, with all-or-nothing hash validation.
The transport is removed before tests/build/fingerprints. No downloaded executable
or external URL participates. Reject unexpected baseline bytes rather than fuzzy
patching, changing user work, or constructing a misleading verification record.
"""
from pathlib import Path
import hashlib,json,lzma
ROOT=Path(__file__).resolve().parent.parent
folder=ROOT/'.maintenance'
manifest_path=folder/'core-transfer.json'
if not manifest_path.exists():
    print('No pending core source transfer.');raise SystemExit(0)
manifest=json.loads(manifest_path.read_text())
assert manifest['Schema']==1
parts=[]
for item in manifest['Parts']:
    name=item['Name'];assert name.startswith('core.part') and '/' not in name and '\\' not in name
    data=(folder/name).read_bytes();assert hashlib.sha256(data).hexdigest()==item['Sha256'],name
    parts.append(data)
compressed=b''.join(parts)
assert len(compressed)==manifest['Bytes'] and hashlib.sha256(compressed).hexdigest()==manifest['Sha256']
spec=json.loads(lzma.decompress(compressed,memlimit=128*1024*1024))
assert spec['Schema']==1 and spec['OffsetUnit']=='UnicodeCodePoint'
planned=[];seen=set()
for item in spec['Files']:
    name=item['Path'];p=Path(name)
    assert name not in seen and not p.is_absolute() and '..' not in p.parts and '\\' not in name
    assert p.parts[0] in {'packages','scripts','tests','docs','.github'} and not set(p.parts)&{'.git','node_modules','worker-assets'}
    seen.add(name);file=ROOT/p;assert not any(parent.is_symlink() for parent in [file,*file.parents])
    if item['Before'] is None:
        assert not file.exists(), 'New file already exists: '+name
        text=''
    else:
        data=file.read_bytes();assert hashlib.sha256(data).hexdigest()==item['Before'],'Source baseline differs: '+name
        text=data.decode('utf-8')
    if 'Content' in item:text=item['Content']
    else:
        end=len(text)
        for edit in sorted(item['Edits'],key=lambda e:e['Start'],reverse=True):
            start,count=edit['Start'],edit['Delete'];assert 0<=start<=start+count<=end
            text=text[:start]+edit['Insert']+text[start+count:];end=start
    data=text.encode('utf-8');assert hashlib.sha256(data).hexdigest()==item['After'],'Output mismatch: '+name
    planned.append((file,data))
for file,data in planned:file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(data)
for item in manifest['Parts']:(folder/item['Name']).unlink()
manifest_path.unlink()
print('Materialized',len(planned),'hash-verified source files. Transfer removed before qualification.')
