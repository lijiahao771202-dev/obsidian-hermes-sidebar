import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildChatWriteReviewInlinePreview,
	resolveChatWriteReviewTargetPath
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
			["Inbox/Other.md", "Folder/Demo Note.md"]
		),
		"Folder/Demo Note.md"
	);
	assert.equal(resolveChatWriteReviewTargetPath("/Users/me/Vault/Folder/Demo Note.md", ["Demo Note.md"]), null);
});
