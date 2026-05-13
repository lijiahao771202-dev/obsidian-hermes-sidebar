import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	DEFAULT_SESSION_TITLE,
	buildSessionTitle,
	shouldRefreshSelectionSnapshot,
	formatSelectionPreview,
	shouldHideStatusText,
	shouldRestoreComposerFocus,
	getNextStickToBottom,
	getRestoredScrollTop,
	pickNextActiveSessionId,
	pickSelectionText,
	shouldStickToBottom
} from "./session-helpers.ts";

test("formatSelectionPreview collapses whitespace and truncates long selections", () => {
	assert.equal(
		formatSelectionPreview("  妄想   不是   通过  重复   出现   来 加强的  ", 12),
		"妄想 不是 通过..."
	);
});

test("buildSessionTitle falls back for empty text and truncates long prompts", () => {
	assert.equal(buildSessionTitle("   "), DEFAULT_SESSION_TITLE);
	assert.equal(
		buildSessionTitle("帮我根据这段选中的文本写一个更简洁的摘要", 14),
		"帮我根据这段选中的文本..."
	);
});

test("pickNextActiveSessionId keeps the preferred session when possible and otherwise picks the newest", () => {
	const sessions = [
		{ id: "older", createdAt: 10, updatedAt: 10 },
		{ id: "newer", createdAt: 20, updatedAt: 25 },
		{ id: "latest", createdAt: 30, updatedAt: 40 }
	];

	assert.equal(pickNextActiveSessionId(sessions, "newer"), "newer");
	assert.equal(pickNextActiveSessionId(sessions, "missing"), "latest");
	assert.equal(pickNextActiveSessionId([], "missing"), undefined);
});

test("pickSelectionText prefers browser selection in preview mode and editor selection in source mode", () => {
	assert.equal(
		pickSelectionText({
			mode: "preview",
			editorSelection: "错误的编辑器残留",
			browserSelection: "真正页面选中的内容"
		}),
		"真正页面选中的内容"
	);

	assert.equal(
		pickSelectionText({
			mode: "source",
			editorSelection: "编辑器里的选区",
			browserSelection: "页面选区"
		}),
		"编辑器里的选区"
	);

	assert.equal(
		pickSelectionText({
			mode: "preview",
			editorSelection: "",
			browserSelection: ""
		}),
		""
	);
});

test("shouldStickToBottom only returns true when the user is near the bottom", () => {
	assert.equal(
		shouldStickToBottom({
			scrollTop: 780,
			clientHeight: 200,
			scrollHeight: 1000
		}),
		true
	);

	assert.equal(
		shouldStickToBottom({
			scrollTop: 520,
			clientHeight: 200,
			scrollHeight: 1000
		}),
		false
	);
});

test("getNextStickToBottom keeps following streamed replies until the user scrolls away", () => {
	assert.equal(
		getNextStickToBottom({
			scrollTop: 240,
			clientHeight: 300,
			scrollHeight: 900,
			isSending: true,
			currentlySticking: true
		}),
		true
	);

	assert.equal(
		getNextStickToBottom({
			scrollTop: 240,
			clientHeight: 300,
			scrollHeight: 900,
			isSending: true,
			currentlySticking: false
		}),
		false
	);

	assert.equal(
		getNextStickToBottom({
			scrollTop: 240,
			clientHeight: 300,
			scrollHeight: 900,
			isSending: false,
			currentlySticking: true
		}),
		false
	);
});

test("getRestoredScrollTop preserves the previous reading position only when auto-stick is off", () => {
	assert.equal(getRestoredScrollTop(1289, false), 1289);
	assert.equal(getRestoredScrollTop(1289, true), undefined);
	assert.equal(getRestoredScrollTop(null, false), undefined);
});

test("shouldRestoreComposerFocus only keeps focus when the user is already near the bottom", () => {
	assert.equal(shouldRestoreComposerFocus(true, true), true);
	assert.equal(shouldRestoreComposerFocus(true, false), false);
	assert.equal(shouldRestoreComposerFocus(false, true), false);
});

test("shouldRefreshSelectionSnapshot ignores transient drag updates until the selection stabilizes", () => {
	assert.equal(
		shouldRefreshSelectionSnapshot({
			nextSelection: "正在拖选中的一小段",
			currentSnapshot: "",
			isPointerDown: true
		}),
		false
	);

	assert.equal(
		shouldRefreshSelectionSnapshot({
			nextSelection: "已经稳定的最终选区",
			currentSnapshot: "",
			isPointerDown: false
		}),
		true
	);

	assert.equal(
		shouldRefreshSelectionSnapshot({
			nextSelection: "",
			currentSnapshot: "旧选区",
			isPointerDown: false
		}),
		true
	);
});

test("shouldHideStatusText keeps immediate receiving feedback visible", () => {
	assert.equal(shouldHideStatusText(""), true);
	assert.equal(shouldHideStatusText("Reply received"), true);
	assert.equal(shouldHideStatusText("Hermes 已收到这条消息"), false);
	assert.equal(shouldHideStatusText("正在思考中"), false);
});
