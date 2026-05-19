import * as assert from "node:assert/strict";
import { test } from "node:test";

import { collectMissingWikiLinkTargets } from "./wiki-link-helpers.ts";

test("collectMissingWikiLinkTargets strips aliases and headings, and skips existing notes and attachments", () => {
	const targets = collectMissingWikiLinkTargets({
		markdown: [
			"这里会提到 [[Alpha]]、[[Alpha|另一个叫法]] 和 [[Folder/Beta#定义]]。",
			"已经存在的 [[Existing]] 不该重复创建。",
			"![[image.png]] 和 [[附件.pdf]] 也不该被当成笔记。",
			"`[[InlineCode]]` 和 ```md\n[[CodeFence]]\n``` 都应该忽略。"
		].join("\n"),
		sourcePath: "Notes/Current.md",
		resolveExisting: (linkpath) => linkpath === "Existing",
		pickParentFolder: () => "Notes"
	});

	assert.deepEqual(targets, [
		{ linkpath: "Alpha", filePath: "Notes/Alpha.md", title: "Alpha" },
		{ linkpath: "Folder/Beta", filePath: "Folder/Beta.md", title: "Beta" }
	]);
});

test("collectMissingWikiLinkTargets keeps explicit markdown paths and uses the preferred parent for loose titles", () => {
	const targets = collectMissingWikiLinkTargets({
		markdown: "[[Projects/Plan.md]]\n[[Loose Idea]]\n[[#局部标题]]",
		sourcePath: "Areas/Source.md",
		resolveExisting: () => false,
		pickParentFolder: () => "Areas"
	});

	assert.deepEqual(targets, [
		{ linkpath: "Projects/Plan.md", filePath: "Projects/Plan.md", title: "Plan" },
		{ linkpath: "Loose Idea", filePath: "Areas/Loose Idea.md", title: "Loose Idea" }
	]);
});
