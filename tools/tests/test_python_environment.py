"""The npm and legacy entry points must honor an activated environment."""
from pathlib import Path
import os
import tempfile
import unittest
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import python_environment


class EnvironmentSelectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.venv = self.make_environment(self.root / '.venv')
        self.conda = self.make_environment(self.root / 'conda')
        self.root_patch = patch.object(python_environment, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)

    def make_environment(self, prefix):
        relative = 'python.exe' if os.name == 'nt' and prefix.name == 'conda' else (
            'Scripts/python.exe' if os.name == 'nt' else 'bin/python')
        executable = prefix / relative
        executable.parent.mkdir(parents=True)
        executable.touch()
        return executable

    def test_active_conda_takes_precedence_over_existing_venv(self):
        with patch.dict(os.environ, {'CONDA_PREFIX': str(self.root / 'conda')}):
            self.assertEqual(python_environment.project_python(), self.conda)

    def test_falls_back_to_project_venv(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(python_environment.project_python(), self.venv)

    def test_missing_active_environment_does_not_silently_use_another(self):
        with patch.dict(os.environ, {'CONDA_PREFIX': str(self.root / 'missing')}):
            self.assertIsNone(python_environment.project_python())

    def test_reexec_checks_environment_prefix_and_keeps_cli_arguments(self):
        with patch.dict(os.environ, {}, clear=True), \
                patch.object(sys, 'prefix', str(self.root / 'system')), \
                patch.object(sys, 'argv', ['tools/materials.py', '--check']), \
                patch.object(os, 'execv') as execute:
            python_environment.use_project_python()
            execute.assert_called_once_with(str(self.venv), [str(self.venv), 'tools/materials.py', '--check'])

    def test_running_in_selected_environment_does_not_reexec(self):
        with patch.dict(os.environ, {'CONDA_PREFIX': str(self.root / 'conda')}), \
                patch.object(sys, 'prefix', str(self.root / 'conda')), \
                patch.object(os, 'execv') as execute:
            python_environment.use_project_python()
            execute.assert_not_called()
