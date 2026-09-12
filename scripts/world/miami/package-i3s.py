"""Deterministic archive of the exact public source bytes used by the exporter."""
import gzip,hashlib,io,json,pathlib,tarfile
root=pathlib.Path(__file__).resolve().parents[3]/'data/world/miami/i3s'
path=root/'source-nodes.tar.gz'
with path.open('wb') as output, gzip.GzipFile(filename='',mode='wb',fileobj=output,mtime=0,compresslevel=6) as compressed, tarfile.open(fileobj=compressed,mode='w') as archive:
    for source in sorted(root.glob('*.bin')):
        data=source.read_bytes(); info=tarfile.TarInfo(source.name);info.size=len(data);info.mode=0o644;info.mtime=0
        archive.addfile(info,io.BytesIO(data))
data=path.read_bytes();manifest=json.loads((root/'manifest.json').read_text());manifest['archive']={'path':path.name,'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'contents':'Exact decompressed request payloads; deterministic tar/gzip metadata, no imagery/textures'}
(root/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(manifest['archive'])
