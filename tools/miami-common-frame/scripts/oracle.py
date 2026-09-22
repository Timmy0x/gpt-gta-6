"""Independent official PROJ arithmetic oracle, under the same explicitly provisional policy."""
import json,math,sys,hashlib
from pathlib import Path
from pyproj import Transformer
p=Path(__file__).resolve().parents[1]
grid=Path(sys.argv[1]).resolve()
assert hashlib.sha256(grid.read_bytes()).hexdigest()=='fa9a407ac7ee3f5a3694008e4bcd09ce9cc250452f0c3b11700a4960340abce2'
vertical=Transformer.from_pipeline(f'+proj=pipeline +step +proj=unitconvert +xy_in=deg +xy_out=rad +step +proj=vgridshift +grids={grid} +multiplier=1 +step +proj=unitconvert +xy_in=rad +xy_out=deg')
local=Transformer.from_pipeline('+proj=pipeline +step +proj=unitconvert +xy_in=deg +xy_out=rad +step +proj=cart +ellps=WGS84 +step +proj=topocentric +ellps=WGS84 +lat_0=25.7662 +lon_0=-80.1907 +h_0=0')
data=json.loads((p/'output/coordinates.json').read_text());rows=[];maxerror=0
for sample in data['numericalSamples']:
    lon,lat,H=sample['longitude'],sample['latitude'],sample['navd88M']
    _,_,h=vertical.transform(lon,lat,H,errcheck=True)
    east,north,up=local.transform(lon,lat,h,errcheck=True)
    expected=[east,up,north]
    error=math.dist(expected,sample['local']);maxerror=max(maxerror,error)
    assert error<1e-6,(sample['id'],error)
    rows.append({**sample,'independentProjLocal':expected,'independentGeoidM':h-H,'errorM':error})
out={'scope':'Mathematical agreement under provisional numeric-coordinate GEOID18 policy; not a datum-realization or surface-correspondence validation','samples':rows,'maximumProjectionErrorM':maxerror}
(p/'data/proj-oracle.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({'samples':len(rows),'maximumProjectionErrorM':maxerror}))
