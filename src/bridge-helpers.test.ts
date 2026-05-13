import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildTurnUserText,
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
