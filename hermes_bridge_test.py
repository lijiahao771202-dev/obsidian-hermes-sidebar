import json
import sys
import tempfile
import types
import unittest

from hermes_bridge import format_tool_status, pick_bridge_final_text, preprocess_bridge_images


class HermesBridgeHelpersTest(unittest.TestCase):
    def test_format_tool_status_names_real_tool_activity(self):
        self.assertEqual(format_tool_status("skill_view", "running"), "正在读取 skill")
        self.assertEqual(format_tool_status("skill_view", "done"), "已读取 skill")
        self.assertEqual(format_tool_status("vision_analyze", "running"), "正在调用 vision_analyze")
        self.assertEqual(format_tool_status("vision_analyze", "done"), "已完成 vision_analyze")
        self.assertEqual(format_tool_status("vision_analyze", "error"), "vision_analyze 调用失败")

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
