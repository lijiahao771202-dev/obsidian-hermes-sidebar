import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	DEFAULT_SESSION_TITLE,
	adjustIndexAfterInsertion,
	applySessionSnapshot,
	buildContextHealthItems,
	buildSessionTitle,
	formatBridgeConnectionStatus,
	getContextModeDescription,
	getAppendIndexAfterTurnMessages,
	pickLiveContextForMode,
	shouldRefreshSelectionSnapshot,
	formatSelectionPreview,
	getInsertIndexAfterMessage,
	shouldHideStatusText,
	canUpdateBridgeEventWithoutFullRender,
	formatActivityTimelineSummary,
	getActivityChainTailVisibleCount,
	getVisibleActivityMessages,
	isComposerSendShortcut,
	shouldMergeActivityEntry,
	shouldShowActivityEntry,
	shouldRestoreComposerFocus,
	shouldDeferScrollRestore,
	getVisibleActivityTimelineEntries,
	getNextStickToBottom,
	getRestoredScrollTop,
	pickNextActiveSessionId,
	pickSelectionText,
	shouldStickToBottom
} from "./session-helpers.ts";

test("isComposerSendShortcut sends on Shift+Enter or platform submit chords only", () => {
	assert.equal(isComposerSendShortcut({ key: "Enter", shiftKey: true }), true);
	assert.equal(isComposerSendShortcut({ key: "Enter", metaKey: true }), true);
	assert.equal(isComposerSendShortcut({ key: "Enter", ctrlKey: true }), true);
	assert.equal(isComposerSendShortcut({ key: "Enter" }), false);
	assert.equal(isComposerSendShortcut({ key: "Enter", altKey: true }), false);
	assert.equal(isComposerSendShortcut({ key: "Escape", shiftKey: true }), false);
});

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

test("applySessionSnapshot updates the same session object so active turn references keep sessionId", () => {
	const messages = [{ id: "user-1" }];
	const session = {
		id: "session-1",
		title: DEFAULT_SESSION_TITLE,
		createdAt: 10,
		updatedAt: 20,
		messages: [] as Array<{ id: string }>,
		sessionId: undefined as string | undefined
	};

	const returned = applySessionSnapshot(
		session,
		{
			title: "  缓存追踪  ",
			messages,
			sessionId: "20260518_123000_abc123"
		},
		true,
		30
	);

	assert.equal(returned, session);
	assert.equal(session.title, "缓存追踪");
	assert.equal(session.sessionId, "20260518_123000_abc123");
	assert.equal(session.messages, messages);
	assert.equal(session.updatedAt, 30);
});

test("formatBridgeConnectionStatus shows Hermes session id and cache usage when available", () => {
	assert.equal(
		formatBridgeConnectionStatus("20260518_123000_abc123", {
			apiCalls: 2,
			cacheHitRate: 87
		}),
		"已连接 20260518_123000_abc123 · cache 87% · 2 calls"
	);
	assert.equal(formatBridgeConnectionStatus(undefined, undefined), "已收到回复");
});

test("pickLiveContextForMode applies explicit Obsidian context modes", () => {
	const liveContext = {
		noteTitle: "正念练习",
		notePath: "心理学/正念练习.md",
		selectionText: "观察念头，不追随。",
		noteContext: "前文\n观察念头，不追随。\n后文"
	};

	assert.deepEqual(pickLiveContextForMode(liveContext, "selection"), {
		noteTitle: "正念练习",
		notePath: "心理学/正念练习.md",
		selectionText: "观察念头，不追随。",
		noteContext: "前文\n观察念头，不追随。\n后文"
	});
	assert.deepEqual(pickLiveContextForMode(liveContext, "note"), {
		noteTitle: "正念练习",
		notePath: "心理学/正念练习.md"
	});
	assert.deepEqual(pickLiveContextForMode(liveContext, "manual"), {});
	assert.equal(getContextModeDescription("auto"), "自动");
});

test("buildContextHealthItems summarizes session, cache, and pending context state", () => {
	assert.deepEqual(
		buildContextHealthItems({
			sessionId: "20260518_123000_abcdef",
			contextMode: "selection",
			pendingContextCount: 2,
			pendingImageCount: 1,
			queueCount: 3,
			liveContext: {
				noteTitle: "正念练习",
				selectionText: "观察念头，不追随。",
				noteContext: "前文\n观察念头，不追随。\n后文"
			},
			usage: {
				apiCalls: 2,
				cacheHitRate: 87
			}
		}),
		[
			{ label: "Session", value: "20260518_123000_abcdef" },
			{ label: "Cache", value: "87% · 2 calls" },
			{ label: "Context", value: "选区优先 · 正念练习 · 选区 9 字 · 附近上下文 15 字" },
			{ label: "Pending", value: "2 段上下文 · 1 张图片 · 3 条排队" }
		]
	);
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

test("shouldDeferScrollRestore waits until async message rendering can hold the old position", () => {
	assert.equal(
		shouldDeferScrollRestore({
			targetScrollTop: 920,
			clientHeight: 320,
			scrollHeight: 640
		}),
		true
	);

	assert.equal(
		shouldDeferScrollRestore({
			targetScrollTop: 920,
			clientHeight: 320,
			scrollHeight: 1400
		}),
		false
	);

	assert.equal(
		shouldDeferScrollRestore({
			targetScrollTop: 0,
			clientHeight: 320,
			scrollHeight: 320
		}),
		false
	);
});

test("canUpdateBridgeEventWithoutFullRender keeps streaming events from rebuilding the message list", () => {
	assert.equal(canUpdateBridgeEventWithoutFullRender("status"), true);
	assert.equal(canUpdateBridgeEventWithoutFullRender("activity"), true);
	assert.equal(canUpdateBridgeEventWithoutFullRender("progress"), true);
	assert.equal(canUpdateBridgeEventWithoutFullRender("delta"), true);
	assert.equal(canUpdateBridgeEventWithoutFullRender("final"), false);
	assert.equal(canUpdateBridgeEventWithoutFullRender("segment_break"), false);
});

test("shouldShowActivityEntry hides run configuration from the visible timeline", () => {
	assert.equal(shouldShowActivityEntry("run.config"), false);
	assert.equal(shouldShowActivityEntry(" terminal "), true);
	assert.equal(shouldShowActivityEntry("thinking"), true);
	assert.equal(shouldShowActivityEntry(undefined), true);
});

test("getVisibleActivityTimelineEntries keeps only the latest completed entries by default", () => {
	const entries = Array.from({ length: 20 }, (_, index) => ({
		toolName: "terminal",
		status: "done",
		preview: `step-${index + 1}`
	}));

	const result = getVisibleActivityTimelineEntries(entries, false, 1);
	assert.equal(result.totalCount, 20);
	assert.equal(result.hiddenCount, 19);
	assert.deepEqual(result.visibleEntries.map((entry) => entry.preview), ["step-20"]);
});

test("getVisibleActivityTimelineEntries can fully collapse completed timelines", () => {
	const entries = [
		{ toolName: "terminal", status: "done", preview: "step-1" },
		{ toolName: "terminal", status: "done", preview: "step-2" },
		{ toolName: "thinking", status: "done", preview: "step-3" },
		{ toolName: "terminal", status: "done", preview: "step-4" },
		{ toolName: "terminal", status: "done", preview: "step-5" }
	];

	const result = getVisibleActivityTimelineEntries(entries, false, 1, false);
	assert.equal(result.hiddenCount, 5);
	assert.deepEqual(result.visibleEntries.map((entry) => entry.preview), []);
});

test("getVisibleActivityTimelineEntries fully collapses a single completed entry when collapsed tail is disabled", () => {
	const entries = [{ toolName: "thinking", status: "done", preview: "step-1" }];

	const result = getVisibleActivityTimelineEntries(entries, false, 1, false);
	assert.equal(result.totalCount, 1);
	assert.equal(result.hiddenCount, 1);
	assert.deepEqual(result.visibleEntries, []);
	assert.equal(formatActivityTimelineSummary(result.totalCount, result.hiddenCount), "过程 · 1 条");
});

test("getVisibleActivityTimelineEntries keeps the latest entry visible while a run is active", () => {
	const entries = [
		{ toolName: "terminal", status: "done", preview: "step-1" },
		{ toolName: "terminal", status: "error", preview: "step-2" },
		{ toolName: "thinking", status: "running", preview: "step-3" },
		{ toolName: "terminal", status: "done", preview: "step-4" },
		{ toolName: "terminal", status: "done", preview: "step-5" }
	];

	const result = getVisibleActivityTimelineEntries(entries, false, 1, true);
	assert.equal(result.hiddenCount, 4);
	assert.deepEqual(result.visibleEntries.map((entry) => entry.preview), ["step-5"]);
});

test("getVisibleActivityTimelineEntries shows all entries when expanded", () => {
	const entries = [
		{ toolName: "terminal", status: "done", preview: "step-1" },
		{ toolName: "thinking", status: "done", preview: "step-2" },
		{ toolName: "terminal", status: "error", preview: "step-3" }
	];

	const result = getVisibleActivityTimelineEntries(entries, true, 1);
	assert.equal(result.hiddenCount, 0);
	assert.deepEqual(
		result.visibleEntries.map((entry) => entry.preview),
		["step-1", "step-2", "step-3"]
	);
});

test("getVisibleActivityTimelineEntries does not hide short timelines", () => {
	const entries = [
		{ toolName: "terminal", status: "done", preview: "step-1" },
		{ toolName: "terminal", status: "done", preview: "step-2" }
	];

	const result = getVisibleActivityTimelineEntries(entries, false, 1);
	assert.equal(result.hiddenCount, 1);
	assert.equal(formatActivityTimelineSummary(result.totalCount, result.hiddenCount), "过程 · 2 条 · 已折叠 1 条");
});

test("formatActivityTimelineSummary includes hidden counts", () => {
	assert.equal(formatActivityTimelineSummary(20, 16), "过程 · 20 条 · 已折叠 16 条");
});

test("getVisibleActivityMessages keeps only the latest completed activity message when collapsed tail is enabled", () => {
	const messages = Array.from({ length: 20 }, (_, index) => ({
		pending: false,
		activities: [
			{
				toolName: "terminal",
				status: "done",
				preview: `message-${index + 1}`
			}
		]
	}));

	const result = getVisibleActivityMessages(messages, false, 1);
	assert.equal(result.totalCount, 20);
	assert.equal(result.hiddenCount, 19);
	assert.deepEqual(
		result.visibleMessages.map((message) => message.activities?.[0]?.preview),
		["message-20"]
	);
});

test("getVisibleActivityMessages can fully collapse completed activity chains", () => {
	const messages = [
		{ pending: false, activities: [{ toolName: "terminal", status: "done", preview: "message-1" }] },
		{ pending: false, activities: [{ toolName: "terminal", status: "done", preview: "message-2" }] },
		{ pending: false, activities: [{ toolName: "thinking", status: "done", preview: "message-3" }] }
	];

	const result = getVisibleActivityMessages(messages, false, 1, false);
	assert.equal(result.hiddenCount, 3);
	assert.deepEqual(result.visibleMessages.map((message) => message.activities?.[0]?.preview), []);
});

test("getVisibleActivityMessages fully collapses a single completed activity message when collapsed tail is disabled", () => {
	const messages = [{ pending: false, activities: [{ toolName: "thinking", status: "done", preview: "message-1" }] }];

	const result = getVisibleActivityMessages(messages, false, 1, false);
	assert.equal(result.totalCount, 1);
	assert.equal(result.hiddenCount, 1);
	assert.deepEqual(result.visibleMessages, []);
	assert.equal(formatActivityTimelineSummary(result.totalCount, result.hiddenCount), "过程 · 1 条");
});

test("getVisibleActivityMessages keeps only the latest activity message visible while a run is active", () => {
	const messages = [
		{ pending: false, activities: [{ toolName: "terminal", status: "done", preview: "message-1" }] },
		{ pending: false, activities: [{ toolName: "terminal", status: "error", preview: "message-2" }] },
		{ pending: true, activities: [{ toolName: "thinking", status: "running", preview: "message-3" }] },
		{ pending: false, activities: [{ toolName: "terminal", status: "done", preview: "message-4" }] },
		{ pending: false, activities: [{ toolName: "terminal", status: "done", preview: "message-5" }] }
	];

	const result = getVisibleActivityMessages(messages, false, 1, true);
	assert.equal(result.hiddenCount, 4);
	assert.deepEqual(
		result.visibleMessages.map((message) => message.activities?.[0]?.preview),
		["message-5"]
	);
});

test("getActivityChainTailVisibleCount keeps the latest real tool visible when thinking is the newest step", () => {
	const messages = [
		{ pending: false, activities: [{ toolName: "read_file", status: "done", preview: "a.md" }] },
		{ pending: true, activities: [{ toolName: "thinking", status: "running", preview: "让我想想" }] }
	];

	assert.equal(getActivityChainTailVisibleCount(messages), 2);
	assert.equal(
		getActivityChainTailVisibleCount([
			{ pending: false, activities: [{ toolName: "read_file", status: "done", preview: "a.md" }] },
			{ pending: false, activities: [{ toolName: "terminal", status: "running", preview: "ls" }] }
		]),
		1
	);
});

test("getVisibleActivityMessages shows all activity messages when expanded", () => {
	const messages = [
		{ pending: false, activities: [{ toolName: "terminal", status: "done", preview: "message-1" }] },
		{ pending: false, activities: [{ toolName: "thinking", status: "done", preview: "message-2" }] },
		{ pending: false, activities: [{ toolName: "terminal", status: "error", preview: "message-3" }] }
	];

	const result = getVisibleActivityMessages(messages, true, 1);
	assert.equal(result.hiddenCount, 0);
	assert.deepEqual(
		result.visibleMessages.map((message) => message.activities?.[0]?.preview),
		["message-1", "message-2", "message-3"]
	);
});

test("getVisibleActivityMessages fully hides short completed activity chains when collapsed tail is disabled", () => {
	const messages = [
		{ pending: false, activities: [{ toolName: "terminal", status: "done", preview: "message-1" }] },
		{ pending: false, activities: [{ toolName: "terminal", status: "done", preview: "message-2" }] }
	];

	const result = getVisibleActivityMessages(messages, false, 1, false);
	assert.equal(result.hiddenCount, 2);
	assert.equal(formatActivityTimelineSummary(result.totalCount, result.hiddenCount), "过程 · 2 条");
});

test("shouldMergeActivityEntry keeps streaming thinking in a single visible row", () => {
	assert.equal(shouldMergeActivityEntry("thinking", "running", "running", "让", "让我"), true);
	assert.equal(shouldMergeActivityEntry("thinking", "done", "running", "让", "让我"), false);
	assert.equal(shouldMergeActivityEntry("terminal", "running", "running", "cat a", "cat a"), true);
	assert.equal(shouldMergeActivityEntry("terminal", "running", "running", "cat a", "cat b"), false);
	assert.equal(shouldMergeActivityEntry("read_file", "running", "done", "/tmp/a.md", "/tmp/a.md"), true);
	assert.equal(shouldMergeActivityEntry("read_file", "done", "done", "/tmp/a.md", "/tmp/a.md"), false);
});

test("activity insertion can stay anchored after the user message", () => {
	const messages = [{ id: "user-1" }, { id: "assistant-1" }];
	assert.equal(getInsertIndexAfterMessage(messages, "user-1"), 1);
	assert.equal(getInsertIndexAfterMessage(messages, "missing"), undefined);
	assert.equal(adjustIndexAfterInsertion(1, 1), 2);
	assert.equal(adjustIndexAfterInsertion(0, 1), 0);
	assert.equal(adjustIndexAfterInsertion(null, 1), null);
});

test("turn events append after prior events so assistant replies can interleave with activity rows", () => {
	const messages = [
		{ id: "user-1", kind: "user" },
		{ id: "activity-1", kind: "activity" },
		{ id: "assistant-1", kind: "final" }
	];
	assert.equal(getAppendIndexAfterTurnMessages(messages, "user-1"), 3);

	const withNextTurn = [...messages, { id: "user-2", kind: "user" }];
	assert.equal(getAppendIndexAfterTurnMessages(withNextTurn, "user-1"), 3);
	assert.equal(getAppendIndexAfterTurnMessages(withNextTurn, "missing"), 4);
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
			isPointerDown: false,
			keepExistingWhenEmpty: true
		}),
		false
	);

	assert.equal(
		shouldRefreshSelectionSnapshot({
			nextSelection: "",
			currentSnapshot: "旧选区",
			isPointerDown: false,
			keepExistingWhenEmpty: false
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
