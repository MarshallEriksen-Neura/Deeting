import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import main


class SkillManagerTests(unittest.TestCase):
    def test_render_shell_command_quotes_windows_paths(self) -> None:
        with mock.patch.object(main.sys, "platform", "win32"):
            rendered = main.render_shell_command(
                ["mklink", "/J", r"C:\Users\Test User\skill-link", r"C:\Users\Test User\skill-source"]
            )

        self.assertIn('"C:\\Users\\Test User\\skill-link"', rendered)
        self.assertIn('"C:\\Users\\Test User\\skill-source"', rendered)

    def test_run_command_uses_shell_execute_when_sdk_available(self) -> None:
        runtime = mock.Mock()
        runtime.call_tool.return_value = {
            "stdout": "find-skills",
            "stderr": "",
            "exit_code": 0,
            "duration_ms": 42,
            "approval_level": "approved",
        }

        with mock.patch.object(main, "deeting", runtime):
            result = main.run_command(["npx", "-y", "skills", "find", "testing"], env={"DEBUG": "1"})

        runtime.call_tool.assert_called_once_with(
            "shell_execute",
            command=main.render_shell_command(["npx", "-y", "skills", "find", "testing"]),
            working_dir=None,
            timeout_seconds=main.COMMAND_TIMEOUT_SECONDS,
            env={"DEBUG": "1"},
        )
        self.assertEqual(result["returncode"], 0)
        self.assertEqual(result["transport"], "shell_execute")
        self.assertEqual(result["stdout"], "find-skills")

    def test_build_add_command_targets_managed_agent(self) -> None:
        command = main.build_add_command(
            "vercel-labs/agent-skills",
            skill_names=["find-skills", "code-review"],
        )

        self.assertEqual(
            command[:8],
            ["npx", "-y", "skills", "add", "vercel-labs/agent-skills", "-g", "-a", main.DEFAULT_SKILLS_AGENT],
        )
        self.assertEqual(command[-4:], ["--skill", "find-skills", "--skill", "code-review"])

    def test_sync_skills_into_deeting_links_requested_skills(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            agent_dir = root / "agent-skills"
            deeting_dir = root / "deeting-skills"
            source = agent_dir / "find-skills"
            source.mkdir(parents=True)
            (source / "SKILL.md").write_text("---\nname: find-skills\ndescription: test\n---\n", encoding="utf-8")

            with mock.patch.object(main, "get_base_dirs", return_value=(root / "repos", deeting_dir, agent_dir)):
                result = main.sync_skills_into_deeting(["find-skills"])

            link_path = deeting_dir / "find-skills"
            self.assertEqual(result["missing"], [])
            self.assertTrue(link_path.exists())
            self.assertTrue(link_path.is_symlink() or link_path.is_dir())
            self.assertEqual(link_path.resolve(), source.resolve())

    def test_parse_skill_names_from_list_output_deduplicates_candidates(self) -> None:
        parsed = main.parse_skill_names_from_list_output(
            "Available skills\n- find-skills\n- code-review\n- find-skills\n"
        )
        self.assertEqual(parsed, ["code-review", "find-skills"])

    def test_normalize_git_clone_source_supports_github_shorthand(self) -> None:
        self.assertEqual(
            main.normalize_git_clone_source("vercel-labs/agent-skills"),
            "https://github.com/vercel-labs/agent-skills.git",
        )

    def test_discover_skill_roots_finds_nested_skill_docs(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            skill_root = root / ".agents" / "skills" / "find-skills"
            skill_root.mkdir(parents=True)
            (skill_root / "SKILL.md").write_text("---\nname: find-skills\n---\n", encoding="utf-8")

            discovered = main.discover_skill_roots(root)

            self.assertEqual(discovered["find-skills"], skill_root)

    def test_add_skill_falls_back_to_git_when_npx_missing(self) -> None:
        async_fallback = mock.AsyncMock(return_value={"status": "success", "install_method": "git_fallback"})

        def which(name: str) -> str | None:
            return "/usr/bin/git" if name == "git" else None

        with mock.patch.object(main.shutil, "which", side_effect=which):
            with mock.patch.object(main, "install_skill_from_git_fallback", async_fallback):
                result = asyncio.run(main.add_skill("vercel-labs/agent-skills", skill_names=["find-skills"]))

        self.assertEqual(result["status"], "success")
        async_fallback.assert_awaited_once()

    def test_add_skill_falls_back_to_git_after_npx_failure(self) -> None:
        async_fallback = mock.AsyncMock(return_value={"status": "success", "install_method": "git_fallback"})

        def which(name: str) -> str | None:
            return f"/usr/bin/{name}" if name in {"git", "node", "npx"} else None

        with mock.patch.object(main.shutil, "which", side_effect=which):
            with mock.patch.object(main, "get_base_dirs", return_value=(Path("/tmp/repos"), Path("/tmp/deeting"), Path("/tmp/agent"))):
                with mock.patch.object(main, "list_agent_skills", return_value={}):
                    with mock.patch.object(
                        main,
                        "run_command",
                        return_value={"command": ["npx"], "returncode": 1, "stdout": "", "stderr": "npx failed"},
                    ):
                        with mock.patch.object(main, "install_skill_from_git_fallback", async_fallback):
                            result = asyncio.run(main.add_skill("vercel-labs/agent-skills", skill_names=["find-skills"]))

        self.assertEqual(result["install_method"], "git_fallback")
        awaited = async_fallback.await_args
        self.assertEqual(awaited.args[0], "vercel-labs/agent-skills")
        self.assertEqual(awaited.kwargs["skill_names"], ["find-skills"])
        self.assertEqual(awaited.kwargs["npx_attempt"]["stage"], "add")


if __name__ == "__main__":
    unittest.main()
