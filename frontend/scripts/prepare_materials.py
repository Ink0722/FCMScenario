"""Compatibility entry point. The shared compiler now lives under tools/."""
from pathlib import Path
import sys
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
if __name__ == '__main__':
    from python_environment import use_project_python
    use_project_python()
from prepare_frontend import prepare

if __name__ == '__main__':
    prepare()
