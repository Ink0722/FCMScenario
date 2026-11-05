"""Run a script or module with the shared project Python selection."""
import subprocess
import sys
from python_environment import INSTALL_HELP, PythonEnvironmentError, project_python


def main():
    try:
        interpreter = project_python()
    except PythonEnvironmentError as error:
        print(str(error), file=sys.stderr)
        return 1
    if interpreter is None:
        print(INSTALL_HELP, file=sys.stderr)
        return 1
    return subprocess.call([str(interpreter), *sys.argv[1:]])


if __name__ == '__main__':
    sys.exit(main())
