"""Public source coverage diagram; no imagery, approximate building boxes or game-view claim."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
import json,math
repo=Path(__file__).resolve().parents[3];base=repo/'data/world/miami';root=base/'expansions/downtown-edge-r5'
load=lambda p:json.loads(p.read_text())
old=load(base/'manifest.json')['bboxWgs84'];new=load(root/'manifest.json')['bboxWgs84'];extent=[old[0]-.0004,old[1]-.0004,old[2]+.0004,new[3]+.0004]
width,height=1100,1560;image=Image.new('RGB',(width,height),'#101c26');draw=ImageDraw.Draw(image)
padding=65;top=160;bottom=135
scale=min((width-2*padding)/((extent[2]-extent[0])*math.cos(math.radians(25.77))),(height-top-bottom)/(extent[3]-extent[1]))
def at(p):return(padding+(p[0]-extent[0])*scale*math.cos(math.radians(25.77)),top+(extent[3]-p[1])*scale)
def polygon(coords,fill,outline=None):
 for n,ring in enumerate(coords):draw.polygon([at(p) for p in ring],fill=fill if n==0 else '#182a34',outline=outline)
def full_box(b):return[at([b[0],b[3]]),at([b[2],b[1]])]
draw.rectangle(full_box(old),fill='#182a34');draw.rectangle(full_box(new),fill='#203b38')
features={}
for folder in [base,root]:
 for name in ['city-water','county-buildings','city-streets']:
  for f in load(folder/'raw'/f'{name}.geojson')['features']:
   field='OBJECTID' if name=='county-buildings' else 'FID';features[(name,f['properties'][field])]=f
for (name,_),f in features.items():
 if name=='city-water':
  g=f['geometry'];polys=[g['coordinates']] if g['type']=='Polygon' else g['coordinates']
  for p in polys:polygon(p,'#236488')
for (name,_),f in features.items():
 if name=='county-buildings':
  g=f['geometry'];polys=[g['coordinates']] if g['type']=='Polygon' else g['coordinates']
  for p in polys:polygon(p,'#b8c6c9','#74888d')
for (name,_),f in features.items():
 if name=='city-streets':
  g=f['geometry'];lines=[g['coordinates']] if g['type']=='LineString' else g['coordinates']
  for line in lines:draw.line([at(p) for p in line],fill='#d4c88d',width=2)
draw.rectangle(full_box(old),outline='#50a7de',width=4);draw.rectangle(full_box(new),outline='#56d6a7',width=5)
def font(size):
 try:return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',size)
 except OSError:return ImageFont.load_default()
draw.rectangle((0,0,width,top-15),fill='#101c26')
draw.text((padding,34),'BRICKELL → DOWNTOWN',font=font(35),fill='#f0f5f5')
draw.text((padding,83),'Official source preparation · 29 September 2026',font=font(21),fill='#a8bfc9')
draw.text((padding,116),'Source geometry diagram — not a game render',font=font(18),fill='#a8bfc9')
draw.text((full_box(new)[0][0]+15,full_box(new)[0][1]+16),'NEW: 600 × 540 terrain samples',font=font(19),fill='#bdf4df')
draw.text((full_box(new)[0][0]+15,full_box(new)[0][1]+43),'38 original 3D features · 89 street records',font=font(17),fill='#bdf4df')
draw.text((full_box(old)[0][0]+15,full_box(old)[1][1]-48),'Accepted Brickell source extent',font=font(19),fill='#96d5ff')
draw.rectangle((0,height-bottom,width,height),fill='#101c26')
draw.text((padding,height-bottom+24),'City street / water geometry · County footprint polygons',font=font(20),fill='#d0dee4')
draw.text((padding,height-bottom+58),'County 3D: 2015 · USGS terrain: 1m D23 / NAVD88',font=font(18),fill='#a8bfc9')
draw.text((padding,height-bottom+86),'Current building completeness, bridge decks and datum parity remain unresolved.',font=font(17),fill='#a8bfc9')
image.save(root/'prepared/source-coverage.png')
print(root/'prepared/source-coverage.png')
