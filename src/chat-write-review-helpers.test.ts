import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	advanceChatWriteReviewVisibleCharacters,
	buildChatWriteReviewAdditionMarkdown,
	buildChatWriteReviewDocumentFrame,
	buildChatWriteReviewInlinePreview,
	buildChatWriteReviewRenderedMarkdownPreview,
	buildChatWriteReviewStreamFrame,
	getChatWriteReviewTotalAddedCharacters,
	listChatWriteReviewMarkdownTargets,
	resolveChatWriteReviewTargetPath,
	shouldAutoRevealWriteReviewTarget
} from "./chat-write-review-helpers.ts";

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
