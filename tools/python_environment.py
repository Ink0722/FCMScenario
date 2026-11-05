"""Select Python 3.12+ for tools and browser-test processes."""
from pathlib import Path
import os
import shutil
import subprocess
import sys

MINIMUM_VERSION = (3, 12)
INSTALL_HELP = ('Activate Conda FCMScenario and install requirements.txt, or set '
                'FCM_PYTHON to a Python 3.12+ interpreter with those dependencies.')


class PythonEnvironmentError(RuntimeError):
    pass


def _absolute(path):
    # Preserve virtual-environment symlinks: resolving them can select the base environment.
    return Path(os.path.abspath(os.path.expanduser(str(path))))


def _same_executable(left, right):
    return os.path.normcase(str(_absolute(left))) == os.path.normcase(str(_absolute(right)))


def _version(executable):
    if _same_executable(executable, sys.executable):
        return tuple(sys.version_info[:2])
    try:
        result = subprocess.run(
            [str(executable), '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'],
            capture_output=True, text=True, check=True, timeout=5,
        )
        return tuple(int(value) for value in result.stdout.strip().split('.'))
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        raise PythonEnvironmentError('Cannot run the selected Python interpreter. ' + INSTALL_HELP) from error


def project_python():
    override = os.environ.get('FCM_PYTHON', '').strip()
    active = os.environ.get('CONDA_PREFIX', '').strip()
    if override:
        executable = _absolute(shutil.which(override) or override)
    elif active:
        executable = _absolute(Path(active) / ('python.exe' if os.name == 'nt' else 'bin/python'))
    elif sys.version_info >= MINIMUM_VERSION:
        executable = _absolute(sys.executable)
    else:
        return None
    if not executable.is_file():
        raise PythonEnvironmentError('The selected Python interpreter does not exist. ' + INSTALL_HELP)
    version = _version(executable)
    if version < MINIMUM_VERSION:
        raise PythonEnvironmentError('Python 3.12 or newer is required. ' + INSTALL_HELP)
    return executable


def use_project_python():
    try:
        executable = project_python()
    except PythonEnvironmentError as error:
        raise SystemExit(str(error)) from None
    if executable is None:
        raise SystemExit(INSTALL_HELP)
    if not _same_executable(executable, sys.executable):
        os.execv(str(executable), [str(executable), *sys.argv])
