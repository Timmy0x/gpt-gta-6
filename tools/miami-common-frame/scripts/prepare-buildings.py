"""Rebuild Float64 geographic collision input from the retained public I3S archive.

Usage: python3 scripts/prepare-buildings.py /path/to/data/world/miami
The folder must contain building-envelopes.json, i3s/manifest.json and the
original i3s/source-nodes.tar.gz. All original request hashes are verified.
No provider geometry, network access or project-global paths are used.
"""
from pathlib import Path
import hashlib, io, json, struct, sys, tarfile
root=Path(__file__).resolve().parents[1]
source=Path(sys.argv[1]).resolve()
data=root/'data'
bbox=[-80.199,25.7596,-80.187,25.7704]
envelopes=json.loads((source/'building-envelopes.json').read_text())
selected=[f for f in envelopes['features'] if f['bboxWgs84'][0]<=bbox[2] and f['bboxWgs84'][2]>=bbox[0] and f['bboxWgs84'][1]<=bbox[3] and f['bboxWgs84'][3]>=bbox[1]]
i3s=json.loads((source/'i3s/manifest.json').read_text());requests={r['path']:r for r in i3s['requests']}
archive=source/'i3s'/i3s['archive']['path'];assert hashlib.sha256(archive.read_bytes()).hexdigest()==i3s['archive']['sha256']
raw=bytearray();buildings=[];verified={};cache={}
with tarfile.open(archive,'r:gz') as retained:
 for f in selected:
  payload=[]
  for name in [f"nodes_{f['node']}.bin",f"nodes_{f['node']}_geometries_0.bin"]:
   if name not in cache:
    b=retained.extractfile(name).read();assert hashlib.sha256(b).hexdigest()==requests[name]['sha256'];cache[name]=b
   verified[name]=requests[name];payload.append(cache[name])
  node=json.loads(payload[0]);b=payload[1];vc,fc=struct.unpack_from('<II',b);fo=8+vc*36;faces=fo+fc*8
  feature=next(i for i in range(fc) if struct.unpack_from('<Q',b,fo+i*8)[0]==f['sourceObjectId'])
  first,last=struct.unpack_from('<II',b,faces+feature*8);start=len(raw)
  for v in range(first*3,last*3+3):
   xyz=struct.unpack_from('<fff',b,8+v*12);normal=struct.unpack_from('<fff',b,8+vc*12+v*12)
   raw.extend(struct.pack('<dddfff',*(xyz[i]+node['mbs'][i] for i in range(3)),*normal))
  buildings.append({**f,'byteOffset':start,'vertices':(last-first+1)*3,'strideBytes':36,'layout':'float64 longitude,latitude,NAVD88 m; float32 Earth-centred source normal xyz'})
(data/'i3s-geographic.bin').write_bytes(raw)
(data/'i3s-geographic.json').write_text(json.dumps({'bboxWgs84':bbox,'sourceArchive':i3s['archive'],'source':i3s['source'],'buildings':buildings,'binary':'i3s-geographic.bin','sha256':hashlib.sha256(raw).hexdigest(),'rawSourceRequests':list(verified.values())},indent=2)+'\n')
preparation=json.loads((data/'preparation.json').read_text());preparation.update({'bboxWgs84':bbox,'surfaceBboxWgs84':[-80.19899,25.75961,-80.18701,25.77039],'derivedGeographicInputSha256':hashlib.sha256(raw).hexdigest(),'buildingCount':len(buildings),'triangles':sum(b['vertices']//3 for b in buildings),'sourcePreparation':{'script':'scripts/prepare-buildings.py','sourceFolderRequired':'data/world/miami with building-envelopes.json, i3s/manifest.json and i3s/source-nodes.tar.gz','archiveSha256':i3s['archive']['sha256'],'verifiedRequestCount':len(verified),'envelopeSha256':hashlib.sha256((source/'building-envelopes.json').read_bytes()).hexdigest()}})
(data/'preparation.json').write_text(json.dumps(preparation,indent=2)+'\n')
print(json.dumps({'buildings':len(buildings),'triangles':sum(b['vertices']//3 for b in buildings),'geographicBytes':len(raw),'verifiedRequests':len(verified)}))
