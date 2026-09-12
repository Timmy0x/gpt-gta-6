"""Reacquire exact licensed inputs recorded in source-inputs.json, verifying every hash."""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--destination', type=pathlib.Path, default=pathlib.Path('/tmp/codex-carla-probe'))
args = parser.parse_args()
manifest = json.loads(pathlib.Path('data/vehicles/carla/source-inputs.json').read_text())
base = 'https://bitbucket.org/carla-simulator/carla-content/raw/' + manifest['revision'] + '/'
def acquire(item):
    destination = args.destination / item['target']
    def valid(path):
        return path.exists() and path.stat().st_size == item['bytes'] and hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256']
    if valid(destination):
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + '.download')
    subprocess.run(['curl', '-fLsS', '--retry', '2', base + item['source'], '-o', str(temporary)], check=True)
    if not valid(temporary):
        raise ValueError('Source integrity mismatch: ' + item['source'])
    temporary.replace(destination)
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    list(pool.map(acquire, manifest['files']))
print('Verified', len(manifest['files']), 'source files at', manifest['revision'])
