"""Create local PBR texture maps for the two additional pinned civilian models."""
from pathlib import Path
from PIL import Image
root=Path(__file__).resolve().parents[3]
for name,prefix,label in [('Male_Adult_03','m004','male-adult-03'),('Female_Adult_06','f202','female-adult-06')]:
    source=root/'data/characters/civilians/source'/name
    target=root/'public/characters/civilians'/label
    target.mkdir(parents=True,exist_ok=True)
    for part in ['body','head']:
        image=Image.open(source/f'{prefix}_{part}_color.tga').convert('RGB')
        image.thumbnail((2048,2048),Image.Resampling.LANCZOS)
        image.save(target/f'{part}-color.jpg',quality=90,optimize=True)
        normal=Image.open(source/f'{prefix}_{part}_normal.tga').convert('RGB')
        normal.thumbnail((1024,1024),Image.Resampling.LANCZOS)
        normal.save(target/f'{part}-normal.png',optimize=True)
    opacity=Image.open(source/f'{prefix}_opacity_color.tga').convert('RGBA')
    opacity.thumbnail((1024,1024),Image.Resampling.LANCZOS)
    opacity.save(target/'opacity-color.png',optimize=True)
