"""One-time exact reviewed correction; all input/output hashes validate before
source writes. No fuzzy patch, external requests or executable payload. The
specification is removed before qualification; later invocations are no-ops.
"""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parent.parent
spec_path=ROOT/'.maintenance/single-binding-correction.json'
if not spec_path.exists():
    print('No pending single-binding source correction.');raise SystemExit(0)
spec=json.loads(spec_path.read_text());assert spec['Schema']==1
planned=[];seen=set()
for item in spec['Files']:
    name=item['Path'];p=Path(name)
    assert name not in seen and not p.is_absolute() and '..' not in p.parts and '\\' not in name
    assert p.parts[0] in {'packages','scripts','tests','docs'} and not set(p.parts)&{'.git','node_modules','worker-assets','vendor'}
    seen.add(name);file=ROOT/p;assert not any(parent.is_symlink() for parent in [file,*file.parents])
    data=file.read_bytes();assert hashlib.sha256(data).hexdigest()==item['Before'],'Source baseline mismatch: '+name
    text=data.decode('utf-8');assert item['Replace'] and text.count(item['Replace'])==1,'Ambiguous source match: '+name
    result=text.replace(item['Replace'],item['With'],1).encode('utf-8')
    assert hashlib.sha256(result).hexdigest()==item['After'],'Output hash mismatch: '+name
    planned.append((file,result))
for file,result in planned:file.write_bytes(result)
spec_path.unlink()
print('Applied',len(planned),'exact source corrections; temporary specification removed.')
