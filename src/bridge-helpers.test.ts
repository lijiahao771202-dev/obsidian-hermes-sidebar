import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildReplayAssistantContent,
	buildHermesObsidianWriteGuidance,
	buildHermesInterimGuidance,
	buildReplayUserContent,
	buildTurnUserText,
	composeObsidianPrompt,
	looksLikeInternalReasoningText,
	pickBridgeFinalText
} from "./bridge-helpers.ts";

test("buildTurnUserText keeps typed text and falls back to an image prompt", () => {
	assert.equal(buildTurnUserText("  这里整块 mermaid 渲染有问题  ", 0), "这里整块 mermaid 渲染有问题");
	assert.equal(buildTurnUserText("   ", 1), "请帮我看看这张图片。");
	assert.equal(buildTurnUserText("", 3), "请帮我看看这几张图片。");
});

test("pickBridgeFinalText prefers final text and never promotes reasoning previews to chat content", () => {
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
		"先看一下"
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

	assert.equal(
		pickBridgeFinalText({
			finalText: "",
			streamedText: "",
			progressTexts: [],
			reasoningPreviews: ["不能出现在聊天气泡里的思维链"],
			messageContents: []
		}),
		""
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

test("composeObsidianPrompt keeps a stable cache preamble before dynamic Obsidian content", () => {
	const first = composeObsidianPrompt({
		userText: "帮我整理",
		contexts: [],
		liveContext: {
			noteTitle: "第一篇动态笔记",
			notePath: "动态/第一篇.md",
			selectionText: "第一段选区",
			noteContext: "第一篇上下文"
		}
	});
	const second = composeObsidianPrompt({
		userText: "帮我整理",
		contexts: [],
		liveContext: {
			noteTitle: "第二篇动态笔记",
			notePath: "动态/第二篇.md",
			selectionText: "第二段选区",
			noteContext: "第二篇上下文"
		}
	});

	const dynamicMarker = "## Dynamic Obsidian context";
	assert.ok(first.includes(dynamicMarker));
	assert.equal(first.slice(0, first.indexOf(dynamicMarker)), second.slice(0, second.indexOf(dynamicMarker)));
	assert.ok(first.indexOf("第一篇动态笔记") > first.indexOf(dynamicMarker));
	assert.ok(second.indexOf("第二篇动态笔记") > second.indexOf(dynamicMarker));
});

test("composeObsidianPrompt clamps oversized Obsidian context deterministically", () => {
	const longContext = [
		"BEGIN-STABLE",
		...Array.from({ length: 220 }, (_, index) => `middle line ${index}`),
		"END-STABLE"
	].join("\n");
	const prompt = composeObsidianPrompt({
		userText: "总结这段",
		contexts: [{ label: "当前文章", content: longContext }],
		liveContext: {
			noteContext: longContext
		}
	});

	assert.match(prompt, /BEGIN-STABLE/);
	assert.match(prompt, /END-STABLE/);
	assert.match(prompt, /\[omitted \d+ chars for cache-friendly context clamp\]/);
	assert.doesNotMatch(prompt, /middle line 109/);
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

test("buildReplayUserContent clamps oversized remembered Obsidian context", () => {
	const longContext = [
		"HISTORY-BEGIN",
		...Array.from({ length: 220 }, (_, index) => `history middle line ${index}`),
		"HISTORY-END"
	].join("\n");
	const replay = buildReplayUserContent({
		userText: "继续处理",
		contexts: [{ label: "当前文章", content: longContext }],
		liveContext: {
			noteContext: longContext
		}
	});

	assert.match(replay, /HISTORY-BEGIN/);
	assert.match(replay, /HISTORY-END/);
	assert.match(replay, /\[omitted \d+ chars for cache-friendly context clamp\]/);
	assert.doesNotMatch(replay, /history middle line 109/);
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
	assert.match(guidance, /多步骤、工具调用或较长任务中/);
	assert.match(guidance, /非常短的任务可以跳过进展/);
	assert.match(guidance, /不要泄露思维链/);
});

test("buildHermesObsidianWriteGuidance forces note edits through file tools", () => {
	const guidance = buildHermesObsidianWriteGuidance();

	assert.match(guidance, /write_file/);
	assert.match(guidance, /patch/);
	assert.match(guidance, /必须用文件工具/);
	assert.match(guidance, /不要强行使用 Mermaid/);
	assert.match(guidance, /能通过 Obsidian Mermaid 语法解析/);
	assert.match(guidance, /Wiki 链接应该指向可长期沉淀的概念/);
	assert.match(guidance, /每段优先链接 1-3 个真正有价值的核心概念/);
	assert.match(guidance, /不要留下指向未创建笔记的悬空 wiki 链接/);
	assert.match(guidance, /不要在最终回答里粘贴完整重写内容/);
	assert.match(guidance, /写入前发送一句简短进展/);
	assert.match(guidance, /Current open note/);
});

test("looksLikeInternalReasoningText catches tool-planning chatter without hiding normal answers", () => {
	assert.equal(
		looksLikeInternalReasoningText(
			[
				"不过，子代理不能读本地文件系统，必须用 file 工具。",
				"让我看看子代理可以用的 toolsets。",
				"好，让我先直接处理英语链接，零链接笔记我自己来补。",
				"接下来我会先用 execute_code 再重新扫描。"
			].join("\n")
		),
		true
	);

	assert.equal(
		looksLikeInternalReasoningText("我已经整理好了链接：复盘日志不需要补链接，正念相关笔记已经互相连接。"),
		false
	);
});
