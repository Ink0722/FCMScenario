"""Run project tools with their local environment, keeping npm cross-platform."""
import subprocess
import sys
from python_environment import project_python


def main():
    interpreter = project_python()
    if interpreter is None:
        print('Activate FCMScenario or create a Python 3.12 project .venv, then run: '
              'python -m pip install -r requirements.txt.', file=sys.stderr)
        return 1
    return subprocess.call([str(interpreter), *sys.argv[1:]])


if __name__ == '__main__':
    sys.exit(main())
