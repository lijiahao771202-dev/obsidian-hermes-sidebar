import json
import sys
import tempfile
import types
import unittest

from hermes_bridge import (
    apply_runtime_reasoning_to_api_kwargs,
    append_reasoning_delta_preview,
    compact_preview,
    extract_new_reasoning_delta,
    format_tool_status,
    should_display_reasoning_delta,
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
        delta, previous = extract_new_reasoning_delta(previous, "让我先搜")
        self.assertEqual(delta, "让我先搜")

        delta, previous = extract_new_reasoning_delta(previous, "让我先搜索一下")
        self.assertEqual(delta, "索一下")

        delta, previous = extract_new_reasoning_delta(previous, "让我先搜索一下")
        self.assertEqual(delta, "")
        self.assertEqual(previous, "让我先搜索一下")

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
            "更完整的预览",
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
