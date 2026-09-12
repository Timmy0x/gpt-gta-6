"""Convert CC0 Tabasco sources to metre-scale native Babylon component assets.
Reads geometry only with source script execution disabled. Original vertex groups
supply mechanical part boundaries; no proprietary source art is used.
"""
import bpy,json,math,hashlib,gzip
from pathlib import Path
from mathutils import Vector
configs=[('m1911','pistol',.219,'y',-1,2.7399,2.1390),('m4','carbine',.82,'x',1,-1.3,.33),('dragunov','sniper',1.15,'y',1,-2.3,.109)]
report=[]
for source,name,length,axis,forward,grip,barrel in configs:
 bpy.ops.wm.open_mainfile(filepath='/tmp/codex-smallarms/'+source+'.blend',load_ui=False,use_scripts=False);bpy.context.scene.frame_set(1)
 objects=[o for o in bpy.context.scene.objects if o.type=='MESH']; points=[o.matrix_world@v.co for o in objects for v in o.data.vertices]
 index=0 if axis=='x'else 1; cross=1 if axis=='x'else 0
 lo=min(p[index]for p in points);hi=max(p[index]for p in points);scale=length/(hi-lo);center=(min(p[cross]for p in points)+max(p[cross]for p in points))/2
 def convert(p):return ((p[cross]-center)*scale,(p.z-barrel)*scale+.065,(p[index]-grip)*scale*forward)
 materials=[];meshes=[]
 for oi,obj in enumerate(objects):
  for mi,slot in enumerate(obj.material_slots):
   color=list(slot.material.diffuse_color)[:3] if slot.material else [.1,.1,.1]
   wood=color[0]>color[1]*1.4 and color[0]>.15
   if wood:color=[.15,.061,.024]
   else:color=[max(.025,min(.42,c*.5))for c in color]
   materials.append({'customType':'BABYLON.PBRMaterial','id':f'{name}-mat-{oi}-{mi}','name':f'{name}/'+('wood'if wood else 'steel'), 'albedo':color,'metallic':0 if wood else .86,'roughness':.58 if wood else .34,'backFaceCulling':True})
  bygroup={}
  for poly in obj.data.polygons:
   totals={}
   for vi in poly.vertices:
    for g in obj.data.vertices[vi].groups:totals[g.group]=totals.get(g.group,0)+g.weight
   group=obj.vertex_groups[max(totals,key=totals.get)].name if totals else 'Frame'
   key=(group,poly.material_index);bygroup.setdefault(key,[]).append(poly)
  for (group,mi),polys in bygroup.items():
   indices=sorted({v for p in polys for v in p.vertices});lookup={v:i for i,v in enumerate(indices)}
   verts=[convert(obj.matrix_world@obj.data.vertices[v].co)for v in indices];faces=[[lookup[v]for v in p.vertices]for p in polys]
   if axis=='y' and forward==1:faces=[list(reversed(face))for face in faces]
   mesh=bpy.data.meshes.new('converted');mesh.from_pydata(verts,[],faces);mesh.update();part=bpy.data.objects.new('converted',mesh);bpy.context.scene.collection.objects.link(part)
   bpy.ops.object.select_all(action='DESELECT');part.select_set(True);bpy.context.view_layer.objects.active=part
   bevel=part.modifiers.new('Machined edge bevel','BEVEL');bevel.width=.0007 if name=='pistol'else .001;bevel.segments=2;bevel.affect='EDGES';bevel.limit_method='ANGLE'
   bpy.ops.object.modifier_apply(modifier=bevel.name)
   mesh=part.data;mesh.calc_loop_triangles();mesh.calc_normals_split()
   positions=[];normals=[];tris=[]
   # Expand loop normals to preserve hard machined edges and smooth bevels.
   for triangle in mesh.loop_triangles:
    for li in triangle.loops:
     loop=mesh.loops[li];positions.extend(mesh.vertices[loop.vertex_index].co);normals.extend(loop.normal);tris.append(len(tris))
   for i in range(0,len(tris),3):tris[i+1],tris[i+2]=tris[i+2],tris[i+1]
   # Weld identical position/normal pairs while retaining the hard-edge splits.
   unique={};remap=[];vp=[];vn=[]
   for i in range(len(positions)//3):
    key=tuple(round(x,7)for x in positions[i*3:i*3+3])+tuple(round(x,6)for x in normals[i*3:i*3+3])
    if key not in unique:unique[key]=len(vp)//3;vp.extend(key[:3]);vn.extend(key[3:])
    remap.append(unique[key])
   positions,normals,tris=vp,vn,[remap[i]for i in tris]
   ident=f'{name}/{group}/{mi}' 
   meshes.append({'name':ident,'id':ident,'position':[0,0,0],'rotation':[0,0,0],'scaling':[1,1,1],'isVisible':True,'isEnabled':True,'isPickable':False,'checkCollisions':False,'billboardMode':0,'receiveShadows':True,'materialId':f'{name}-mat-{oi}-{mi}','positions':positions,'normals':normals,'indices':tris,'subMeshes':[{'materialIndex':0,'verticesStart':0,'verticesCount':len(positions)//3,'indexStart':0,'indexCount':len(tris)}],'metadata':{'weaponVisual':True,'part':group,'licensedSource':'Tabasco CC0'}})
   bpy.data.objects.remove(part,do_unlink=True)
 data={'producer':{'name':'Leonida licensed-weapon converter','version':'1'},'materials':materials,'meshes':meshes,'geometries':{},'skeletons':[],'transformNodes':[]}
 path=Path('public/weapons')/name/'model.babylon.gz';path.parent.mkdir(parents=True,exist_ok=True);raw=json.dumps(data,separators=(',',':')).encode();packed=gzip.compress(raw,mtime=0);path.write_bytes(packed)
 report.append({'id':name,'file':str(path),'source':source,'lengthMetres':length,'triangles':sum(len(m['indices'])//3 for m in meshes),'parts':len(meshes),'bytes':len(packed),'uncompressedBytes':len(raw),'sha256':hashlib.sha256(packed).hexdigest(),'muzzleForwardMetres':max(p for m in meshes for p in m['positions'][2::3])})
Path('data/weapons/tabasco/runtime-manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
