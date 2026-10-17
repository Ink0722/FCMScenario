"""Compatibility entry point. The shared compiler now lives under tools/."""
from pathlib import Path
import os, sys
ROOT = Path(__file__).resolve().parents[2]
if __name__ == '__main__':
    local = ROOT / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if local.is_file() and Path(sys.prefix).resolve() != (ROOT / '.venv').resolve():
        os.execv(str(local), [str(local), *sys.argv])
sys.path.insert(0, str(ROOT / 'tools'))
from prepare_frontend import prepare

if __name__ == '__main__':
    prepare()
