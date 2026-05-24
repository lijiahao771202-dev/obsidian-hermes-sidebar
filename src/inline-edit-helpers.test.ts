import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	INLINE_EDIT_ACTIONS,
	buildInlineEditPrompt,
	buildSelectionContextWindow,
	filterInlineEditActions,
	findInlineEditSourceRange,
	getInlineEditDraftOriginalText,
	getInlineEditToolbarActions,
	getParagraphRangeAtCursor,
	resolveSelectionSourceRange,
	isContinuousSelection,
	parseSlashTrigger,
	selectVaultNoteTitlesForWikiPrompt,
	transitionInlineDraft
} from "./inline-edit-helpers.ts";

test("parseSlashTrigger detects a slash query before the cursor", () => {
	assert.deepEqual(parseSlashTrigger("/润", 2), { query: "润", fromCh: 0 });
	assert.deepEqual(parseSlashTrigger("前文 /wiki", 8), { query: "wiki", fromCh: 3 });
	assert.equal(parseSlashTrigger("http://example.com", 8), null);
});

test("filterInlineEditActions keeps Hermes writing and note enhancement actions searchable", () => {
	assert.equal(INLINE_EDIT_ACTIONS.some((action) => action.id === "wiki-link"), true);
	assert.equal(INLINE_EDIT_ACTIONS.some((action) => action.id === "outline"), true);
	assert.equal(INLINE_EDIT_ACTIONS.some((action) => action.id === "custom"), true);
	assert.deepEqual(
		INLINE_EDIT_ACTIONS.slice(0, 5).map((action) => action.mode),
		["replace", "replace", "replace", "replace", "replace"]
	);
	assert.deepEqual(
		filterInlineEditActions("续").map((action) => action.id),
		["continue"]
	);
	assert.deepEqual(
		filterInlineEditActions("wiki").map((action) => action.id),
		["wiki-link"]
	);
});

test("getInlineEditToolbarActions keeps the floating toolbar focused", () => {
	assert.deepEqual(
		getInlineEditToolbarActions().map((action) => action.id),
		["polish", "format", "html", "shorten", "wiki-link", "custom", "attach-selection"]
	);
	assert.equal(getInlineEditToolbarActions().length <= 7, true);
	assert.equal(getInlineEditToolbarActions().at(-1)?.kind, "attach-selection");
});

test("resolveSelectionSourceRange maps preview selections through rendered markdown text", () => {
	const noteText = ["前文", "**加粗内容**", "[外链文字](https://example.com)", "后文"].join("\n");

	const bold = resolveSelectionSourceRange(noteText, "加粗内容", 0, "preview");
	assert.ok(bold);
	assert.equal(noteText.slice(bold.fromOffset, bold.toOffset), "**加粗内容**");

	const link = resolveSelectionSourceRange(noteText, "外链文字", noteText.indexOf("外链文字"), "preview");
	assert.ok(link);
	assert.equal(noteText.slice(link.fromOffset, link.toOffset), "[外链文字](https://example.com)");
});

test("buildSelectionContextWindow keeps nearby note lines around the selection", () => {
	const noteText = ["头", "上1", "上2", "目标段", "下1", "下2", "尾"].join("\n");
	const excerpt = buildSelectionContextWindow({
		noteText,
		fromOffset: noteText.indexOf("目标段"),
		toOffset: noteText.indexOf("目标段") + "目标段".length,
		windowLines: 1,
		maxCharacters: 120
	});

	assert.match(excerpt, /上2/);
	assert.match(excerpt, /目标段/);
	assert.match(excerpt, /下1/);
	assert.doesNotMatch(excerpt, /头/);
	assert.doesNotMatch(excerpt, /尾/);
});

test("isContinuousSelection only accepts one non-empty selection", () => {
	assert.equal(
		isContinuousSelection([{ anchor: { line: 1, ch: 2 }, head: { line: 1, ch: 8 } }]),
		true
	);
	assert.equal(
		isContinuousSelection([{ anchor: { line: 1, ch: 2 }, head: { line: 1, ch: 2 } }]),
		false
	);
	assert.equal(
		isContinuousSelection([
			{ anchor: { line: 1, ch: 2 }, head: { line: 1, ch: 8 } },
			{ anchor: { line: 2, ch: 1 }, head: { line: 2, ch: 3 } }
		]),
		false
	);
});

test("getParagraphRangeAtCursor expands to the current paragraph", () => {
	const result = getParagraphRangeAtCursor(["开头", "", "第一句", "第二句", "", "结尾"], { line: 3, ch: 1 });
	assert.deepEqual(result.from, { line: 2, ch: 0 });
	assert.deepEqual(result.to, { line: 3, ch: 3 });
	assert.equal(result.text, "第一句\n第二句");
});

test("findInlineEditSourceRange can map table-like DOM selections back to markdown lines", () => {
	const noteText = ["| 措施 | 对策 |", "| --- | --- |", "| 提前预驳 | 写成更清楚的计划 |"].join("\n");
	const result = findInlineEditSourceRange(noteText, "提前预驳\n写成更清楚的计划", 0);
	assert.ok(result);
	assert.equal(result.kind, "table-rows");
	assert.equal(result.sourceText, noteText);
	assert.equal(result.fromOffset, 0);
});

test("findInlineEditSourceRange expands a single table cell selection to the table rows", () => {
	const noteText = ["| 措施 | 对策 |", "| --- | --- |", "| 提前预驳 | 写成更清楚的计划 |"].join("\n");
	const result = findInlineEditSourceRange(noteText, "提前预驳", noteText.indexOf("提前预驳"));
	assert.ok(result);
	assert.equal(result.kind, "table-rows");
	assert.equal(result.sourceText, noteText);
});

test("findInlineEditSourceRange can map partial table column selections to whole markdown rows", () => {
	const noteText = [
		"| 底层保障措施 | 状态 |",
		"| --- | --- |",
		"| 1.提前预驳压 | 未开始 |",
		"| 2.每天读一篇改文章 | 进行中 |",
		"| 3.早上起来就做一次简单的呼吸冥想让大脑在想 | 已完成 |"
	].join("\n");
	const result = findInlineEditSourceRange(
		noteText,
		"底层保障措施\n1.提前预驳压\n2.每天读一篇改文章\n3.早上起来就做一次简单的呼吸冥想让\n大脑在想",
		0
	);
	assert.ok(result);
	assert.equal(result.kind, "table-rows");
	assert.equal(
		result.sourceText,
		[
			"| 底层保障措施 | 状态 |",
			"| --- | --- |",
			"| 1.提前预驳压 | 未开始 |",
			"| 2.每天读一篇改文章 | 进行中 |",
			"| 3.早上起来就做一次简单的呼吸冥想让大脑在想 | 已完成 |"
		].join("\n")
	);
});

test("getInlineEditDraftOriginalText uses markdown source for table previews", () => {
	assert.equal(
		getInlineEditDraftOriginalText({
			targetText: "提前预驳\n写成更清楚的计划",
			sourceText: "| 提前预驳 | 写成更清楚的计划 |"
		}),
		"| 提前预驳 | 写成更清楚的计划 |"
	);
});

test("buildInlineEditPrompt tells the model to return replaceable table markdown", () => {
	const action = INLINE_EDIT_ACTIONS.find((item) => item.id === "format");
	assert.ok(action);
	const prompt = buildInlineEditPrompt({
		action,
		targetText: "提前预驳\n写成更清楚的计划",
		sourceText: "| 提前预驳 | 写成更清楚的计划 |"
	});
	assert.match(prompt, /这是 Markdown 表格源码范围/);
	assert.match(prompt, /返回可以直接替换该范围的 Markdown 表格源码/);
});

test("buildInlineEditPrompt keeps format focused on structure and supports html mode", () => {
	const formatAction = INLINE_EDIT_ACTIONS.find((item) => item.id === "format");
	const htmlAction = INLINE_EDIT_ACTIONS.find((item) => item.id === "html");
	assert.ok(formatAction);
	assert.ok(htmlAction);

	const formatPrompt = buildInlineEditPrompt({
		action: formatAction,
		targetText: "### 旧标题\n\n-  乱七八糟 的 列表",
		noteContext: "第一段\n第二段"
	});
	assert.match(formatPrompt, /保留原意/);
	assert.match(formatPrompt, /不要改内容/);
	assert.match(formatPrompt, /mermaid/i);
	assert.match(formatPrompt, /## 当前笔记上下文/);

	const htmlPrompt = buildInlineEditPrompt({
		action: htmlAction,
		targetText: "标题\n正文"
	});
	assert.match(htmlPrompt, /HTML/);
	assert.match(htmlPrompt, /Obsidian/);
	assert.match(htmlPrompt, /只输出/);
});

test("buildInlineEditPrompt requires markdown-only output and real wiki note titles", () => {
	const wikiAction = INLINE_EDIT_ACTIONS.find((action) => action.id === "wiki-link");
	assert.ok(wikiAction);
	const prompt = buildInlineEditPrompt({
		action: wikiAction,
		targetText: "概率思维不是保证，而是和不确定性共存。",
		noteTitle: "概率思维",
		vaultNoteTitles: ["概率思维", "分布式记忆理论"]
	});
	assert.match(prompt, /只返回可以直接写入笔记的 Markdown 正文/);
	assert.match(prompt, /只能使用下方真实存在的笔记标题/);
	assert.match(prompt, /\[\[概率思维\]\]/);
	assert.doesNotMatch(prompt, /\[\[概念\]\]/);
	assert.doesNotMatch(prompt, /```/);
});

test("buildInlineEditPrompt includes custom instructions for direct questions", () => {
	const action = INLINE_EDIT_ACTIONS.find((item) => item.id === "custom");
	assert.ok(action);
	const prompt = buildInlineEditPrompt({
		action,
		targetText: "这段话有点绕。",
		customInstruction: "改成更有力量的表达"
	});
	assert.match(prompt, /## 用户自定义要求\n改成更有力量的表达/);
});

test("buildInlineEditPrompt includes follow-up constraints for regeneration", () => {
	const action = INLINE_EDIT_ACTIONS.find((item) => item.id === "polish");
	assert.ok(action);
	const prompt = buildInlineEditPrompt({
		action,
		targetText: "这段话有点绕。",
		currentProposal: "这段话可以更直接。",
		followUp: "再短一点"
	});
	assert.match(prompt, /## 当前候选稿\n这段话可以更直接。/);
	assert.match(prompt, /## 追问要求\n再短一点/);
});

test("selectVaultNoteTitlesForWikiPrompt ranks real matching note titles first", () => {
	assert.deepEqual(
		selectVaultNoteTitlesForWikiPrompt({
			titles: ["分布式记忆理论", "概率思维", "无关笔记"],
			targetText: "概率思维不是保证。",
			noteTitle: "行为科学",
			limit: 2
		}),
		["概率思维", "分布式记忆理论"]
	);
});

test("transitionInlineDraft ignores stale requests and accepts matching results", () => {
	const draft = {
		actionId: "polish",
		filePath: "a.md",
		fromOffset: 2,
		toOffset: 8,
		originalText: "原文",
		proposedText: "",
		status: "generating" as const,
		requestId: 3
	};

	assert.equal(transitionInlineDraft(draft, "ready", { requestId: 2, proposedText: "旧结果" }).state, draft);
	assert.deepEqual(transitionInlineDraft(draft, "ready", { requestId: 3, proposedText: "新结果" }).state, {
		...draft,
		status: "ready",
		proposedText: "新结果"
	});
	assert.equal(transitionInlineDraft(draft, "cancel").state, null);
});
