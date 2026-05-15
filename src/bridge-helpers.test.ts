import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildTurnUserText,
	composeObsidianPrompt,
	pickBridgeFinalText
} from "./bridge-helpers.ts";

test("buildTurnUserText keeps typed text and falls back to an image prompt", () => {
	assert.equal(buildTurnUserText("  这里整块 mermaid 渲染有问题  ", 0), "这里整块 mermaid 渲染有问题");
	assert.equal(buildTurnUserText("   ", 1), "请帮我看看这张图片。");
	assert.equal(buildTurnUserText("", 3), "请帮我看看这几张图片。");
});

test("pickBridgeFinalText prefers final text and then falls back to streamed text or previews", () => {
	assert.equal(
		pickBridgeFinalText({
			finalText: "最终答案",
			streamedText: "流式内容",
			progressTexts: ["进度"],
			reasoningPreviews: ["预览"],
			messageContents: ["消息"]
		}),
		"最终答案"
	);

	assert.equal(
		pickBridgeFinalText({
			finalText: "   ",
			streamedText: "流式内容",
			progressTexts: ["进度"],
			reasoningPreviews: ["预览"],
			messageContents: ["消息"]
		}),
		"流式内容"
	);

	assert.equal(
		pickBridgeFinalText({
			finalText: "",
			streamedText: "",
			progressTexts: ["先看一下", "还是空"],
			reasoningPreviews: ["这个更完整的预览答案"],
			messageContents: ["消息"]
		}),
		"这个更完整的预览答案"
	);

	assert.equal(
		pickBridgeFinalText({
			finalText: "",
			streamedText: "",
			progressTexts: [],
			reasoningPreviews: [],
			messageContents: ["", "最后一条助手消息"]
		}),
		"最后一条助手消息"
	);
});

test("composeObsidianPrompt marks the current selection as selected text", () => {
	const prompt = composeObsidianPrompt({
		userText: "现在看到了吗",
		contexts: [],
		liveContext: {
			noteTitle: "2026-05-15 专利转让与AI决策",
			notePath: "复盘日志/2026-05-15 专利转让与AI决策.md",
			selectionText: "WOOP 预规划：愿望、结果、障碍、计划"
		}
	});

	assert.match(prompt, /## User highlighted selection/);
	assert.match(prompt, /exact text currently selected\/highlighted/);
	assert.match(prompt, /```text\nWOOP 预规划：愿望、结果、障碍、计划\n```/);
	assert.match(prompt, /## User request\n\n现在看到了吗/);
});
