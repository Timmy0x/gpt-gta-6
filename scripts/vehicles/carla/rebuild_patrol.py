import json,math,collections,sys,pathlib
sys.path.insert(0,'scripts/vehicles/carla');from mesh_description import parse
root=pathlib.Path('/tmp/codex-carla-probe/roster/NissanPatrol2021');sk=json.load(open(root/'SM_NissanPatrol2021-geometry.json'));md=json.load(open(root/'SM_Patrol2021Parked.mesh.json'))
class Grid:
 def __init__(self):self.g=collections.defaultdict(list)
 def add(self,p,v):self.g[tuple(math.floor(x*5) for x in p)].append((p,v))
 def nearest(self,p):
  key=[math.floor(x*5) for x in p];best=None;dist=.011
  for dx in [-1,0,1]:
   for dy in [-1,0,1]:
    for dz in [-1,0,1]:
     for q,v in self.g[(key[0]+dx,key[1]+dy,key[2]+dz)]:
      dd=sum((x-y)**2 for x,y in zip(p,q))
      if dd<dist:dist=dd;best=v
  return best
bonegrid=Grid()
for s in sk['lods'][0]['sections']:
 for v in s['vertices']:bonegrid.add(v['p'],s['boneMap'][v['bones'][0]])
doorgrid=Grid()
for side in ['FL','FR','RL','RR']:
 d=parse(root/('SM_Door'+side+'_Patrol2021.uasset'));b=next(x for x in sk['bones'] if x['name']=='Door_'+side)['pose']['Translation'];offset=[b[x] for x in ['X','Y','Z']]
 for v in d['vertices']:doorgrid.add([x+y for x,y in zip(v['p'],offset)],side)
vg=[];dg=[]
for v in md['vertices']:vg.append(bonegrid.nearest(v['p']));dg.append(doorgrid.nearest(v['p']))
counts=collections.Counter();sections=[];indices=[];allverts=0
for mi in [0,1,6]:
 vertices=[];faces=[]
 for t in md['triangles']:
  if t['material']!=mi:continue
  f=t['v'];ds=[dg[i] for i in f];bs=[vg[i] for i in f]
  if all(x is not None for x in ds):counts['removedDoor']+=1;continue
  bset=set(x for x in bs if x is not None)
  if len(bset)>1:counts['crossBone']+=1;print('cross',bs) if counts['crossBone']<3 else None
  bone=collections.Counter(x for x in bs if x is not None).most_common(1)[0][0] if bset else 0
  counts['bone'+str(bone)]+=1
  for i in f:
   v=md['vertices'][i];vertices.append({**v,'bones':[bone],'weights':[255]});indices.append(allverts+len(vertices)-1)
 sec={'material':{0:1,1:0,6:2}[mi],'baseIndex':len(indices)-len(vertices),'triangles':len(vertices)//3,'baseVertex':allverts,'boneMap':list(range(len(sk['bones']))),'vertices':vertices};sections.append(sec);allverts+=len(vertices)
sk['lods']=[{'level':0,'indices':indices,'vertexCount':allverts,'sections':sections}];sk['repair']={'source':'SM_Patrol2021Parked.uasset','reason':'Reconstruct topology from original static MeshDescription; preserve authored rig anchors and match/exclude separate source door surfaces.','counts':dict(counts)}
(root/'SM_NissanPatrol2021-repaired-geometry.json').write_text(json.dumps(sk,separators=(',',':')));print(counts,'tris',len(indices)//3)
