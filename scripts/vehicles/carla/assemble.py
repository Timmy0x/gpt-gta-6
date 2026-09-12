"""Build part-preserving glTF from CARLA's source geometry and original texture maps."""
import argparse,collections,io,json,math,pathlib,struct,sys
from PIL import Image,ImageOps
from mesh_description import parse as read_static

def convert(v): return [-v[1]*.01,v[2]*.01,v[0]*.01]
def normal(v): return [-v[1],v[2],v[0]]
def asset_name(ref): return ref.get('ObjectPath','').split('/')[-1] if ref else ''
class GLB:
 def __init__(self):
  self.bin=bytearray();self.g={'asset':{'version':'2.0','generator':'CARLA source part converter','copyright':'CARLA contributors, CC BY 4.0'},'scene':0,'scenes':[{'nodes':[]}],'nodes':[],'meshes':[],'materials':[],'buffers':[{'byteLength':0}],'bufferViews':[],'accessors':[],'images':[],'textures':[],'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}],'extensionsUsed':['KHR_materials_clearcoat']}
 def view(self,data):
  while len(self.bin)%4:self.bin.append(0)
  offset=len(self.bin);self.bin.extend(data);i=len(self.g['bufferViews']);self.g['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(data)});return i
 def acc(self,values,components,fmt,ctype,bounds=False):
  flat=[x for v in values for x in v] if components>1 else values;view=self.view(struct.pack('<'+fmt*len(flat),*flat));a={'bufferView':view,'componentType':ctype,'count':len(values),'type':'SCALAR' if components==1 else 'VEC'+str(components)}
  if bounds:a.update(min=[min(v[c] for v in values) for c in range(components)],max=[max(v[c] for v in values) for c in range(components)])
  i=len(self.g['accessors']);self.g['accessors'].append(a);return i
 def texture(self,image,mime):
  i=len(self.g['images']);self.g['images'].append({'bufferView':self.view(image),'mimeType':mime});self.g['textures'].append({'sampler':0,'source':i});return i
 def save(self,path):
  self.g['buffers'][0]['byteLength']=len(self.bin);jb=json.dumps(self.g,separators=(',',':')).encode();jb+=b' '*((-len(jb))%4);self.bin.extend(b'\0'*((-len(self.bin))%4));path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(jb)+len(self.bin))+struct.pack('<II',len(jb),0x4e4f534a)+jb+struct.pack('<II',len(self.bin),0x004e4942)+self.bin)

class Assembly:
 def __init__(self,source,material_overrides=None,slot_roles=None):self.source=source;self.glb=GLB();self.parts=[];self.groups={};self.materials={};self.texture_cache={};self.material_info={};self.stats=[];self.material_overrides=material_overrides or {};self.slot_roles=slot_roles or {}
 def metadata(self,name):
  p=self.source/(name+'.metadata.json')
  if not p.exists():p=self.source.parent.parent/'shared'/(name+'.metadata.json')
  return json.loads(p.read_text()) if p.exists() else []
 def source_texture(self,name,kind):
  key=(name,kind)
  if key in self.texture_cache:return self.texture_cache[key]
  p=self.source/(name+'.sourcebin')
  if not p.exists():return None
  image=Image.open(p).convert('RGB');image.thumbnail((2048,2048),Image.Resampling.LANCZOS)
  if kind=='normal':
   r,g,b=image.split();image=Image.merge('RGB',(r,ImageOps.invert(g),b))
  # Preserve authored texels. Unreal DirectX normal maps differ from glTF only in green orientation.
  out=io.BytesIO();image.save(out,format='JPEG',quality=94,subsampling=0);t=self.glb.texture(out.getvalue(),'image/jpeg');self.texture_cache[key]=t;return t
 def material(self,name):
  if name in self.materials:return self.materials[name]
  objects=self.metadata(name);meta=next((x for x in objects if x['Type'] in ['MaterialInstanceConstant','Material']),None);p=meta.get('Properties',{}) if meta else {};textures={x['ParameterInfo']['Name']:asset_name(x.get('ParameterValue')) for x in p.get('TextureParameterValues',[])}
  expressions={x['Name']:x for x in objects if x['Type'].startswith('MaterialExpression')}
  def evaluate(input,depth=0):
   if depth>8:return None,[1,1,1]
   exp=expressions.get(input.get('ExpressionName',''))
   if not exp:return None,[float(input.get('Constant',1))]*3 if isinstance(input.get('Constant'),(int,float)) else [1,1,1]
   ep=exp.get('Properties',{});typ=exp['Type']
   if 'TextureSample' in typ:return asset_name(ep.get('Texture')),[1,1,1]
   if typ in ['MaterialExpressionConstant3Vector','MaterialExpressionVectorParameter']:
    c=ep.get('Constant',ep.get('DefaultValue',{}));return None,[c.get(k,1) for k in ['R','G','B']]
   if typ=='MaterialExpressionConstant':return None,[ep.get('R',1)]*3
   if typ=='MaterialExpressionMultiply':
    ta,ca=evaluate(ep.get('A',{'Constant':ep.get('ConstA',1)}),depth+1);tb,cb=evaluate(ep.get('B',{'Constant':ep.get('ConstB',1)}),depth+1);return ta or tb,[a*b for a,b in zip(ca,cb)]
   return None,[1,1,1]
  graph={k:evaluate(p.get(k,{})) for k in ['BaseColor','Normal','Roughness','Metallic']}
  if meta and meta['Type']=='Material':
   for prop,key in [('BaseColor','Diffuse'),('Normal','Normal'),('Roughness','ORM')]:
    if graph[prop][0]:textures[key]=graph[prop][0]
  n=name.lower();isglass='glass' in n or 'windshield' in n;islight='light' in n or 'siren' in n;ispaint='body' in n;role='lamp-glass' if isglass and islight else 'glass' if isglass else 'lamp' if islight else 'paint' if ispaint else 'interior'
  if n=='mi_glassint_red':role='police-red'
  if n=='mi_glassint_blue':role='police-blue'
  m={'name':role+'--'+name,'pbrMetallicRoughness':{'baseColorFactor':[.2,.27,.3,.16] if isglass else [1,1,1,1],'metallicFactor':.1 if isglass else 1,'roughnessFactor':.08 if isglass else 1},'extras':{'role':role,'sourceMaterial':name}}
  if ispaint:m['extensions']={'KHR_materials_clearcoat':{'clearcoatFactor':.9,'clearcoatRoughnessFactor':.14}}
  if isglass:m.update(alphaMode='BLEND',doubleSided=True)
  if role=='police-red':m['pbrMetallicRoughness']['baseColorFactor']=[.65,.015,.015,.75];m['emissiveFactor']=[.12,.003,.003]
  if role=='police-blue':m['pbrMetallicRoughness']['baseColorFactor']=[.015,.04,.7,.75];m['emissiveFactor']=[.003,.006,.12]
  found={}
  for key,kind,slot in [('Diffuse','color','baseColorTexture'),('BaseColor','color','baseColorTexture'),('ORM','orm','metallicRoughnessTexture'),('Normal','normal','normalTexture')]:
   if textures.get(key):
    t=self.source_texture(textures[key],kind)
    if t is not None:
     found[key]=textures[key]
     if slot=='normalTexture':m[slot]={'index':t}
     else:m['pbrMetallicRoughness'][slot]={'index':t}
     if key=='ORM':m['occlusionTexture']={'index':t,'strength':.75}
  if not isglass and 'metallicRoughnessTexture' not in m['pbrMetallicRoughness']:
   m['pbrMetallicRoughness'].update(metallicFactor=.72 if ispaint else .05,roughnessFactor=.26 if ispaint else .55)
  if meta and meta['Type']=='Material':
   if graph['BaseColor'][0]:m['pbrMetallicRoughness']['baseColorFactor']=graph['BaseColor'][1]+[1]
   if not graph['Roughness'][0]:m['pbrMetallicRoughness']['roughnessFactor']=max(.08,min(1,graph['Roughness'][1][0]))
   if not graph['Metallic'][0]:m['pbrMetallicRoughness']['metallicFactor']=max(0,min(1,graph['Metallic'][1][0]))
  if islight:m['emissiveFactor']=[.08,.075,.06]
  if not found and not isglass and not islight:
   vectors={x['ParameterInfo']['Name'].lower().replace(' ',''):x['ParameterValue'] for x in p.get('VectorParameterValues',[])}
   color=next((vectors[k] for k in ['basecolor','color','diffusecolor'] if k in vectors),None)
   m['pbrMetallicRoughness']['baseColorFactor']=[color.get(c,1) for c in ['R','G','B']]+[1] if color else [.12,.13,.14,1]
   scalars={x['ParameterInfo']['Name'].lower().replace(' ',''):x['ParameterValue'] for x in p.get('ScalarParameterValues',[])}
   for key in ['roughness','metallic']:
    if key in scalars:m['pbrMetallicRoughness'][key+'Factor']=max(0,min(1,scalars[key]))
  index=len(self.glb.g['materials']);self.glb.g['materials'].append(m);self.materials[name]=index;self.material_info[name]={'textures':found,'role':role};return index
 def add(self,name,group,pivot,vertices,faces,material,local=False,partition=True,source_slot=''):
  if not faces:return
  material=self.material_overrides.get(material,material)
  self.material(material);role=self.slot_roles.get(source_slot,self.material_info[material]['role'])
  if 'light' in source_slot.lower() and role not in ['lamp','lamp-glass']:role='lamp-glass' if role=='glass' else 'lamp'
  if partition and group=='Vehicle_Base' and role in ['glass','lamp','lamp-glass']:
   # Preserve disconnected physical panes/light assemblies instead of treating all
   # glass or lamps around the car as one damage component. UV seams share position.
   parents=list(range(len(faces)));owners={}
   def find(i):
    while parents[i]!=i:parents[i]=parents[parents[i]];i=parents[i]
    return i
   for fi,face in enumerate(faces):
    for vi in face:
     key=tuple(round(x,4) for x in vertices[vi]['p'])
     if key in owners:parents[find(fi)]=find(owners[key])
     else:owners[key]=fi
   groups=collections.defaultdict(list)
   for fi,face in enumerate(faces):groups[find(fi)].append(face)
   pieces=[]
   for ff in groups.values():
    pp=[vertices[i]['p'] for face in ff for i in face];pieces.append([ff,[min(p[j] for p in pp) for j in range(3)],[max(p[j] for p in pp) for j in range(3)]])
   tolerance=20 if role.startswith('lamp') else 2.5 # Source centimetres.
   merged=True
   while merged:
    merged=False
    for i in range(len(pieces)):
     if merged:break
     for j in range(i+1,len(pieces)):
      a,b=pieces[i],pieces[j]
      if sum(max(0,a[1][k]-b[2][k],b[1][k]-a[2][k])**2 for k in range(3))<=tolerance*tolerance:
       pieces[i]=[a[0]+b[0],[min(a[1][k],b[1][k]) for k in range(3)],[max(a[2][k],b[2][k]) for k in range(3)]];pieces.pop(j);merged=True;break
   if len(pieces)>1:
    pieces.sort(key=lambda p:tuple((p[1][i]+p[2][i])/2 for i in [0,1,2]))
    for i,piece in enumerate(pieces):self.add(name+'--component-'+str(i),group,pivot,vertices,piece[0],material,local,False,source_slot)
    return
  used=sorted(set(i for f in faces for i in f));remap={v:i for i,v in enumerate(used)};positions=[];normals=[];uv=[]
  for i in used:
   v=vertices[i];p=convert(v['p']);positions.append(p if local else [p[j]-pivot[j] for j in range(3)]);normals.append(normal(v['n']));uv.append(v['uv'])
  # Skeletal source normals are 8-bit packed. Reconstruct continuous paint normals
  # from the original faces while preserving authored sharp normal discontinuities.
  # This removes quantisation bands from broad reflective panels without changing
  # positions, UVs, panel seams or wheel/door ownership.
  self.material(material)
  if role=='paint':
   samples=collections.defaultdict(list)
   for f in faces:
    ids=[remap[i] for i in f];a,b,c=[positions[i] for i in ids];ab=[b[j]-a[j] for j in range(3)];ac=[c[j]-a[j] for j in range(3)];cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];length=math.sqrt(sum(v*v for v in cross))
    if length<1e-12:continue
    sign=1 if sum(cross[j]*normals[ids[0]][j] for j in range(3))>=0 else -1;unit=[v/length*sign for v in cross]
    for index,i in enumerate(ids):
     p=positions[i];one=positions[ids[(index+1)%3]];two=positions[ids[(index+2)%3]];u=[one[j]-p[j] for j in range(3)];v=[two[j]-p[j] for j in range(3)];denom=math.sqrt(sum(x*x for x in u)*sum(x*x for x in v))
     if denom<1e-15:continue
     angle=math.acos(max(-1,min(1,sum(x*y for x,y in zip(u,v))/denom)));samples[tuple(round(x,6) for x in p)].append((unit,angle))
   for i,p in enumerate(positions):
    candidates=[(n,w) for n,w in samples[tuple(round(x,6) for x in p)] if sum(n[j]*normals[i][j] for j in range(3))>.72]
    if not candidates:continue
    summed=[sum(n[j]*w for n,w in candidates) for j in range(3)];length=math.sqrt(sum(x*x for x in summed))
    if length>1e-8:normals[i]=[x/length for x in summed]
  # Weld only vertices with identical position/normal/UV, preserving hard edges and UV seams.
  unique={};pp=[];nn=[];tt=[];weld={}
  for i,(p,n,t) in enumerate(zip(positions,normals,uv)):
   key=tuple(p+n+list(t));j=unique.get(key)
   if j is None:j=len(pp);unique[key]=j;pp.append(p);nn.append(n);tt.append(t)
   weld[i]=j
  orientation=0
  for f in faces[:300]:
   a,b,c=[positions[remap[i]] for i in f];ab=[b[j]-a[j] for j in range(3)];ac=[c[j]-a[j] for j in range(3)];cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];n=normals[remap[f[0]]];orientation+=sum(cross[j]*n[j] for j in range(3))
  indices=[weld[remap[i]] for f in faces for i in (f[::-1] if orientation<0 else f)]
  g=self.glb.g
  if group not in self.groups:
   root=len(g['nodes']);g['nodes'].append({'name':group,'translation':pivot,'children':[]});g['scenes'][0]['nodes'].append(root);self.groups[group]=root
  mat=self.material(material);mi=len(g['meshes']);g['meshes'].append({'name':name,'primitives':[{'attributes':{'POSITION':self.glb.acc(pp,3,'f',5126,True),'NORMAL':self.glb.acc(nn,3,'f',5126),'TEXCOORD_0':self.glb.acc(tt,2,'f',5126)},'indices':self.glb.acc(indices,1,'I',5125),'material':mat}]});node=len(g['nodes']);g['nodes'].append({'name':name,'mesh':mi,'extras':{'group':group,'role':role}});g['nodes'][self.groups[group]]['children'].append(node)
  self.stats.append({'name':name,'group':group,'vertices':len(pp),'triangles':len(faces),'material':material,'role':role})
 def skeletal(self,path,lod_index=0,authored_doors=None):
  d=json.loads(path.read_text());lod=d['lods'][lod_index];bones=d['bones'];pivots=[]
  for b in bones:
   t=b['pose']['Translation'];assert b['parent']<=0,'Review nested transforms';pivots.append(convert([t['X'],t['Y'],t['Z']]))
  self.bones={b['name']:p for b,p in zip(bones,pivots)};verts={};groups=collections.defaultdict(list)
  for door in authored_doors or []:
   bones.append({'name':door['name']});pivots.append(convert(door['hinge']));self.bones[door['name']]=pivots[-1];door['index']=len(bones)-1
  for s in lod['sections']:
   for i,v in enumerate(s['vertices']):
    active=[j for j,w in enumerate(v['weights']) if w>0];assert len(active)==1,'Review nonrigid source';v['bone']=s['boneMap'][v['bones'][active[0]]];verts[s['baseVertex']+i]=v
   for off in range(s['baseIndex'],s['baseIndex']+s['triangles']*3,3):
    f=lod['indices'][off:off+3];ids=[verts[i]['bone'] for i in f];assert len(set(ids))==1;bone=ids[0]
    if bone==0:
     center=[sum(verts[i]['p'][axis] for i in f)/3 for axis in range(3)]
     for door in authored_doors or []:
      if all(door['min'][axis]<=center[axis]<=door['max'][axis] for axis in range(3)):
       bone=door['index'];break
    groups[(bone,s['material'])].append(f)
  for (bi,mi),faces in groups.items():
   material=asset_name(d['materialRefs'][mi]);group=bones[bi]['name'];self.add(group+'--'+material,group,pivots[bi],verts,faces,material,source_slot=d['materials'][mi])
 def static(self,path,group='Vehicle_Base',pivot=None,local=False,include=None):
  d=read_static(path);metadata=next((x for x in self.metadata(path.stem) if x['Type']=='StaticMesh'),None);assert metadata,'Static mesh metadata absent: '+str(path)
  materials=metadata.get('StaticMaterials',metadata['Properties'].get('StaticMaterials'));refs={x['ImportedMaterialSlotName']:asset_name(x['MaterialInterface']) for x in materials};pivot=pivot or [0,0,0]
  for mi,source_name in enumerate(d['materials']):
   if include and source_name not in include:continue
   self.add(path.stem+'--'+str(mi),group,pivot,d['vertices'],[t['v'] for t in d['triangles'] if t['material']==mi],refs[source_name],local,source_slot=source_name)
 def save(self,path):
  self.glb.save(path);path.with_suffix('.parts.json').write_text(json.dumps({'parts':self.stats,'bones':self.bones,'materials':self.material_info,'triangles':sum(p['triangles'] for p in self.stats),'bytes':path.stat().st_size},indent=2));print('EXPORTED',path,path.stat().st_size,sum(p['triangles'] for p in self.stats),'triangles')

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('source',type=pathlib.Path);parser.add_argument('config',type=pathlib.Path);parser.add_argument('output',type=pathlib.Path);args=parser.parse_args();cfg=json.loads(args.config.read_text());a=Assembly(args.source,cfg.get('materialOverrides'),cfg.get('slotRoles'));a.skeletal(args.source/cfg['skeletal'],cfg.get('lod',0),cfg.get('authoredDoors'))
 for part in cfg['static']:
  group=part.get('group','Vehicle_Base');a.static(args.source/part['path'],group,a.bones.get(group,[0,0,0]),part.get('local',False),part.get('materials'))
 args.output.parent.mkdir(parents=True,exist_ok=True);a.save(args.output)
