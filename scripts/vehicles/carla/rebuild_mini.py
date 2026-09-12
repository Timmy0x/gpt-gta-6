"""Recover the Mini paint shell from its original full precision parked mesh.

The skeletal paint shell tears beside the front door. The original parked
MeshDescription retains the intact fender. Its separate authored doors match
exactly, so remove only those surfaces and preserve all non-paint geometry,
material references, wheel anchors and moving-door rigs from the skeletal car.
"""
import argparse
import json
import pathlib
from mesh_description import parse

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=pathlib.Path, default=pathlib.Path('/tmp/codex-carla-probe/mini'))
root = parser.parse_args().root
skeletal = json.loads((root / 'SK_Mini2021-geometry.json').read_text())
parked = parse(root / 'SM_Mini2021Parked.uasset')
door_points = set()
for side in ['L', 'R']:
    door = parse(root / ('SM_Door' + side + '_Mini2021.uasset'))
    translation = next(b for b in skeletal['bones'] if b['name'] == 'Door_' + side)['pose']['Translation']
    offset = [translation[axis] for axis in ['X', 'Y', 'Z']]
    for vertex in door['vertices']:
        # Source units are centimetres; this permits only 0.1 mm roundoff.
        door_points.add(tuple(round(p + d, 2) for p, d in zip(vertex['p'], offset)))

source_lod = skeletal['lods'][0]
paint_slot = skeletal['materials'].index('Bodywork_Mat')
parked_paint_slot = parked['materials'].index('M_Bodywork_Mini2021')
indices, sections, vertex_count, removed = [], [], 0, 0
for source in source_lod['sections']:
    if source['material'] == paint_slot:
        vertices = []
        for triangle in parked['triangles']:
            if triangle['material'] != parked_paint_slot:
                continue
            matches = [tuple(round(p, 2) for p in parked['vertices'][i]['p']) in door_points for i in triangle['v']]
            assert all(matches) or not any(matches), 'Paint triangle crosses the separate door boundary'
            if all(matches):
                removed += 1
                continue
            for index in triangle['v']:
                vertices.append({**parked['vertices'][index], 'bones': [0], 'weights': [255]})
        assert len(vertices) // 3 == source['triangles'], 'Intact paint shell must retain the authored face count'
        section = {**source, 'vertices': vertices, 'boneMap': [0], 'baseIndex': len(indices), 'baseVertex': vertex_count}
        indices.extend(range(vertex_count, vertex_count + len(vertices)))
    else:
        section = {**source, 'baseIndex': len(indices), 'baseVertex': vertex_count}
        indices.extend(index - source['baseVertex'] + vertex_count for index in source_lod['indices'][source['baseIndex']:source['baseIndex'] + source['triangles'] * 3])
    sections.append(section)
    vertex_count += len(section['vertices'])
assert removed == 1512, 'Both original 756-face door paint skins must remain separate'
skeletal['lods'] = [{'level': 0, 'indices': indices, 'vertexCount': vertex_count, 'sections': sections}]
skeletal['repair'] = {'source': 'SM_Mini2021Parked.uasset', 'reason': __doc__, 'removedDoorPaintTriangles': removed}
(root / 'SK_Mini2021-paint-repaired-geometry.json').write_text(json.dumps(skeletal, separators=(',', ':')))
print('Mini paint rebuilt; source doors, cabin and four wheel rigs preserved.')
