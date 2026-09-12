import itertools,json
from pathlib import Path
import numpy as np

p=Path(__file__).parent
rows=json.loads((p/'numerical-samples.json').read_text())
maximum_excess=0.0
maximum_inside=0.0
outside_count=0
for row in rows:
    c=np.array(row['center'],dtype=np.float64)
    a=np.array(row['edges'],dtype=np.float64).T
    for sample in row['points']:
        measured=sample['distance']
        assert np.isfinite(measured)
        if sample['inside']:
            maximum_inside=max(maximum_inside,measured)
            assert measured<1e-7,(row['id'],sample)
            continue
        # Exact convex box quadratic: each optimum has some coordinates fixed on
        # a -1/+1 face and the remaining free coordinates solve least squares.
        q=np.array(sample['point'],dtype=np.float64)-c
        best=float('inf')
        for state in itertools.product((-1,0,1),repeat=3):
            fixed=np.array(state,dtype=np.float64)
            free=[i for i,s in enumerate(state) if s==0]
            if free:
                weights=np.linalg.lstsq(a[:,free],q-a@fixed,rcond=1e-17)[0]
                if np.any(np.abs(weights)>1+1e-8):continue
                fixed[free]=np.clip(weights,-1,1)
            best=min(best,float(np.linalg.norm(q-a@fixed)))
        excess=measured-best
        maximum_excess=max(maximum_excess,excess)
        assert excess<1e-6,(row['id'],measured,best)
        outside_count+=1
result={'scope':'Original independent samples, NumPy active-set closest-point oracle; no graphics/provider data.',
 'cases':len(rows),'points':sum(len(r['points']) for r in rows),'outsideOracleChecks':outside_count,
 'maxInsideDistanceM':maximum_inside,'maxConservativeDistanceExcessM':maximum_excess,
 'tolerancesM':{'inside':1e-7,'outsideNumericalExcess':1e-6},'passed':True}
(p/'result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
