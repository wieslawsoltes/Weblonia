"""One-time, exact source transfer; validate every input/output before writing.
No downloaded executable, fuzzy patch, eval or external command is involved.
The payload is removed before builds, fingerprints, tests and distribution.
"""
from pathlib import Path
import hashlib,json,lzma
ROOT=Path(__file__).resolve().parent.parent
manifest_path=ROOT/'.maintenance/glyph-transfer.json'
if not manifest_path.exists():
    print('No pending glyph/path source transfer.');raise SystemExit(0)
m=json.loads(manifest_path.read_text());assert m['Schema']==1 and 1<=m['Parts']<=32
parts=[ROOT/f'.maintenance/glyph.part{i:03d}' for i in range(m['Parts'])]
data=b''.join(p.read_bytes() for p in parts)
assert len(data)==m['Bytes'] and hashlib.sha256(data).hexdigest()==m['Sha256']
spec=json.loads(lzma.decompress(data,memlimit=128*1024*1024))
assert spec['Schema']==1 and spec['OffsetUnit']=='UnicodeCodePoint'
planned=[];seen=set()
for item in spec['Files']:
    name=item['Path'];p=Path(name)
    assert name not in seen and not p.is_absolute() and '..' not in p.parts and '\\' not in name
    assert p.parts[0] in {'packages','samples','scripts','tests','docs'} and not set(p.parts)&{'.git','node_modules','worker-assets','vendor'}
    seen.add(name);file=ROOT/p;assert not any(parent.is_symlink()for parent in [file,*file.parents])
    if item['Before'] is None:assert not file.exists();text=''
    else:
        old=file.read_bytes();assert hashlib.sha256(old).hexdigest()==item['Before'],'Input hash mismatch: '+name
        text=old.decode('utf-8')
    if 'Content' in item:text=item['Content']
    else:
        end=len(text)
        for edit in sorted(item['Edits'],key=lambda e:e['Start'],reverse=True):
            start,count=edit['Start'],edit['Delete'];assert 0<=start<=start+count<=end
            text=text[:start]+edit['Insert']+text[start+count:];end=start
    result=text.encode('utf-8');assert hashlib.sha256(result).hexdigest()==item['After'],'Output hash mismatch: '+name
    planned.append((file,result))
assert len(planned)==m['SourceFiles']
for file,result in planned:file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(result)
for part in parts:part.unlink()
manifest_path.unlink()
print('Materialized',len(planned),'reviewable source files; temporary transfer removed.')
