"""Choose the activated Conda environment, falling back to the project venv."""
from pathlib import Path
import os
import sys

ROOT = Path(__file__).resolve().parents[1]


def project_python():
    active = os.environ.get('CONDA_PREFIX')
    prefix = Path(active) if active else ROOT / '.venv'
    executable = prefix / ('python.exe' if os.name == 'nt' and active
                           else 'Scripts/python.exe' if os.name == 'nt'
                           else 'bin/python')
    return executable if executable.is_file() else None


def use_project_python():
    executable = project_python()
    prefix = Path(os.environ.get('CONDA_PREFIX') or ROOT / '.venv')
    if executable and Path(sys.prefix).resolve() != prefix.resolve():
        os.execv(str(executable), [str(executable), *sys.argv])
