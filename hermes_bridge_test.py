import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

from hermes_bridge import (
    apply_runtime_reasoning_to_api_kwargs,
    append_reasoning_delta_preview,
    build_write_review_request,
    build_write_trace_events,
    build_usage_summary,
    compact_preview,
    extract_new_reasoning_delta,
    format_tool_status,
    install_write_review_handlers,
    append_reasoning_activity_preview,
    should_display_reasoning_delta,
    looks_like_internal_reasoning_text,
    pick_bridge_final_text,
    preprocess_bridge_images,
    should_emit_reasoning_activity,
    summarize_tool_args,
)


class HermesBridgeHelpersTest(unittest.TestCase):
    def test_format_tool_status_names_real_tool_activity(self):
        self.assertEqual(format_tool_status("thinking", "running"), "正在思考")
        self.assertEqual(format_tool_status("thinking", "done"), "已完成思考")
        self.assertEqual(format_tool_status("skill_view", "running"), "正在读取 skill")
        self.assertEqual(format_tool_status("skill_view", "done"), "已读取 skill")
        self.assertEqual(format_tool_status("vision_analyze", "running"), "正在调用 vision_analyze")
        self.assertEqual(format_tool_status("vision_analyze", "done"), "已完成 vision_analyze")
        self.assertEqual(format_tool_status("vision_analyze", "error"), "vision_analyze 调用失败")

    def test_reasoning_available_is_not_rendered_as_thinking_activity(self):
        self.assertTrue(should_emit_reasoning_activity("_thinking", "真实思考片段"))
        self.assertFalse(should_emit_reasoning_activity("reasoning.available", "最终回复正文"))
        self.assertFalse(should_emit_reasoning_activity("_thinking", "  "))

    def test_reasoning_delta_accumulates_into_one_preview(self):
        buffer = []
        self.assertEqual(append_reasoning_delta_preview(buffer, "让我"), "让我")
        self.assertEqual(append_reasoning_delta_preview(buffer, "先搜"), "让我先搜")

    def test_reasoning_delta_deduplicates_cumulative_snapshots(self):
        previous = ""
        delta, previous, replace = extract_new_reasoning_delta(previous, "让我先搜")
        self.assertEqual(delta, "让我先搜")
        self.assertFalse(replace)

        delta, previous, replace = extract_new_reasoning_delta(previous, "让我先搜索一下")
        self.assertEqual(delta, "索一下")
        self.assertFalse(replace)

        delta, previous, replace = extract_new_reasoning_delta(previous, "让我先搜索一下")
        self.assertEqual(delta, "")
        self.assertEqual(previous, "让我先搜索一下")
        self.assertFalse(replace)

    def test_reasoning_activity_preview_appends_only_new_delta(self):
        buffer = []
        preview, previous = append_reasoning_activity_preview(buffer, "", "让我先搜索一下")
        self.assertEqual(preview, "让我先搜索一下")
        self.assertEqual(previous, "让我先搜索一下")

        preview, previous = append_reasoning_activity_preview(buffer, previous, "让我先搜索一下网关实现")
        self.assertEqual(preview, "让我先搜索一下网关实现")
        self.assertEqual(previous, "让我先搜索一下网关实现")
        self.assertEqual("".join(buffer), "让我先搜索一下网关实现")
        self.assertEqual(preview.count("让我先搜索一下"), 1)

    def test_reasoning_activity_preview_replaces_rewritten_snapshot(self):
        buffer = []
        preview, previous = append_reasoning_activity_preview(buffer, "", "我先检查旧路径，然后写入。")
        self.assertEqual(preview, "我先检查旧路径，然后写入。")
        preview, previous = append_reasoning_activity_preview(buffer, previous, "重新梳理：我先检查新路径，然后写入。")

        self.assertEqual(preview, "重新梳理：我先检查新路径，然后写入。")
        self.assertEqual(previous, "重新梳理：我先检查新路径，然后写入。")
        self.assertEqual("".join(buffer), "重新梳理：我先检查新路径，然后写入。")

    def test_reasoning_delta_deduplicates_overlapping_snapshots(self):
        delta, previous, replace = extract_new_reasoning_delta("让我先搜索一下", "搜索一下网关实现")
        self.assertEqual(delta, "网关实现")
        self.assertEqual(previous, "让我先搜索一下网关实现")
        self.assertFalse(replace)

    def test_reasoning_delta_filters_tool_step_fragments(self):
        self.assertFalse(should_display_reasoning_delta("正在调用 search_files"))
        self.assertFalse(should_display_reasoning_delta("tool.started search_files"))
        self.assertFalse(should_display_reasoning_delta("search_files"))
        self.assertFalse(should_display_reasoning_delta("?"))
        self.assertTrue(should_display_reasoning_delta("我需要先判断用户真正想要的是哪一层界面结构。"))

    def test_xiaomi_runtime_gets_explicit_reasoning_effort(self):
        kwargs = {"model": "mimo-v2.5", "messages": [], "reasoning_effort": "medium"}
        apply_runtime_reasoning_to_api_kwargs(
            kwargs,
            provider="xiaomi",
            base_url="https://api.xiaomimimo.com/v1",
            reasoning_config={"enabled": True, "effort": "xhigh"},
        )
        self.assertEqual(kwargs["reasoning_effort"], "xhigh")

    def test_xiaomi_runtime_can_disable_reasoning(self):
        kwargs = {"model": "mimo-v2.5", "messages": []}
        apply_runtime_reasoning_to_api_kwargs(
            kwargs,
            provider="xiaomi",
            base_url="https://api.xiaomimimo.com/v1",
            reasoning_config={"enabled": False},
        )
        self.assertEqual(kwargs["reasoning_effort"], "none")

    def test_deepseek_runtime_gets_thinking_effort(self):
        kwargs = {"model": "deepseek-v4-pro", "messages": []}
        apply_runtime_reasoning_to_api_kwargs(
            kwargs,
            provider="deepseek",
            base_url="https://api.deepseek.com/v1",
            reasoning_config={"enabled": True, "effort": "xhigh"},
        )
        self.assertEqual(kwargs["reasoning_effort"], "max")
        self.assertEqual(kwargs["extra_body"]["thinking"], {"type": "enabled"})

    def test_deepseek_runtime_maps_lower_efforts_to_high(self):
        for effort in ("minimal", "low", "medium", "high"):
            with self.subTest(effort=effort):
                kwargs = {"model": "deepseek-v4-flash", "messages": []}
                apply_runtime_reasoning_to_api_kwargs(
                    kwargs,
                    provider="deepseek",
                    base_url="https://api.deepseek.com/v1",
                    reasoning_config={"enabled": True, "effort": effort},
                )
                self.assertEqual(kwargs["reasoning_effort"], "high")
                self.assertEqual(kwargs["extra_body"]["thinking"], {"type": "enabled"})

    def test_deepseek_runtime_can_disable_thinking(self):
        kwargs = {"model": "deepseek-v4-pro", "messages": [], "reasoning_effort": "max"}
        apply_runtime_reasoning_to_api_kwargs(
            kwargs,
            provider="deepseek",
            base_url="https://api.deepseek.com/v1",
            reasoning_config={"enabled": False},
        )
        self.assertNotIn("reasoning_effort", kwargs)
        self.assertEqual(kwargs["extra_body"]["thinking"], {"type": "disabled"})

    def test_summarize_tool_args_prefers_specific_context(self):
        self.assertEqual(
            summarize_tool_args("skill_view", {"name": "obsidian-cli"}, ""),
            "skill=obsidian-cli",
        )
        self.assertEqual(
            summarize_tool_args("patch", {"mode": "replace", "path": "notes/demo.md"}, ""),
            "准备修改 notes/demo.md",
        )
        self.assertEqual(
            summarize_tool_args("write_file", {"path": "notes/demo.md"}, ""),
            "准备写入 notes/demo.md",
        )
        self.assertEqual(
            summarize_tool_args("obsidian_search", {"query": "wiki 双链", "path": "notes"}, ""),
            "query=wiki 双链",
        )
        self.assertEqual(
            compact_preview("第一行\n\n第二行   第三行", max_length=20),
            "第一行 第二行 第三行",
        )

    def test_pick_bridge_final_text_prefers_final_then_stream_then_previews(self):
        self.assertEqual(
            pick_bridge_final_text(
                final_text="最终答案",
                streamed_text="流式内容",
                progress_texts=["进度"],
                reasoning_previews=["预览"],
                message_contents=["消息"],
            ),
            "最终答案",
        )

        self.assertEqual(
            pick_bridge_final_text(
                final_text="",
                streamed_text="流式内容",
                progress_texts=["进度"],
                reasoning_previews=["预览"],
                message_contents=["消息"],
            ),
            "流式内容",
        )

        self.assertEqual(
            pick_bridge_final_text(
                final_text="",
                streamed_text="",
                progress_texts=["先看看"],
                reasoning_previews=["更完整的预览"],
                message_contents=["消息"],
            ),
            "先看看",
        )

        self.assertEqual(
            pick_bridge_final_text(
                final_text="",
                streamed_text="",
                progress_texts=[],
                reasoning_previews=[],
                message_contents=["", "最后一条消息"],
            ),
            "最后一条消息",
        )

        self.assertEqual(
            pick_bridge_final_text(
                final_text="",
                streamed_text="",
                progress_texts=[],
                reasoning_previews=["让我重新梳理一下执行路径"],
                message_contents=["让我重新梳理一下执行路径", "最终整理后的正文"],
            ),
            "最终整理后的正文",
        )

        leaked_reasoning = "\n".join(
            [
                "让我先整理一下这段修改计划。",
                "接下来我会先用 read_file 检查正文。",
                "然后我会用 patch 写入更新。",
            ]
        )
        self.assertTrue(looks_like_internal_reasoning_text(leaked_reasoning))
        self.assertEqual(
            pick_bridge_final_text(
                final_text="",
                streamed_text="",
                progress_texts=[],
                reasoning_previews=[],
                message_contents=[leaked_reasoning, "最终整理后的正文"],
            ),
            "最终整理后的正文",
        )

    def test_build_usage_summary_reports_cache_ratio(self):
        self.assertEqual(
            build_usage_summary({
                "api_calls": 3,
                "input_tokens": 10000,
                "last_prompt_tokens": 20813,
                "context_length": 1000000,
                "cache_read_tokens": 7600,
                "cache_write_tokens": 500,
            }),
            {
                "apiCalls": 3,
                "inputTokens": 10000,
                "lastPromptTokens": 20813,
                "contextLength": 1000000,
                "contextPercent": 2,
                "cacheReadTokens": 7600,
                "cacheWriteTokens": 500,
                "cacheHitRate": 76,
            },
        )

        self.assertEqual(
            build_usage_summary({
                "api_calls": 1,
                "input_tokens": 0,
                "last_prompt_tokens": 0,
                "context_length": 0,
                "cache_read_tokens": 0,
            }),
            {
                "apiCalls": 1,
                "inputTokens": 0,
                "lastPromptTokens": 0,
                "contextLength": None,
                "contextPercent": None,
                "cacheReadTokens": 0,
                "cacheWriteTokens": 0,
                "cacheHitRate": None,
            },
        )

    def test_build_write_review_request_for_write_file_returns_unified_diff(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "note.md"
            path.write_text("旧标题\n第二行\n", encoding="utf-8")

            review = build_write_review_request(
                "write_file",
                {
                    "path": str(path),
                    "content": "新标题\n第二行\n"
                },
            )

            self.assertIsNotNone(review)
            self.assertEqual(review["toolName"], "write_file")
            self.assertEqual(review["filePath"], str(path))
            self.assertIn("--- a/", review["diff"])
            self.assertIn("+++ b/", review["diff"])
            self.assertIn("-旧标题", review["diff"])
            self.assertIn("+新标题", review["diff"])

    def test_build_write_review_request_for_patch_replace_returns_unified_diff(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "note.md"
            path.write_text("第一段\n旧句子\n尾声\n", encoding="utf-8")

            review = build_write_review_request(
                "patch",
                {
                    "mode": "replace",
                    "path": str(path),
                    "old_string": "旧句子",
                    "new_string": "新句子"
                },
            )

            self.assertIsNotNone(review)
            self.assertEqual(review["toolName"], "patch")
            self.assertEqual(review["filePath"], str(path))
            self.assertIn("-旧句子", review["diff"])
            self.assertIn("+新句子", review["diff"])

    def test_build_write_trace_events_streams_patch_preview_before_review(self):
        review = {
            "toolName": "patch",
            "filePath": "/vault/note.md",
            "meta": "patch · 1 file · -1 +2",
            "diff": "--- a/note.md\n+++ b/note.md\n@@ -1 +1,2 @@\n-旧句子\n+## 新标题\n+新句子\n",
        }

        events = build_write_trace_events(review, phase="preview")

        self.assertGreaterEqual(len(events), 2)
        self.assertEqual(events[0]["type"], "write_trace")
        self.assertEqual(events[0]["status"], "running")
        self.assertEqual(events[0]["toolName"], "write_trace")
        self.assertIn("生成修改预览", events[0]["text"])
        self.assertIn("note.md", events[0]["preview"])
        self.assertTrue(any("## 新标题" in event["preview"] for event in events))

    def test_build_write_review_request_for_v4a_patch_returns_combined_diff(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "draft.md"
            path.write_text("Alpha\nBeta\n", encoding="utf-8")
            created_path = Path(temp_dir) / "new.md"
            patch = "\n".join(
                [
                    "*** Begin Patch",
                    f"*** Update File: {path}",
                    "@@",
                    " Alpha",
                    "-Beta",
                    "+Gamma",
                    f"*** Add File: {created_path}",
                    "+Fresh line",
                    "*** End Patch",
                ]
            )

            review = build_write_review_request(
                "patch",
                {
                    "mode": "patch",
                    "patch": patch
                },
            )

            self.assertIsNotNone(review)
            self.assertEqual(review["toolName"], "patch")
            self.assertIn(str(path), review["filePath"])
            self.assertIn("-Beta", review["diff"])
            self.assertIn("+Gamma", review["diff"])
            self.assertIn(f"+++ b/{created_path}", review["diff"])
            self.assertIn("+Fresh line", review["diff"])

    def test_install_write_review_handlers_wraps_write_tools_without_confirmation_gate(self):
        fake_registry = types.SimpleNamespace()
        original_write_handler = lambda args, **kwargs: "write"
        original_patch_handler = lambda args, **kwargs: "patch"
        fake_registry.entries = {
            "write_file": types.SimpleNamespace(handler=original_write_handler),
            "patch": types.SimpleNamespace(handler=original_patch_handler),
        }

        def get_entry(tool_name):
            return fake_registry.entries.get(tool_name)

        fake_registry.get_entry = get_entry
        fake_module = types.ModuleType("tools.registry")
        fake_module.registry = fake_registry
        previous_module = sys.modules.get("tools.registry")
        sys.modules["tools.registry"] = fake_module

        try:
            install_write_review_handlers(types.SimpleNamespace())
            self.assertIsNot(fake_registry.entries["write_file"].handler, original_write_handler)
            self.assertIsNot(fake_registry.entries["patch"].handler, original_patch_handler)
            self.assertTrue(getattr(fake_registry.entries["write_file"].handler, "_is_write_review_wrapper", False))
            self.assertTrue(getattr(fake_registry.entries["patch"].handler, "_is_write_review_wrapper", False))
        finally:
            if previous_module is None:
                sys.modules.pop("tools.registry", None)
            else:
                sys.modules["tools.registry"] = previous_module

    def test_install_write_review_handlers_emits_post_apply_review_without_waiting(self):
        fake_registry = types.SimpleNamespace()
        calls = []

        def original_write_handler(args, **kwargs):
            calls.append((args, kwargs))
            Path(args["path"]).write_text(args["content"], encoding="utf-8")
            return json.dumps({"success": True}, ensure_ascii=False)

        fake_registry.entries = {
            "write_file": types.SimpleNamespace(handler=original_write_handler),
            "patch": types.SimpleNamespace(handler=lambda args, **kwargs: "patch"),
        }

        def get_entry(tool_name):
            return fake_registry.entries.get(tool_name)

        fake_registry.get_entry = get_entry
        fake_module = types.ModuleType("tools.registry")
        fake_module.registry = fake_registry
        previous_module = sys.modules.get("tools.registry")
        sys.modules["tools.registry"] = fake_module

        emitted = []
        import hermes_bridge as bridge_module

        original_emit = bridge_module.emit
        bridge_module.emit = emitted.append

        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                path = Path(temp_dir) / "note.md"
                path.write_text("旧标题\n", encoding="utf-8")

                install_write_review_handlers(types.SimpleNamespace())
                result = fake_registry.entries["write_file"].handler(
                    {"path": str(path), "content": "新标题\n"},
                    task_id="test",
                )

                self.assertEqual(json.loads(result), {"success": True})
                self.assertEqual(path.read_text(encoding="utf-8"), "新标题\n")
                self.assertEqual(len(calls), 1)
                review_events = [event for event in emitted if event.get("type") == "write_review"]
                self.assertEqual(len(review_events), 1)
                self.assertEqual(review_events[0]["phase"], "applied")
                self.assertTrue(review_events[0]["requestId"].startswith("write-review-"))
                self.assertIn("-旧标题", review_events[0]["diff"])
                self.assertIn("+新标题", review_events[0]["diff"])
                self.assertEqual(review_events[0]["snapshots"], [{"path": str(path), "content": "旧标题\n"}])
                self.assertFalse(any(event.get("text") == "等待确认写入" for event in emitted))
        finally:
            bridge_module.emit = original_emit
            if previous_module is None:
                sys.modules.pop("tools.registry", None)
            else:
                sys.modules["tools.registry"] = previous_module

    def test_preprocess_bridge_images_enriches_prompt_with_analysis(self):
        previous_module = sys.modules.get("tools.vision_tools")
        fake_module = types.ModuleType("tools.vision_tools")

        async def fake_vision_analyze_tool(**_kwargs):
            return json.dumps({
                "success": True,
                "analysis": "一张带历史会话侧栏的 Hermes 界面截图。"
            }, ensure_ascii=False)

        fake_module.vision_analyze_tool = fake_vision_analyze_tool
        sys.modules["tools.vision_tools"] = fake_module

        try:
            with tempfile.NamedTemporaryFile(suffix=".png") as image_file:
                prompt = preprocess_bridge_images(
                    agent=None,
                    prompt="这张图里有什么？",
                    image_paths=[image_file.name],
                )

                self.assertIn("The user attached an image", prompt)
                self.assertIn("一张带历史会话侧栏的 Hermes 界面截图。", prompt)
                self.assertIn("这张图里有什么？", prompt)
        finally:
            if previous_module is None:
                sys.modules.pop("tools.vision_tools", None)
            else:
                sys.modules["tools.vision_tools"] = previous_module


if __name__ == "__main__":
    unittest.main()
