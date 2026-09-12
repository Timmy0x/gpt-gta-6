"""Write measured asset metadata and the runtime catalog after assembly."""
import json,pathlib,struct,hashlib,shutil
ROOT=pathlib.Path('/tmp/codex-carla-probe');OUT=pathlib.Path('public/vehicles/carla');OUT.mkdir(parents=True,exist_ok=True)
entries=[('hatchback','Mini2021','Mini Cooper hatchback',1450,.66,'low',-.99,.08),('coupe','MercedesCCC','Mercedes coupe',1750,.64,'low',-1.08,.09),('sedan','Ford_Crown','Crown sedan',1900,.62,'low',-1.00,.10),('suv','NissanPatrol2021','Patrol SUV',2700,.83,'upright',-.87,.25),('truck','Cybertruck','Cybertruck pickup',2800,.89,'upright',-.84,.36),('police','DodgeCharger2020','Police Charger',1860,.62,'low',-.98,.06),('executive','LincolnMKZ2020','Lincoln executive sedan',1850,.65,'low',-1.06,.10),('van','Sprinter','Sprinter van',2450,.85,'upright',-.82,1.22),('offroad','Jeep','Wrangler offroad',1820,.81,'upright',-.72,.04),('mpv','BmwGranTourer','Gran Tourer MPV',1600,.64,'upright',-.91,.12)]
catalog={}
for kind,source,label,mass,height,pose,seaty,seatz in entries:
 p=ROOT/('mini-complete.glb' if source=='Mini2021' else 'assembled/'+source+'.glb');raw=p.read_bytes();n=struct.unpack_from('<I',raw,12)[0];g=json.loads(raw[20:20+n]);points=[]
 bones=json.load(open(p.with_suffix('.parts.json')))['bones'];stats=json.load(open(p.with_suffix('.parts.json')))
 def visit(i,offset):
  node=g['nodes'][i];off=[offset[j]+node.get('translation',[0,0,0])[j] for j in range(3)]
  if 'mesh' in node:
   for prim in g['meshes'][node['mesh']]['primitives']:
    a=g['accessors'][prim['attributes']['POSITION']]
    for v in [a['min'],a['max']]:points.append([-v[0]-off[0],v[1]+off[1],v[2]+off[2]])
  for c in node.get('children',[]):visit(c,off)
 for i in g['scenes'][0]['nodes']:visit(i,[0,0,0])
 lo=[min(p[i] for p in points) for i in range(3)];hi=[max(p[i] for p in points) for i in range(3)];offset=[0,-lo[1]-height,0];lo=[lo[i]+offset[i] for i in range(3)];hi=[hi[i]+offset[i] for i in range(3)];width=hi[0]-lo[0];length=hi[2]-lo[2];centerz=(lo[2]+hi[2])/2
 fl=bones['Wheel_Front_Left'];rl=bones['Wheel_Rear_Left'];wheelbase=abs(fl[2]-rl[2]);radius=(fl[1]+rl[1])/2-(lo[1]-offset[1]);radius=max(.3,min(.5,radius));bodywidth=width*.91
 tuning={'label':label,'mass':mass,'width':round(bodywidth,3),'length':round(length,3),'height':.55,'wheelbase':round(wheelbase,3),'wheelRadius':round(radius,3),'engineForce':13500 if kind in ['coupe','truck','police'] else 10800,'topSpeed':62 if kind in ['coupe','police','executive'] else 42 if kind in ['offroad','van'] else 52,'grip':1.18 if kind not in ['offroad','van','suv'] else 1.08,'steering':.48,'suspensionTravel':.56 if kind not in ['offroad','truck','suv'] else .66,'suspensionCompression':.18}
 cabinheight=max(.5,hi[1]-.25);cabinlength=length*(.73 if kind in ['van','suv','mpv','offroad'] else .47);cabinz=.35 if kind=='truck' else centerz
 collision=[{'center':[0,0,centerz],'size':[bodywidth,.55,length*.98]},{'center':[0,.25+cabinheight/2,cabinz],'size':[bodywidth*.85,cabinheight,cabinlength]}]
 file=kind+'.glb';shutil.copyfile(p,OUT/file);catalog[kind]={'source':source,'file':file,'hash':hashlib.sha256(raw).hexdigest(),'triangles':stats['triangles'],'offset':offset,'seat':[-bodywidth*.23,seaty,seatz],'seatPose':pose,'bounds':{'min':lo,'max':hi},'collision':collision,'tuning':tuning}
 # The Mini fender repair preserves every saved component and lattice coordinate.
 if kind=='hatchback':catalog[kind]['damageLayout']='4cf3e2e030e5'
 (OUT/(kind+'.parts.json')).write_text(json.dumps(stats,indent=2))
pathlib.Path('src/vehicles/road-car-catalog.json').write_text(json.dumps(catalog,indent=2));print('CATALOG',len(catalog),'cars',sum(x['triangles'] for x in catalog.values()),'source triangles',sum((OUT/x['file']).stat().st_size for x in catalog.values()),'bytes')
