"""Acquire the original police Charger fittings from the pinned licensed source."""
import concurrent.futures
import hashlib
import json
import pathlib
import subprocess

commit = '2ff5d92bd388ed4171df637cb44c2c9f5ee9b4ed'
root = pathlib.Path('/tmp/codex-carla-probe/roster/DodgeCharger2020')
source = json.loads(pathlib.Path('data/vehicles/carla/DodgeCharger2020.json').read_text())
items = [x for x in source['values'] if '/ChargerCop/' in x['path'] and x.get('size') and not any(name in x['path'] for name in ['AnimBP_', 'Phys_', 'Skeleton', '/SMC_', 'Parked'])]
def acquire(item):
    relative = item['path'].split('/DodgeCharger2020/', 1)[1]
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.stat().st_size != item['size']:
        subprocess.run(['curl', '-fLsS', '--retry', '2', 'https://bitbucket.org/carla-simulator/carla-content/raw/' + commit + '/' + item['path'], '-o', str(path)], check=True)
    assert path.stat().st_size == item['size']
    return {'source': item['path'], 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    result = list(pool.map(acquire, items))
pathlib.Path('data/vehicles/carla/police-acquisition.json').write_text(json.dumps(result, indent=2))
print('POLICE_SOURCE', len(result), sum(x['bytes'] for x in result))
