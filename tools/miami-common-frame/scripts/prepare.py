"""Bounded, offline source preparation. No imagery, provider tiles or new downloads."""
from pathlib import Path
import hashlib,json,math,shutil,struct
from PIL import Image

root=Path(__file__).resolve().parents[1]
repo=root.parents[1]
r5=repo/'.local-builds/miami-game-r5-source'
source=r5/'data/world/miami'
data=root/'data'
bbox=[-80.1925,25.7646,-80.1889,25.7678]
records=[]
def copy(src,dest):
    dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dest)
    records.append({'sourcePath':str(src.relative_to(repo)),'path':str(dest.relative_to(root)),'sha256':hashlib.sha256(src.read_bytes()).hexdigest()})
for name in ['types.ts','projection.ts','MiamiGeometry.ts','MiamiElevation.ts','MiamiQueries.ts','MiamiRoads.ts','MiamiTerrain.ts','MiamiPackages.ts']:
    copy(r5/'src/world/miami'/name,root/'vendor/world/miami'/name)
for name in ['terrain/grid.json','terrain/heights.f32','terrain/source-mask.u8','terrain/manifest.json','manifest.json','raw/city-streets.geojson','raw/city-water.geojson','research/county-3d-layer.json']:
    copy(source/name,data/name)
copy(r5/'public/world/miami/dataset.json',data/'dataset-r5.json')
grid=repo/'.local-builds/miami-height-alignment-r1/us_noaa_g2018u0.tif'
assert hashlib.sha256(grid.read_bytes()).hexdigest()=='fa9a407ac7ee3f5a3694008e4bcd09ce9cc250452f0c3b11700a4960340abce2'
image=Image.open(grid);scale=image.tag_v2[33550];tie=image.tag_v2[33922];keys=image.tag_v2[34735]
entries={keys[i]:keys[i+3] for i in range(4,len(keys),4)}
assert image.mode=='F' and entries[1025]==2 and entries[2048]==6318 and entries[4096]==6319
# 6x6 original point samples, with >1km margins around the retained district. No resampling.
c=math.floor((-80.193+360-tie[3])/scale[0])-2;r=math.floor((tie[4]-25.765)/scale[1])-2
geoid={'id':'noaa-geoid18-brickell-original-samples','sourceUrl':'https://cdn.proj.org/us_noaa_g2018u0.tif','sourceSha256':hashlib.sha256(grid.read_bytes()).hexdigest(),'license':'NOAA Public Domain','licenseUrl':'https://cdn.proj.org/us_noaa_README.txt','width':6,'height':6,'longitudeOrigin':tie[3]+c*scale[0]-360,'latitudeOrigin':tie[4]-r*scale[1],'longitudeStep':scale[0],'latitudeStep':-scale[1],'rasterPixelIsPoint':True,'sourceColumn':c,'sourceRow':r,'inputHorizontal':'NAD83(2011) EPSG:6318','operation':'NAVD88 H + GEOID18 N = NAD83(2011) ellipsoid h','values':[float(image.getpixel((c+x,r+y))) for y in range(6) for x in range(6)]}
(data/'geoid18.json').write_text(json.dumps(geoid,indent=2)+'\n')
copy(repo/'.local-builds/miami-height-alignment-r1/us_noaa_README.txt',data/'geoid18-license.txt')
index=json.loads((source/'building-meshes.json').read_text());envelopes=json.loads((source/'building-envelopes.json').read_text())
selected=[f for f in envelopes['features'] if f['bboxWgs84'][0]<=bbox[2] and f['bboxWgs84'][2]>=bbox[0] and f['bboxWgs84'][1]<=bbox[3] and f['bboxWgs84'][3]>=bbox[1]]
i3s=json.loads((source/'i3s/manifest.json').read_text());requests={r['path']:r for r in i3s['requests']}
raw=bytearray();buildings=[];verified={}
for f in selected:
    names=[f"nodes_{f['node']}.bin",f"nodes_{f['node']}_geometries_0.bin"]
    payload=[]
    for name in names:
        # Frozen source cache may be absent; exact original request hashes govern the retained repo cache.
        path=source/'i3s'/name
        if not path.exists():path=repo/'data/world/miami/i3s'/name
        b=path.read_bytes();assert hashlib.sha256(b).hexdigest()==requests[name]['sha256']
        verified[name]=requests[name];payload.append(b)
    node=json.loads(payload[0]);b=payload[1];vc,fc=struct.unpack_from('<II',b);fo=8+vc*36;faces=fo+fc*8
    feature=next(i for i in range(fc) if struct.unpack_from('<Q',b,fo+i*8)[0]==f['sourceObjectId'])
    first,last=struct.unpack_from('<II',b,faces+feature*8);start=len(raw)
    for v in range(first*3,last*3+3):
        xyz=struct.unpack_from('<fff',b,8+v*12);normal=struct.unpack_from('<fff',b,8+vc*12+v*12)
        raw.extend(struct.pack('<dddfff',*(xyz[i]+node['mbs'][i] for i in range(3)),*normal))
    buildings.append({**f,'byteOffset':start,'vertices':(last-first+1)*3,'strideBytes':36,'layout':'float64 longitude,latitude,NAVD88 m; float32 Earth-centred source normal xyz'})
(data/'i3s-geographic.bin').write_bytes(raw)
(data/'i3s-geographic.json').write_text(json.dumps({'bboxWgs84':bbox,'sourceArchive':i3s['archive'],'source':i3s['source'],'buildings':buildings,'binary':'i3s-geographic.bin','sha256':hashlib.sha256(raw).hexdigest(),'rawSourceRequests':list(verified.values())},indent=2)+'\n')
(data/'preparation.json').write_text(json.dumps({'bboxWgs84':bbox,'copiedSources':records,'derivedGeographicInputSha256':hashlib.sha256(raw).hexdigest(),'buildingCount':len(buildings),'triangles':sum(b['vertices']//3 for b in buildings)},indent=2)+'\n')
print(json.dumps({'buildings':len(buildings),'triangles':sum(b['vertices']//3 for b in buildings),'geographicBytes':len(raw)}))
