import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	advanceChatWriteReviewVisibleCharacters,
	buildChatWriteReviewOverview,
	buildChatWriteAppliedReview,
	buildChatWriteReviewAdditionMarkdown,
	buildChatWriteReviewDocumentFrame,
	formatChatWriteReviewFileLabel,
	buildChatWriteReviewInlinePreview,
	buildChatWriteReviewRenderedMarkdownPreview,
	buildChatWriteReviewStreamFrame,
	formatChatWriteReviewLineDisplay,
	getChatWriteReviewTotalAddedCharacters,
	listChatWriteReviewMarkdownTargets,
	resolveChatWriteReviewTargetPath,
	shouldAutoRevealWriteReviewTarget,
	summarizeChatWriteReviewFiles
} from "./chat-write-review-helpers.ts";

test("buildChatWriteAppliedReview normalizes applied diff review events", () => {
	assert.deepEqual(
		buildChatWriteAppliedReview({
			requestId: " write-review-1 ",
			title: " 已应用修改 ",
			meta: " patch · 1 file · -1 +1 ",
			filePath: "/Users/me/Vault/Note.md",
			diff: "--- a/Note.md\n+++ b/Note.md\n@@ -1 +1 @@\n-old\n+new\n",
			snapshots: [
				{ path: "/Users/me/Vault/Note.md", content: "old\n" },
				{ path: "/Users/me/Vault/Note.md", content: "old again\n" },
				{ path: "", content: "skip\n" }
			]
		}),
		{
			requestId: "write-review-1",
			title: "已应用修改",
			meta: "patch · 1 file · -1 +1",
			filePath: "/Users/me/Vault/Note.md",
			diff: "--- a/Note.md\n+++ b/Note.md\n@@ -1 +1 @@\n-old\n+new",
			snapshots: [{ path: "/Users/me/Vault/Note.md", content: "old\n" }],
			status: "pending"
		}
	);
});

test("buildChatWriteAppliedReview rejects events without request id or diff", () => {
	assert.equal(buildChatWriteAppliedReview({ requestId: "write-review-1", diff: "" }), null);
	assert.equal(buildChatWriteAppliedReview({ requestId: "", diff: "+new" }), null);
});

test("buildChatWriteReviewInlinePreview maps replace hunks to original note lines", () => {
	const preview = buildChatWriteReviewInlinePreview({
		filePath: "/vault/Notes/demo.md",
		diff: [
			"--- a//vault/Notes/demo.md",
			"+++ b//vault/Notes/demo.md",
			"@@ -2,3 +2,4 @@",
			" 保留前文",
			"-旧句子",
			"+新句子",
			"+新增行动项",
			" 保留后文"
		].join("\n")
	});

	assert.deepEqual(preview?.deletions, [{ fromLine: 2, toLine: 2 }]);
	assert.deepEqual(preview?.additions, [{ afterLine: 2, lines: ["新句子", "新增行动项"] }]);
	assert.equal(preview?.firstLine, 1);
});

test("buildChatWriteReviewInlinePreview rejects multi-file chat patches for inline review", () => {
	assert.equal(
		buildChatWriteReviewInlinePreview({
			filePath: "/vault/a.md, /vault/b.md",
			diff: "--- a/a.md\n+++ b/a.md\n@@ -1 +1 @@\n-a\n+b"
		}),
		null
	);
});

test("summarizeChatWriteReviewFiles groups multi-file diffs by target file", () => {
	const files = summarizeChatWriteReviewFiles({
		filePath: "/Users/me/Vault/A.md, /Users/me/Vault/B.md",
		diff: [
			"diff --git a/A.md b/A.md",
			"--- a/A.md",
			"+++ b/A.md",
			"@@ -1 +1 @@",
			"-old",
			"+new",
			"diff --git a/B.md b/B.md",
			"--- /dev/null",
			"+++ b/B.md",
			"@@ -0,0 +1,2 @@",
			"+# Fresh",
			"+note"
		].join("\n")
	});

	assert.deepEqual(files, [
		{
			path: "A.md",
			kind: "modified",
			oldPath: "A.md",
			newPath: "A.md",
			additions: ["new"],
			removals: ["old"]
		},
		{
			path: "B.md",
			kind: "created",
			newPath: "B.md",
			additions: ["# Fresh", "note"],
			removals: []
		}
	]);
});

test("buildChatWriteReviewOverview returns totals and folds extra files", () => {
	const overview = buildChatWriteReviewOverview(
		{
			filePath: "/Users/me/Vault/A.md, /Users/me/Vault/B.md, /Users/me/Vault/C.md, /Users/me/Vault/D.md",
			diff: [
				"diff --git a/A.md b/A.md",
				"--- a/A.md",
				"+++ b/A.md",
				"@@ -1 +1,2 @@",
				"-old",
				"+new",
				"+line",
				"diff --git a/B.md b/B.md",
				"--- a/B.md",
				"+++ b/B.md",
				"@@ -1 +1 @@",
				"-x",
				"+y",
				"diff --git a/C.md b/C.md",
				"--- /dev/null",
				"+++ b/C.md",
				"@@ -0,0 +1 @@",
				"+fresh",
				"diff --git a/D.md b/D.md",
				"--- a/D.md",
				"+++ b/D.md",
				"@@ -1 +0,0 @@",
				"-gone"
			].join("\n")
		},
		3
	);

	assert.equal(overview.fileCount, 4);
	assert.equal(overview.additions, 4);
	assert.equal(overview.removals, 3);
	assert.deepEqual(overview.visibleFiles.map((file) => file.path), ["A.md", "B.md", "C.md"]);
	assert.deepEqual(overview.hiddenFiles.map((file) => file.path), ["D.md"]);
});

test("summarizeChatWriteReviewFiles merges repeated writes to the same file", () => {
	const files = summarizeChatWriteReviewFiles({
		filePath: "/Users/me/Vault/A.md",
		diff: [
			"diff --git a/A.md b/A.md",
			"--- a/A.md",
			"+++ b/A.md",
			"@@ -1 +1 @@",
			"-old 1",
			"+new 1",
			"diff --git a/A.md b/A.md",
			"--- a/A.md",
			"+++ b/A.md",
			"@@ -3 +3 @@",
			"-old 2",
			"+new 2"
		].join("\n")
	});

	assert.equal(files.length, 1);
	assert.deepEqual(files[0], {
		path: "A.md",
		kind: "modified",
		oldPath: "A.md",
		newPath: "A.md",
		additions: ["new 1", "new 2"],
		removals: ["old 1", "old 2"]
	});
});

test("formatChatWriteReviewFileLabel prefers note title over long absolute path", () => {
	assert.deepEqual(formatChatWriteReviewFileLabel("/Users/me/Vault/Folder/My Note.md"), {
		title: "My Note",
		detail: ".../Vault/Folder/My Note.md"
	});
	assert.deepEqual(formatChatWriteReviewFileLabel("Inbox/Quick Capture.md"), {
		title: "Quick Capture",
		detail: "Inbox/Quick Capture.md"
	});
	assert.deepEqual(formatChatWriteReviewFileLabel("JustName.md"), {
		title: "JustName"
	});
});

test("formatChatWriteReviewLineDisplay keeps the row focused on the filename", () => {
	assert.deepEqual(formatChatWriteReviewLineDisplay("/Users/me/Vault/Folder/My Note.md"), {
		title: "My Note",
		detail: ".../Vault/Folder/My Note.md"
	});
});

test("resolveChatWriteReviewTargetPath matches absolute bridge paths to vault-relative markdown files", () => {
	assert.equal(
		resolveChatWriteReviewTargetPath(
			"/Users/me/Vault/Folder/Demo Note.md",
			["Inbox/Other.md", "Folder/Demo Note.md"],
			"/Users/me/Vault"
		),
		"Folder/Demo Note.md"
	);
	assert.equal(resolveChatWriteReviewTargetPath("/Users/me/Vault/Folder/Demo Note.md", ["Demo Note.md"]), null);
});

test("resolveChatWriteReviewTargetPath matches top-level notes when vault root is known", () => {
	assert.equal(
		resolveChatWriteReviewTargetPath(
			"/Users/me/Vault/Demo Note.md",
			["Demo Note.md", "Folder/Other.md"],
			"/Users/me/Vault"
		),
		"Demo Note.md"
	);
});

test("shouldAutoRevealWriteReviewTarget is only true for new markdown write targets", () => {
	assert.equal(shouldAutoRevealWriteReviewTarget("/Users/me/Vault/New Note.md", null), true);
	assert.equal(shouldAutoRevealWriteReviewTarget("/Users/me/Vault/Old Note.md", "Old Note.md"), false);
	assert.equal(shouldAutoRevealWriteReviewTarget("/Users/me/Vault/image.png", null), false);
});

test("listChatWriteReviewMarkdownTargets includes created markdown files from multi-file patch diffs", () => {
	const targets = listChatWriteReviewMarkdownTargets(
		{
			filePath: "/Users/me/Vault/Current.md, /Users/me/Vault/Ideas/New Note.md",
			diff: [
				"--- a//Users/me/Vault/Current.md",
				"+++ b//Users/me/Vault/Current.md",
				"@@ -1 +1 @@",
				"-旧内容",
				"+新内容",
				"--- /dev/null",
				"+++ b//Users/me/Vault/Ideas/New Note.md",
				"@@ -0,0 +1,2 @@",
				"+# New Note",
				"+"
			].join("\n")
		},
		["Current.md"],
		"/Users/me/Vault"
	);

	assert.deepEqual(targets, ["Current.md", "Ideas/New Note.md"]);
});

test("buildChatWriteReviewAdditionMarkdown preserves markdown without diff prefixes", () => {
	assert.equal(
		buildChatWriteReviewAdditionMarkdown({
			afterLine: 2,
			lines: ["## 新标题", "", "- **重点**：保留渲染", "> 引用"]
		}),
		"## 新标题\n\n- **重点**：保留渲染\n> 引用"
	);
});

test("buildChatWriteReviewStreamFrame reveals additions progressively inside the source note", () => {
	const frame = buildChatWriteReviewStreamFrame(
		{
			filePath: "demo.md",
			firstLine: 1,
			deletions: [],
			additions: [
				{ afterLine: 1, lines: ["alpha", "beta"] },
				{ afterLine: 4, lines: ["gamma"] }
			]
		},
		7
	);

	assert.equal(frame.activeAdditionIndex, 0);
	assert.equal(frame.activeLineIndex, 1);
	assert.equal(frame.activeDocumentLine, 3);
	assert.equal(frame.isComplete, false);
	assert.deepEqual(frame.additions[0]?.visibleLines, ["alpha", "b"]);
	assert.equal(frame.additions[0]?.isActive, true);
	assert.equal(frame.additions[0]?.isComplete, false);
	assert.deepEqual(frame.additions[1]?.visibleLines, []);
});

test("advanceChatWriteReviewVisibleCharacters stops at the full added source length", () => {
	const preview = {
		filePath: "demo.md",
		firstLine: 0,
		deletions: [],
		additions: [{ afterLine: 0, lines: ["ab", "cd"] }]
	};

	assert.equal(getChatWriteReviewTotalAddedCharacters(preview), 5);
	assert.equal(advanceChatWriteReviewVisibleCharacters(preview, 0, 3), 3);
	assert.equal(advanceChatWriteReviewVisibleCharacters(preview, 3, 3), 5);
	assert.equal(buildChatWriteReviewStreamFrame(preview, 5).isComplete, true);
});

test("buildChatWriteReviewDocumentFrame applies deletions and progressively inserts visible additions", () => {
	const preview = {
		filePath: "demo.md",
		firstLine: 0,
		deletions: [{ fromLine: 1, toLine: 1 }],
		additions: [{ afterLine: 1, lines: ["new line", "tail"] }]
	};
	const frame = buildChatWriteReviewDocumentFrame(preview, ["keep", "old line", "after"].join("\n"), 10);

	assert.equal(frame.text, ["keep", "new line", "t", "after"].join("\n"));
	assert.equal(frame.activeOffset, "keep\nnew line\nt".length);
	assert.equal(frame.isComplete, false);
	assert.equal(buildChatWriteReviewDocumentFrame(preview, ["keep", "old line", "after"].join("\n"), 13).text, [
		"keep",
		"new line",
		"tail",
		"after"
	].join("\n"));
});

test("buildChatWriteReviewRenderedMarkdownPreview returns concatenated markdown additions for rendering", () => {
	const preview = {
		filePath: "demo.md",
		firstLine: 0,
		deletions: [],
		additions: [
			{
				afterLine: 0,
				lines: ["## 新标题", "", "- **重点**", "> 引用"]
			}
		]
	};

	assert.deepEqual(buildChatWriteReviewRenderedMarkdownPreview(preview), {
		text: ["## 新标题", "", "- **重点**", "> 引用"].join("\n"),
		isPartial: false
	});
});

test("buildChatWriteReviewRenderedMarkdownPreview respects streaming visibility", () => {
	const preview = {
		filePath: "demo.md",
		firstLine: 0,
		deletions: [],
		additions: [{ afterLine: 0, lines: ["## 新标题", "", "- **重点**"] }]
	};

	assert.deepEqual(buildChatWriteReviewRenderedMarkdownPreview(preview, 5), {
		text: "## \u65b0\u6807",
		isPartial: true
	});
});

test("buildChatWriteReviewRenderedMarkdownPreview preserves authored blank lines", () => {
	const preview = {
		filePath: "demo.md",
		firstLine: 0,
		deletions: [],
		additions: [{ afterLine: 0, lines: ["# Title", "", "", "- item"] }]
	};

	assert.deepEqual(buildChatWriteReviewRenderedMarkdownPreview(preview), {
		text: "# Title\n\n\n- item",
		isPartial: false
	});
});
