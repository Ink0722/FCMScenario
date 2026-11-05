"""Environment changes must preserve explicit selection and process identity."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import python_environment


class EnvironmentSelectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.conda = self.make_environment(self.root / 'conda')
        self.override = self.make_environment(self.root / 'chosen environment')
        clean = patch.dict(os.environ, {}, clear=True)
        clean.start()
        self.addCleanup(clean.stop)
        probe = patch.object(python_environment.subprocess, 'run', return_value=
                             subprocess.CompletedProcess([], 0, '3.12\n', ''))
        self.probe = probe.start()
        self.addCleanup(probe.stop)

    def make_environment(self, prefix):
        executable = prefix / ('python.exe' if os.name == 'nt' else 'bin/python')
        executable.parent.mkdir(parents=True)
        executable.touch()
        return executable

    def test_explicit_interpreter_takes_precedence_over_conda(self):
        with patch.dict(os.environ, {'FCM_PYTHON': str(self.override), 'CONDA_PREFIX': str(self.root / 'conda')}):
            self.assertEqual(python_environment.project_python(), self.override)
        self.assertEqual(self.probe.call_args.args[0][0], str(self.override))

    def test_named_override_is_resolved_from_path(self):
        with patch.dict(os.environ, {'FCM_PYTHON': 'project-python'}), \
                patch.object(python_environment.shutil, 'which', return_value=str(self.override)):
            self.assertEqual(python_environment.project_python(), self.override)

    def test_activated_conda_is_used(self):
        with patch.dict(os.environ, {'CONDA_PREFIX': str(self.root / 'conda')}):
            self.assertEqual(python_environment.project_python(), self.conda)

    def test_invalid_explicit_selection_never_falls_back(self):
        with patch.dict(os.environ, {'FCM_PYTHON': str(self.root / 'missing'), 'CONDA_PREFIX': str(self.root / 'conda')}):
            with self.assertRaisesRegex(python_environment.PythonEnvironmentError, 'does not exist'):
                python_environment.project_python()

    def test_missing_conda_never_falls_back(self):
        with patch.dict(os.environ, {'CONDA_PREFIX': str(self.root / 'missing')}):
            with self.assertRaises(python_environment.PythonEnvironmentError):
                python_environment.project_python()

    def test_current_python_supports_containers_without_conda(self):
        with patch.object(sys, 'version_info', (3, 12, 0)):
            self.assertEqual(python_environment.project_python(), Path(os.path.abspath(sys.executable)))
        self.probe.assert_not_called()

    def test_old_launcher_does_not_search_for_removed_project_environments(self):
        self.make_environment(self.root / '.venv')
        with patch.object(sys, 'version_info', (3, 9, 6)):
            self.assertIsNone(python_environment.project_python())
        self.probe.assert_not_called()

    def test_old_selected_interpreter_is_rejected(self):
        self.probe.return_value.stdout = '3.9\n'
        with patch.dict(os.environ, {'FCM_PYTHON': str(self.override)}):
            with self.assertRaisesRegex(python_environment.PythonEnvironmentError, '3.12'):
                python_environment.project_python()

    def test_unrunnable_interpreter_has_actionable_error(self):
        self.probe.side_effect = OSError('cannot execute')
        with patch.dict(os.environ, {'FCM_PYTHON': str(self.override)}):
            with self.assertRaisesRegex(python_environment.PythonEnvironmentError, 'FCM_PYTHON'):
                python_environment.project_python()

    def test_reexec_preserves_arguments_and_paths_with_spaces(self):
        with patch.dict(os.environ, {'FCM_PYTHON': str(self.override)}), \
                patch.object(sys, 'argv', ['tools/materials.py', '--check']), \
                patch.object(os, 'execv') as execute:
            python_environment.use_project_python()
            execute.assert_called_once_with(str(self.override), [str(self.override), 'tools/materials.py', '--check'])

    def test_running_selected_interpreter_does_not_reexec(self):
        with patch.dict(os.environ, {'FCM_PYTHON': sys.executable}), \
                patch.object(sys, 'version_info', (3, 12, 0)), patch.object(os, 'execv') as execute:
            python_environment.use_project_python()
            execute.assert_not_called()

    def test_virtual_environment_identity_is_not_collapsed_through_symlinks(self):
        alias = self.root / 'alias-python'
        alias.symlink_to(sys.executable)
        with patch.dict(os.environ, {'FCM_PYTHON': str(alias)}), patch.object(os, 'execv') as execute:
            python_environment.use_project_python()
            self.assertEqual(execute.call_args.args[0], str(alias))

    def test_missing_selection_exits_without_running_old_python(self):
        with patch.object(sys, 'version_info', (3, 9, 6)), patch.object(os, 'execv') as execute:
            with self.assertRaisesRegex(SystemExit, 'FCM_PYTHON'):
                python_environment.use_project_python()
            execute.assert_not_called()
