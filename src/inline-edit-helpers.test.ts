import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	INLINE_EDIT_ACTIONS,
	buildInlineEditPrompt,
	filterInlineEditActions,
	getParagraphRangeAtCursor,
	isContinuousSelection,
	parseSlashTrigger,
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

test("buildInlineEditPrompt requires markdown-only output and wiki link format", () => {
	const wikiAction = INLINE_EDIT_ACTIONS.find((action) => action.id === "wiki-link");
	assert.ok(wikiAction);
	const prompt = buildInlineEditPrompt({
		action: wikiAction,
		targetText: "概率思维不是保证，而是和不确定性共存。",
		noteTitle: "概率思维"
	});
	assert.match(prompt, /只返回可以直接写入笔记的 Markdown 正文/);
	assert.match(prompt, /\[\[概念\]\]/);
	assert.doesNotMatch(prompt, /```/);
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
