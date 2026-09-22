"""Compatibility entry point; supply the original public source folder explicitly."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name("prepare-buildings.py")), run_name="__main__")
