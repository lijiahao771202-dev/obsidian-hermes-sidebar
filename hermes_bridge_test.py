import json
import tempfile
import unittest
from unittest.mock import patch

from hermes_bridge import pick_bridge_final_text, preprocess_bridge_images


class HermesBridgeHelpersTest(unittest.TestCase):
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

    @patch("tools.vision_tools.vision_analyze_tool")
    def test_preprocess_bridge_images_enriches_prompt_with_analysis(self, mock_vision_analyze_tool):
        mock_vision_analyze_tool.return_value = json.dumps({
            "success": True,
            "analysis": "一张带历史会话侧栏的 Hermes 界面截图。"
        }, ensure_ascii=False)

        with tempfile.NamedTemporaryFile(suffix=".png") as image_file:
            prompt = preprocess_bridge_images(
                agent=None,
                prompt="这张图里有什么？",
                image_paths=[image_file.name],
            )

            self.assertIn("The user attached an image", prompt)
            self.assertIn("一张带历史会话侧栏的 Hermes 界面截图。", prompt)
            self.assertIn("这张图里有什么？", prompt)


if __name__ == "__main__":
    unittest.main()
