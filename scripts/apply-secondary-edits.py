"""Recover exact reviewed source once; validate all baselines and outputs before
writing. The compressed transport is removed before fingerprints and qualification.
No shell execution, downloaded input or fuzzy matching participates.
"""
from pathlib import Path
import hashlib,json,lzma
ROOT=Path(__file__).resolve().parent.parent
payload=ROOT/'.maintenance/secondary-edits.xz'
if not payload.exists():
    print('No pending secondary-window source edits.');raise SystemExit(0)
data=payload.read_bytes()
assert hashlib.sha256(data).hexdigest()=='8c10af393ec707e41bb69b0675c8725ed17923877ac33e6fc73dd93399e34cd8'
spec=json.loads(lzma.decompress(data,memlimit=128*1024*1024))
assert spec['Schema']==1 and spec['OffsetUnit']=='UnicodeCodePoint'
planned=[];seen=set()
for item in spec['Files']:
    name=item['Path'];p=Path(name)
    assert name not in seen and not p.is_absolute() and '..' not in p.parts and '\\' not in name
    assert p.parts[0] in {'packages','scripts','tests','docs'} and not set(p.parts)&{'.git','node_modules','worker-assets','vendor'}
    seen.add(name);file=ROOT/p
    assert not any(parent.is_symlink() for parent in [file,*file.parents])
    if item['Before'] is None:
        assert not file.exists();text=''
    else:
        original=file.read_bytes()
        assert hashlib.sha256(original).hexdigest()==item['Before'],'Input hash mismatch: '+name
        text=original.decode('utf-8')
    if 'Content' in item:text=item['Content']
    else:
        end=len(text)
        for edit in sorted(item['Edits'],key=lambda x:x['Start'],reverse=True):
            start,count=edit['Start'],edit['Delete'];assert 0<=start<=start+count<=end
            text=text[:start]+edit['Insert']+text[start+count:];end=start
    result=text.encode('utf-8')
    assert hashlib.sha256(result).hexdigest()==item['After'],'Output hash mismatch: '+name
    planned.append((file,result))
for file,result in planned:
    file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(result)
payload.unlink()
print('Materialized',len(planned),'reviewable source changes and removed the temporary transport.')
