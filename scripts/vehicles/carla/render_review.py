"""CPU-only source inspection; not a substitute for both in-game rendering paths."""
import bpy
import pathlib
from mathutils import Vector

output = pathlib.Path('docs/evidence/road-cars/source-r2')
output.mkdir(parents=True, exist_ok=True)
for source in sorted(pathlib.Path('public/vehicles/carla').glob('*.glb')):
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(source.resolve()))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    points = [o.matrix_world @ Vector(p) for o in meshes for p in o.bound_box]
    lo = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    hi = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    center, size = (lo + hi) / 2, max(hi - lo)
    bpy.ops.mesh.primitive_plane_add(size=size * 200, location=(0, 0, lo.z - .01))
    ground = bpy.context.object
    material = bpy.data.materials.new('Studio')
    material.diffuse_color = (.15, .16, .17, 1)
    ground.data.materials.append(material)
    bpy.ops.object.camera_add(location=center + Vector((1.1, -1.3, .68)) * size)
    camera = bpy.context.object
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.lens = 50
    scene = bpy.context.scene
    scene.camera = camera
    for position, power, radius in [((.5, -.9, 1.5), 1600, 1), ((-.8, .5, 1), 1100, .8)]:
        bpy.ops.object.light_add(type='AREA', location=center + Vector(position) * size)
        light = bpy.context.object
        light.data.energy = power * size * size / 12
        light.data.shape, light.data.size = 'DISK', radius * size
        light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 16
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 960, 640
    scene.render.resolution_percentage = 100
    scene.world.color = (.15, .15, .15)
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = str((output / (source.stem + '.png')).resolve())
    bpy.ops.render.render(write_still=True)
    print('CAR_REVIEW', source.stem, list(lo), list(hi), flush=True)
