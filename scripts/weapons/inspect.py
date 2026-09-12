import bpy,json,math
from mathutils import Vector
from pathlib import Path
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in list(bpy.context.scene.objects):
 if o.type in ['CAMERA','LIGHT']: bpy.data.objects.remove(o,do_unlink=True)
pts=[o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo=Vector(tuple(min(p[i] for p in pts)for i in range(3)));hi=Vector(tuple(max(p[i]for p in pts)for i in range(3)));center=(lo+hi)/2
for m in bpy.data.materials:
 color=m.diffuse_color[:];m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=color;p.inputs['Roughness'].default_value=.4;p.inputs['Metallic'].default_value=.7
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=24
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.12,.15,.2,1)
for pos,power,size in [((8,4,12),1700,8),((-7,-4,7),900,6)]:
 light=bpy.data.lights.new('Studio','AREA');light.energy=power;light.shape='DISK';light.size=size;o=bpy.data.objects.new('Studio',light);scene.collection.objects.link(o);o.location=center+Vector(pos);o.rotation_euler=(center-o.location).to_track_quat('-Z','Y').to_euler()
cam=bpy.data.cameras.new('Review');o=bpy.data.objects.new('Review',cam);scene.collection.objects.link(o);scene.camera=o;o.location=center+Vector((15,-7,8));o.rotation_euler=(center-o.location).to_track_quat('-Z','Y').to_euler();cam.type='ORTHO';cam.ortho_scale=max(hi-lo)*1.4
scene.render.resolution_x=1000;scene.render.resolution_y=650;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.filepath='/tmp/weapon-m1911-source.png';bpy.ops.render.render(write_still=True)
print(json.dumps({'bounds':[list(lo),list(hi)],'bones':[{ 'name':b.name,'head':list(b.head_local),'tail':list(b.tail_local)}for a in bpy.data.armatures for b in a.bones],'actions':[{ 'name':a.name,'range':list(a.frame_range)}for a in bpy.data.actions]}))
