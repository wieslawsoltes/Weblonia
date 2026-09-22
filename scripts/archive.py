"""Build source, standalone and npm ZIPs with hashes and a font-file exclusion gate.
Run after tests/build/pack: python scripts/archive.py --output /path/to/releases
No downloads, npm installation or external Python modules are required.
"""
from pathlib import Path
import argparse, hashlib, io, json, tarfile, zipfile

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, default=root.parent / 'releases')
args = parser.parse_args(); output = args.output.resolve()
if output == root or output.is_relative_to(root):
    raise SystemExit('Archive output must be outside the source tree.')
output.mkdir(parents=True, exist_ok=True)
version = json.loads((root / 'package.json').read_text())['version']
font_ext = {'.ttf', '.otf', '.woff', '.woff2', '.ttc', '.otc', '.pfa', '.pfb'}
font_magic = {b'\x00\x01\x00\x00', b'OTTO', b'ttcf', b'wOFF', b'wOF2'}
def check_font(name, data):
    if Path(name).suffix.lower() in font_ext or data[:4] in font_magic:
        raise RuntimeError(f'Font binary is excluded from distribution: {name}')
def digest(data): return hashlib.sha256(data).hexdigest()
def files(directory):
    return sorted(p for p in directory.rglob('*') if p.is_file()
                  and not any(s in {'.git', 'node_modules', '__pycache__', 'package-consumer'} for s in p.relative_to(directory).parts)
                  and p.name not in {'.DS_Store'})
paths = files(root)
entries = []
for file in paths:
    if file.is_symlink(): raise RuntimeError(f'Unexpected symbolic link: {file}')
    name = file.relative_to(root).as_posix()
    data = file.read_bytes(); check_font(name, data)
    if file.suffix == '.tgz':
        with tarfile.open(file, 'r:gz') as archive:
            for entry in archive.getmembers():
                if entry.isfile(): check_font(name + ':' + entry.name, archive.extractfile(entry).read())
    if name != 'SOURCE-MANIFEST.json': entries.append({'Path': name, 'Bytes': len(data), 'Sha256': digest(data)})
manifest = {'Version': version, 'Files': entries, 'ManifestExcludesItself': True, 'FontFiles': 0}
(root / 'SOURCE-MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n')

def write_zip(name, directory, prefix=''):
    target = output / name
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for file in files(directory):
            relative = file.relative_to(directory).as_posix()
            info = zipfile.ZipInfo(prefix + relative, date_time=(2026, 9, 21, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED; info.external_attr = 0o100644 << 16
            z.writestr(info, file.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    with zipfile.ZipFile(target) as z:
        bad = z.testzip()
        if bad: raise RuntimeError(f'ZIP CRC failure: {bad}')
        count = len(z.infolist())
    return {'File': target.name, 'Bytes': target.stat().st_size, 'Sha256': digest(target.read_bytes()), 'Entries': count}

result = [write_zip(f'AvaloniaWeb-{version}-source.zip', root, 'AvaloniaWeb/'),
          write_zip(f'AvaloniaWeb-{version}-ControlCatalog.zip', root / 'dist'),
          write_zip(f'AvaloniaWeb-{version}-npm-packages.zip', root / 'artifacts/npm')]
(output / f'AvaloniaWeb-{version}-archives.json').write_text(json.dumps({'Version': version, 'Archives': result}, indent=2) + '\n')
(output / f'AvaloniaWeb-{version}-SHA256SUMS.txt').write_text(''.join(f"{a['Sha256']}  {a['File']}\n" for a in result))
print(json.dumps(result, indent=2))
