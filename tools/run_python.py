"""Run project tools with their local environment, keeping npm cross-platform."""
from pathlib import Path
import os
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    interpreter = ROOT / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    if not interpreter.is_file():
        print('Set up content tools first: python3 -m venv .venv; '
              '.venv/bin/python -m pip install -r requirements-tools.txt', file=sys.stderr)
        return 1
    return subprocess.call([str(interpreter), *sys.argv[1:]])


if __name__ == '__main__':
    sys.exit(main())
