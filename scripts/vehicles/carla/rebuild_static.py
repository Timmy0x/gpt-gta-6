"""Recover original static topology with explicit material slots and rigid wheel ownership.

The MPV static and skeletal sources have different lateral/longitudinal offsets;
nearest-vertex matching cannot transfer its rig. Its two authored wheel material
slots contain exactly four disconnected wheels, which are partitioned at the
vehicle centre planes and given measured axle centres. Jeep retains matched rig
anchors because its full precision static and skeletal source positions agree.
"""
import collections
import json
import pathlib
from mesh_description import parse

ROOT = pathlib.Path('/tmp/codex-carla-probe/roster')
for model, name, skeleton in [
    ('BmwGranTourer', 'SM_BMWGrandTourer', 'SK_BMW_Gran_Tourer'),
    ('Jeep', 'SM_JeepWranglerRubicon', 'SK_Jeep_Wrangler_Rubicon'),
]:
    root = ROOT / model
    sk = json.loads((root / (skeleton + '-geometry.json')).read_text())
    md = parse(root / (name + '.uasset'))
    meta = next(x for x in json.loads((root / (name + '.metadata.json')).read_text()) if x['Type'] == 'StaticMesh')
    mats = meta.get('StaticMaterials', meta['Properties'].get('StaticMaterials'))
    by_slot = {m['ImportedMaterialSlotName']: m for m in mats}
    # Older Jeep source uses ordered MaterialSlot_N polygon groups; BMW uses names.
    ordered = [by_slot[slot] if slot in by_slot else mats[int(slot.removeprefix('MaterialSlot_'))] for slot in md['materials']]
    mapping = collections.defaultdict(collections.Counter)
    for section in sk['lods'][0]['sections']:
        for v in section['vertices']:
            mapping[tuple(round(x, 1) for x in v['p'])][section['boneMap'][v['bones'][0]]] += 1
    wheel_points = collections.defaultdict(list)
    wheel_slots = {'Vh_Car_BmwGranTourer_CoverWheelMat', 'Vh_Car_BmwGranTourer_TyreMat'}
    def wheel_bone(point):
        name = 'Wheel_' + ('Front_' if point[0] > 0 else 'Rear_') + ('Left' if point[1] < 0 else 'Right')
        return next(i for i, b in enumerate(sk['bones']) if b['name'] == name)
    vertices, indices, sections = [], [], []
    stats = collections.Counter()
    for mi, slot in enumerate(md['materials']):
        sv, base, start = [], len(vertices), len(indices)
        for t in md['triangles']:
            if t['material'] != mi:
                continue
            points = [md['vertices'][i]['p'] for i in t['v']]
            if model == 'BmwGranTourer' and slot in wheel_slots:
                bones = {wheel_bone(p) for p in points}
                assert len(bones) == 1, 'Wheel face crosses vehicle centre'
                bone = bones.pop()
                if slot.endswith('_TyreMat'):
                    wheel_points[bone].extend(points)
            else:
                candidates = [mapping[tuple(round(x, 1) for x in p)].most_common(1) for p in points]
                votes = collections.Counter(c[0][0] for c in candidates if c)
                bone = votes.most_common(1)[0][0] if votes else 0
            stats['bone' + str(bone)] += 1
            for i in t['v']:
                sv.append({**md['vertices'][i], 'bones': [bone], 'weights': [255]})
                indices.append(base + len(sv) - 1)
        vertices += sv
        sections.append({'material': mi, 'baseIndex': start, 'triangles': len(sv) // 3, 'baseVertex': base, 'boneMap': list(range(len(sk['bones']))), 'vertices': sv})
    for bone, points in wheel_points.items():
        centre = [(min(p[i] for p in points) + max(p[i] for p in points)) / 2 for i in range(3)]
        sk['bones'][bone]['pose']['Translation'] = dict(zip(['X', 'Y', 'Z'], centre))
    assert all(stats['bone' + str(i)] > 100 for i, b in enumerate(sk['bones']) if b['name'].startswith('Wheel_'))
    sk['materials'] = [m['ImportedMaterialSlotName'] for m in ordered]
    sk['materialRefs'] = [m['MaterialInterface'] for m in ordered]
    sk['lods'] = [{'level': 0, 'indices': indices, 'vertexCount': len(vertices), 'sections': sections}]
    sk['repair'] = {'source': name + '.uasset', 'reason': __doc__, 'counts': dict(stats)}
    (root / (name + '-repaired-geometry.json')).write_text(json.dumps(sk, separators=(',', ':')))
    print(model, dict(stats))
