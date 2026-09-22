"""Apply a pending reviewed text correction, checking exact input/output hashes.
No fuzzy patch, downloading or evaluation. The temporary specification is removed
before building/testing/fingerprinting. Once materialized this script is a no-op.
"""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parent.parent
spec_path=ROOT/'.maintenance/core-corrections.json'
if not spec_path.exists():
    print('No pending reviewed source corrections.');raise SystemExit(0)
spec=json.loads(spec_path.read_text());assert spec['Schema']==1
planned=[];seen=set()
for item in spec['Files']:
    name=item['Path'];p=Path(name)
    assert name not in seen and not p.is_absolute() and '..' not in p.parts and '\\' not in name
    assert p.parts[0] in {'packages','scripts','tests','docs'} and not set(p.parts)&{'.git','node_modules','worker-assets'}
    seen.add(name);file=ROOT/p;assert not any(parent.is_symlink() for parent in [file,*file.parents])
    data=file.read_bytes();assert hashlib.sha256(data).hexdigest()==item['Before'],'Input hash mismatch: '+name
    text=data.decode('utf-8')
    for edit in item['Edits']:
        assert edit['Before'] and text.count(edit['Before'])==1,'Ambiguous correction: '+name
        text=text.replace(edit['Before'],edit['After'],1)
    data=text.encode('utf-8');assert hashlib.sha256(data).hexdigest()==item['After'],'Output hash mismatch: '+name
    planned.append((file,data))
for file,data in planned:file.write_bytes(data)
spec_path.unlink()
print('Applied',len(planned),'exact reviewed source corrections; temporary specification removed.')
