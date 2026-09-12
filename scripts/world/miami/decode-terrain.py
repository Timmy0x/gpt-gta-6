"""Export the retained USGS bare-earth Float32 GeoTIFF without changing elevations."""
import array, hashlib, json, math, pathlib, sys
from PIL import Image

root = pathlib.Path(__file__).resolve().parents[3] / 'data/world/miami/terrain'
source = root / 'brickell-dem.tif'
metadata = json.loads((root / 'manifest.json').read_text())
image = Image.open(source)
assert image.mode == 'F' and image.size == (metadata['width'], metadata['height'])
scale = image.tag_v2[33550]
tie = image.tag_v2[33922]
assert tie[:3] == (0, 0, 0) and scale[0] > 0 and scale[1] > 0
no_data = float(image.tag_v2[42113])
values = array.array('f', image.get_flattened_data() if hasattr(image, 'get_flattened_data') else image.getdata())
assert len(values) == image.width * image.height
fallback = Image.open(root / 'brickell-fallback-dem.tif')
assert fallback.mode == 'F' and fallback.size == image.size and fallback.tag_v2[33550] == scale and fallback.tag_v2[33922] == tie
fallback_values = array.array('f', fallback.get_flattened_data() if hasattr(fallback, 'get_flattened_data') else fallback.getdata())
mask = bytearray(len(values))
for index, value in enumerate(values):
    if not math.isfinite(value) or value == no_data:
        values[index] = fallback_values[index]
        mask[index] = 1
(root / 'source-mask.u8').write_bytes(mask)
if sys.byteorder != 'little': values.byteswap()
binary = values.tobytes()
(root / 'heights.f32').write_bytes(binary)
valid = [value for value in values if math.isfinite(value) and value != no_data]
assert len(valid) == len(values), 'Unexpected no-data holes; do not silently fill elevations'
data = {
    'version': 1, 'id': metadata['id'], 'source': metadata['source'],
    'width': image.width, 'height': image.height, 'binary': 'heights.f32',
    'componentType': 'float32', 'byteOrder': 'little-endian',
    'rowOrder': 'north-to-south', 'columnOrder': 'west-to-east',
    'pixelCenterLongitude': tie[3] + scale[0] / 2,
    'pixelCenterLatitude': tie[4] - scale[1] / 2,
    'longitudeStep': scale[0], 'latitudeStep': -scale[1],
    'extentWgs84': metadata['extent'], 'verticalDatum': metadata['verticalDatum'],
    'units': 'meters', 'confidence': 'mapped',
    'sourceResolutionM': 1, 'resampling': 'bilinear to WGS84 0.00001-degree grid',
    'minM': min(valid), 'maxM': max(valid), 'noData': no_data, 'validPixels': len(valid),
    'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'sourceMask': 'source-mask.u8', 'sourceMaskSha256': hashlib.sha256(mask).hexdigest(),
    'sourceMaskValues': {'0': 'Miami-Dade D23 one-meter sources', '1': 'Older coastal NAVD88 source mosaic, fallbackRasters in terrain/manifest.json'},
    'fallbackPixels': mask.count(1),
    'sha256': hashlib.sha256(binary).hexdigest(), 'byteLength': len(binary),
    'gaps': ['Bare-earth DEM is not a bridge-deck/curb-height survey; elevated roads need their own profile.',
             'Water and shore elevations need water masks and tide treatment.',
             '2015 building mesh floors and D23 terrain may differ; inspect facade/ground joins.'],
}
(root / 'grid.json').write_text(json.dumps(data, indent=2) + '\n')
print(json.dumps(data, indent=2))
