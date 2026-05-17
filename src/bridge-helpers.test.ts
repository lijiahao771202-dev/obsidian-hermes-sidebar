import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildReplayAssistantContent,
	buildHermesInterimGuidance,
	buildReplayUserContent,
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
			selectionText: "WOOP 预规划：愿望、结果、障碍、计划",
			noteContext: "前文\nWOOP 预规划：愿望、结果、障碍、计划\n后文"
		}
	});

	assert.match(prompt, /## User highlighted selection/);
	assert.match(prompt, /exact text currently selected\/highlighted/);
	assert.match(prompt, /```text\nWOOP 预规划：愿望、结果、障碍、计划\n```/);
	assert.match(prompt, /## Current note context/);
	assert.match(prompt, /前文\nWOOP 预规划：愿望、结果、障碍、计划\n后文/);
	assert.match(prompt, /## User request\n\n现在看到了吗/);
});

test("buildReplayUserContent keeps a compact memory of attached note context and images", () => {
	const replay = buildReplayUserContent({
		userText: "继续刚才那篇文章",
		contexts: [
			{
				label: "手动添加文章",
				content: "正念训练能提高注意力稳定性，也会改变对念头的关系。"
			}
		],
		liveContext: {
			noteTitle: "心理学/正念",
			notePath: "心理学/临床心理与行为/正念.md",
			selectionText: "接纳并不是认同念头，而是不再与念头纠缠。",
			noteContext: "上文\n接纳并不是认同念头，而是不再与念头纠缠。\n下文"
		},
		imageNames: ["mindfulness-1.png", "mindfulness-2.png"]
	});

	assert.match(replay, /User request:\n继续刚才那篇文章/);
	assert.match(replay, /Current open note:/);
	assert.match(replay, /心理学\/临床心理与行为\/正念\.md/);
	assert.match(replay, /Highlighted selection attached:/);
	assert.match(replay, /接纳并不是认同念头，而是不再与念头纠缠。/);
	assert.match(replay, /Manual attachment - 手动添加文章:/);
	assert.match(replay, /正念训练能提高注意力稳定性/);
	assert.match(replay, /Attached images: mindfulness-1\.png, mindfulness-2\.png/);
});

test("buildReplayAssistantContent keeps final text and a concise work recap", () => {
	const replay = buildReplayAssistantContent({
		finalText: "我已经整理好文章结构，并放进正念目录。",
		activities: [
			{ toolName: "thinking", status: "done", preview: "先想一想" },
			{ toolName: "obsidian", status: "done", preview: "写入心理学/临床心理与行为/正念/进阶探讨" },
			{ toolName: "writer", status: "running", preview: "已输出 120 chars" },
			{ toolName: "search_files", status: "done", preview: "notes/正念" }
		]
	});

	assert.match(replay, /^我已经整理好文章结构，并放进正念目录。/);
	assert.match(replay, /Work recap:/);
	assert.match(replay, /- obsidian: 写入心理学\/临床心理与行为\/正念\/进阶探讨/);
	assert.match(replay, /- search_files: notes\/正念/);
	assert.doesNotMatch(replay, /thinking/);
	assert.doesNotMatch(replay, /writer/);
});

test("buildHermesInterimGuidance nudges Hermes toward real mid-turn commentary on longer tasks", () => {
	const guidance = buildHermesInterimGuidance({
		provider: "deepseek",
		model: "deepseek-v4-pro",
		reasoningEffort: "xhigh"
	});

	assert.match(guidance, /Current runtime: provider=deepseek, model=deepseek-v4-pro, reasoning_effort=xhigh/);
	assert.match(guidance, /For multi-step, tool-using, or longer tasks, proactively send 1-3 brief interim assistant messages/);
	assert.match(guidance, /Skip interim updates for very short tasks where they would feel noisy/);
	assert.match(guidance, /Do not reveal chain-of-thought/);
});
