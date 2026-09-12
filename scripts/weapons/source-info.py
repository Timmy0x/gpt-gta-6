import bpy,json
from pathlib import Path
from mathutils import Vector
results=[]
for name in ['m1911','m4','dragunov']:
 bpy.ops.wm.open_mainfile(filepath='/tmp/codex-smallarms/'+name+'.blend',load_ui=False,use_scripts=False)
 bpy.context.scene.frame_set(1)
 meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'];pts=[o.matrix_world @ Vector(c)for o in meshes for c in o.bound_box]
 results.append({'name':name,'bounds':[[min(p[i]for p in pts)for i in range(3)],[max(p[i]for p in pts)for i in range(3)]],'objects':[{'name':o.name,'vertices':len(o.data.vertices),'materials':[s.material.name if s.material else ''for s in o.material_slots],'groups':[g.name for g in o.vertex_groups]}for o in meshes],'bones':[{'name':b.name,'head':list(o.matrix_world @ b.head_local),'tail':list(o.matrix_world @ b.tail_local)}for o in bpy.context.scene.objects if o.type=='ARMATURE'for b in o.data.bones],'actions':[{'name':a.name,'range':list(a.frame_range)}for a in bpy.data.actions]})
Path('data/weapons/tabasco/source-info.json').write_text(json.dumps(results,indent=2))
print(json.dumps(results))
