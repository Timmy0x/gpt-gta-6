"""Verify and prepare one retained public source cell without modifying accepted inputs."""
from pathlib import Path
from PIL import Image
import array, gzip, hashlib, io, json, math, struct, sys, tarfile

repo=Path(__file__).resolve().parents[3]
root=repo/'data/world/miami/expansions/downtown-edge-r5'
sha=lambda b:hashlib.sha256(b).hexdigest()
load=lambda p:json.loads(p.read_text())
manifest=load(root/'manifest.json');i3s=load(root/'i3s/manifest.json');layer=load(root/'metadata/county-3d-layer.json')
assert layer['store']['version']=='1.6' and layer['spatialReference']['vcsWkid']==5703
assert layer['store']['defaultGeometrySchema']['ordering']==['position','normal','uv0','color']
for r in manifest['requests']:
 assert sha((root/r['path']).read_bytes())==r['sha256'],r['path']
for r in i3s['requests']:
 assert sha((root/'i3s'/r['path']).read_bytes())==r['sha256'],r['path']
prepared=root/'prepared';prepared.mkdir(exist_ok=True)
def strings(b):
 count,total=struct.unpack_from('<II',b);offset=8+count*4;values=[]
 for i in range(count):
  length=struct.unpack_from('<I',b,8+i*4)[0];values.append(b[offset:offset+length].decode().rstrip('\0'));offset+=length
 assert offset==len(b) and offset-(8+count*4)==total
 return values
read_node=lambda node,suffix='':(root/'i3s'/f'nodes_{node}{suffix}.bin').read_bytes()
raw=bytearray();features=[];seen=set();excluded=0;bbox=manifest['bboxWgs84']
for node_id in i3s['leaves']:
 node=json.loads(read_node(node_id));b=read_node(node_id,'_geometries_0');vc,fc=struct.unpack_from('<II',b)
 feature_offset=8+vc*36;faces_offset=feature_offset+fc*8
 assert len(b)==faces_offset+fc*8
 unique=strings(read_node(node_id,'_attributes_f_0_0'));source=strings(read_node(node_id,'_attributes_f_2_0'));kind=strings(read_node(node_id,'_attributes_f_3_0'))
 oids=read_node(node_id,'_attributes_f_1_0');years=read_node(node_id,'_attributes_f_4_0');declared=json.loads(read_node(node_id,'_features_0'))['featureData']
 assert len(unique)==fc and struct.unpack_from('<I',oids)[0]==fc and len(declared)==fc
 for f in range(fc):
  oid=struct.unpack_from('<I',oids,4+f*4)[0];first,last=struct.unpack_from('<II',b,faces_offset+f*8)
  assert oid==struct.unpack_from('<Q',b,feature_offset+f*8)[0]==declared[f]['id']
  assert [first,last]==declared[f]['geometries'][0]['params']['faceRange'] and first<=last and last*3+2<vc
  minimum=[math.inf]*3;maximum=[-math.inf]*3
  for vertex in range(first*3,last*3+3):
   for axis in range(3):
    value=struct.unpack_from('<f',b,8+vertex*12+axis*4)[0]+node['mbs'][axis]
    assert math.isfinite(value);minimum[axis]=min(minimum[axis],value);maximum[axis]=max(maximum[axis],value)
  if minimum[0]>bbox[2] or maximum[0]<bbox[0] or minimum[1]>bbox[3] or maximum[1]<bbox[1]:excluded+=1;continue
  assert oid not in seen,('duplicate finest-source ID',oid);seen.add(oid);offset=len(raw)
  for vertex in range(first*3,last*3+3):
   xyz=struct.unpack_from('<fff',b,8+vertex*12);normal=struct.unpack_from('<fff',b,8+vc*12+vertex*12)
   raw.extend(struct.pack('<dddfff',*[xyz[a]+node['mbs'][a] for a in range(3)],*normal))
  features.append({'id':f'county-i3s:{oid}','sourceUniqueId':unique[f],'sourceObjectId':oid,'node':node_id,'source':source[f],'buildingType':kind[f],'yearUpdated':struct.unpack_from('<h',years,4+f*2)[0],'bboxWgs84':[minimum[0],minimum[1],maximum[0],maximum[1]],'groundM':minimum[2],'roofM':maximum[2],'heightM':maximum[2]-minimum[2],'verticalDatum':'NAVD88 (EPSG:5703)','byteOffset':offset,'vertices':(last-first+1)*3,'triangles':last-first+1,'strideBytes':36,'layout':'float64longitude,latitude,NAVD88m;float32Earth-centrednormalxyz','method':'All original finest-source feature faces, geographic Float32 offsets + original node MBS in Float64; no extrusion, roof approximation, clipping, simplification or invented height.'})
(prepared/'i3s-geographic.bin').write_bytes(raw)
features.sort(key=lambda f:f['sourceObjectId'])
(prepared/'i3s-geographic.json').write_text(json.dumps({'bboxWgs84':bbox,'source':i3s['source'],'sourceItem':i3s['item'],'sourceVersion':i3s['sourceVersion'],'sourceEpoch':'EPSG:4326 realization/coordinate epoch unresolved; per-feature year retained','binary':'i3s-geographic.bin','sha256':sha(raw),'buildings':features,'excludedOutsideAOI':excluded},indent=2)+'\n')
# Deterministic public payload archive, excluding texture/image resources.
archive=root/'i3s/source-nodes.tar.gz'
with archive.open('wb') as destination:
 with gzip.GzipFile(filename='',mode='wb',fileobj=destination,mtime=0) as compressed:
  with tarfile.open(fileobj=compressed,mode='w',format=tarfile.USTAR_FORMAT) as retained:
   for path in sorted({r['path'] for r in i3s['requests']}):
    payload=(root/'i3s'/path).read_bytes();info=tarfile.TarInfo(path);info.size=len(payload);info.mode=0o644;info.mtime=0;retained.addfile(info,io.BytesIO(payload))
i3s['archive']={'path':'source-nodes.tar.gz','sha256':sha(archive.read_bytes()),'bytes':archive.stat().st_size,'contents':'Exact source node/geometry/feature/attribute payloads; no source imagery/textures'}
(root/'i3s/manifest.json').write_text(json.dumps(i3s,indent=2)+'\n')
terrain=load(root/'terrain/manifest.json');image=Image.open(root/'terrain/dem.tif');assert image.mode=='F' and image.size==(terrain['width'],terrain['height'])
scale=image.tag_v2[33550];tie=image.tag_v2[33922];nodata=float(image.tag_v2[42113]);assert tie[:3]==(0,0,0) and scale[0]>0 and scale[1]>0
values=array.array('f',image.get_flattened_data() if hasattr(image,'get_flattened_data') else image.getdata());assert all(math.isfinite(v) and v!=nodata for v in values),'No-data must not be invented or silently filled'
if sys.byteorder!='little':values.byteswap()
heights=values.tobytes();mask=bytes(len(values));(prepared/'terrain').mkdir(exist_ok=True)
(prepared/'terrain/heights.f32').write_bytes(heights);(prepared/'terrain/source-mask.u8').write_bytes(mask)
grid={'version':1,'id':terrain['id'],'source':terrain['source'],'width':image.width,'height':image.height,'binary':'heights.f32','componentType':'float32','byteOrder':'little-endian','rowOrder':'north-to-south','columnOrder':'west-to-east','pixelCenterLongitude':tie[3]+scale[0]/2,'pixelCenterLatitude':tie[4]-scale[1]/2,'longitudeStep':scale[0],'latitudeStep':-scale[1],'extentWgs84':terrain['extent'],'verticalDatum':terrain['verticalDatum'],'units':'meters','sourceResolutionM':1,'resampling':'bilinear to retained0.00001-degree WGS84 phase','minM':min(values),'maxM':max(values),'noData':nodata,'validPixels':len(values),'sourceSha256':sha((root/'terrain/dem.tif').read_bytes()),'sourceMask':'source-mask.u8','sourceMaskSha256':sha(mask),'sourceMaskValues':{'0':'Miami-Dade D23 one-meter source'},'fallbackPixels':0,'sha256':sha(heights),'byteLength':len(heights),'gaps':['Bare-earth elevations do not establish bridge decks, curbs, tide or bathymetry.','Water must remain excluded from standing/driving support.','Horizontal realization/epoch and mixed2015building/D23terrain physical correspondence remain unresolved.']}
(prepared/'terrain/grid.json').write_text(json.dumps(grid,indent=2)+'\n')
baseline=repo/'data/world/miami';old_grid=load(baseline/'terrain/grid.json');old_buildings=load(baseline/'building-envelopes.json')['features']
overlap=[]
for id in ['city-streets','city-water','city-shoreline','county-buildings']:
 old_features=load(baseline/'raw'/f'{id}.geojson')['features'];new_features=load(root/'raw'/f'{id}.geojson')['features']
 field=next(s['objectIdField'] for s in manifest['sources'] if s['id']==id);old_by_id={f['properties'][field]:f for f in old_features};duplicates=[f for f in new_features if f['properties'][field] in old_by_id]
 overlap.append({'source':id,'sharedIds':len(duplicates),'geometryIdentical':sum(f['geometry']==old_by_id[f['properties'][field]]['geometry'] for f in duplicates),'ids':[f['properties'][field] for f in duplicates]})
shared_3d=sorted(seen & {b['sourceObjectId'] for b in old_buildings})
phase_lon=(grid['pixelCenterLongitude']-old_grid['pixelCenterLongitude'])/old_grid['longitudeStep'];phase_lat=(grid['pixelCenterLatitude']-old_grid['pixelCenterLatitude'])/old_grid['latitudeStep']
seam_step=(grid['pixelCenterLatitude']+(grid['height']-1)*grid['latitudeStep']-old_grid['pixelCenterLatitude'])/old_grid['latitudeStep']
assert abs(phase_lon-round(phase_lon))<1e-5 and abs(phase_lat-round(phase_lat))<1e-5 and abs(seam_step+1)<1e-5
# A rectangular west strip allows a real cross-seam bilinear stencil, preserving accepted source samples verbatim.
old_heights=(baseline/'terrain/heights.f32').read_bytes();old_mask=(baseline/'terrain/source-mask.u8').read_bytes();strip=bytearray(heights);strip_mask=bytearray(mask)
for row in range(old_grid['height']):
 strip.extend(old_heights[row*old_grid['width']*4:row*old_grid['width']*4+grid['width']*4]);strip_mask.extend(old_mask[row*old_grid['width']:row*old_grid['width']+grid['width']])
(prepared/'terrain/northwest-strip-heights.f32').write_bytes(strip);(prepared/'terrain/northwest-strip-source-mask.u8').write_bytes(strip_mask)
strip_values=array.array('f');strip_values.frombytes(strip)
strip_grid={**grid,'id':'brickell-to-downtown-west-strip-r5-preparation','height':grid['height']+old_grid['height'],'binary':'northwest-strip-heights.f32','sourceMask':'northwest-strip-source-mask.u8','sha256':sha(strip),'sourceMaskSha256':sha(strip_mask),'byteLength':len(strip),'validPixels':len(strip)//4,'extentWgs84':{'xmin':bbox[0],'xmax':bbox[2],'ymin':old_grid['extentWgs84']['ymin'],'ymax':bbox[3]},'minM':min(strip_values),'maxM':max(strip_values),'sourceMaskValues':old_grid['sourceMaskValues'],'fallbackPixels':strip_mask.count(1),'inputSources':[{'grid':'data/world/miami/terrain/grid.json','heightsSha256':old_grid['sha256'],'maskSha256':old_grid['sourceMaskSha256']},{'grid':'prepared/terrain/grid.json','heightsSha256':grid['sha256'],'maskSha256':grid['sourceMaskSha256']}],'method':'New north cell followed by original accepted west600columns, byte-for-byte. Cross-seam samples are real adjacent source cells, no extra terrain values.'}
(prepared/'terrain/northwest-strip-grid.json').write_text(json.dumps(strip_grid,indent=2)+'\n')
old_values=array.array('f');old_values.frombytes(old_heights);new_values=array.array('f');new_values.frombytes(heights)
seam_deltas=[abs(new_values[(grid['height']-1)*grid['width']+c]-old_values[c]) for c in range(grid['width'])]
reconciliation={'overlap':overlap,'shared3dSourceIds':shared_3d,'shared3dCount':len(shared_3d),'terrainGridPhaseColumns':phase_lon,'terrainGridPhaseRows':phase_lat,'seamAdjacentPixelStep':seam_step,'seamAdjacentSampleAbsoluteDeltaM':{'maximum':max(seam_deltas),'mean':sum(seam_deltas)/len(seam_deltas),'interpretation':'Adjacent ~1m cells, not same-point survey residual; large curb/riverbank gradients require local inspection.'},'strip':{'width':grid['width'],'height':strip_grid['height'],'bytes':len(strip),'noSyntheticSamples':True}}
(prepared/'reconciliation.json').write_text(json.dumps(reconciliation,indent=2)+'\n')
summary={'features3D':len(features),'triangles':sum(f['triangles'] for f in features),'geographicBytes':len(raw),'years':sorted({f['yearUpdated'] for f in features}),'excludedOutsideAOI':excluded,'terrainPixels':len(values),'terrainRangeM':[min(values),max(values)],'archiveBytes':archive.stat().st_size,'archiveSha256':i3s['archive']['sha256'],'shared3DCount':len(shared_3d),'seam':reconciliation['seamAdjacentSampleAbsoluteDeltaM']}
(prepared/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(summary))
