import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	collectMissingWikiLinkTargets,
	resolveExistingWikiLinkTarget,
	rewriteWikiLinksToResolvedTargets
} from "./wiki-link-helpers.ts";

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

test("resolveExistingWikiLinkTarget falls back to a unique long-title note or alias", () => {
	assert.deepEqual(
		resolveExistingWikiLinkTarget({
			linkpath: "福格行为模型",
			files: [
				{
					path: "心理学/福格行为模型 - 动机、能力、提示.md",
					basename: "福格行为模型 - 动机、能力、提示",
					aliases: []
				}
			]
		}),
		{
			path: "心理学/福格行为模型 - 动机、能力、提示.md",
			title: "福格行为模型 - 动机、能力、提示",
			matchedBy: "title-prefix"
		}
	);

	assert.deepEqual(
		resolveExistingWikiLinkTarget({
			linkpath: "人机协同",
			files: [
				{
					path: "计算机/AI技术/人机互补思维：不是谁替代谁，而是各取所长.md",
					basename: "人机互补思维：不是谁替代谁，而是各取所长",
					aliases: ["人机协同", "AI协同思维"]
				}
			]
		}),
		{
			path: "计算机/AI技术/人机互补思维：不是谁替代谁，而是各取所长.md",
			title: "人机互补思维：不是谁替代谁，而是各取所长",
			matchedBy: "alias-exact"
		}
	);
});

test("resolveExistingWikiLinkTarget stays unresolved when loose title is ambiguous", () => {
	assert.equal(
		resolveExistingWikiLinkTarget({
			linkpath: "框架",
			files: [
				{ path: "A/框架控制.md", basename: "框架控制", aliases: [] },
				{ path: "B/框架争夺.md", basename: "框架争夺", aliases: [] }
			]
		}),
		null
	);
});

test("rewriteWikiLinksToResolvedTargets rewrites mismatched wiki targets but leaves true missing concepts alone", () => {
	const rewritten = rewriteWikiLinksToResolvedTargets({
		markdown: [
			"这里会提到 [[福格行为模型]]、[[人机协同]] 和 [[根本不存在的概念]]。",
			"已有别名也要保留显示词：[[人机协同|这种说法]]。",
			"`[[代码里的链接]]` 不要被改。"
		].join("\n"),
		resolveReplacement: ({ linkpath }) => {
			if (linkpath === "福格行为模型") {
				return "心理学/福格行为模型 - 动机、能力、提示";
			}
			if (linkpath === "人机协同") {
				return "计算机/AI技术/人机互补思维：不是谁替代谁，而是各取所长";
			}
			return null;
		}
	});

	assert.equal(
		rewritten.markdown,
		[
			"这里会提到 [[心理学/福格行为模型 - 动机、能力、提示|福格行为模型]]、[[计算机/AI技术/人机互补思维：不是谁替代谁，而是各取所长|人机协同]] 和 [[根本不存在的概念]]。",
			"已有别名也要保留显示词：[[计算机/AI技术/人机互补思维：不是谁替代谁，而是各取所长|这种说法]]。",
			"`[[代码里的链接]]` 不要被改。"
		].join("\n")
	);
	assert.deepEqual(rewritten.rewrites, [
		{
			from: "[[福格行为模型]]",
			to: "[[心理学/福格行为模型 - 动机、能力、提示|福格行为模型]]"
		},
		{
			from: "[[人机协同]]",
			to: "[[计算机/AI技术/人机互补思维：不是谁替代谁，而是各取所长|人机协同]]"
		},
		{
			from: "[[人机协同|这种说法]]",
			to: "[[计算机/AI技术/人机互补思维：不是谁替代谁，而是各取所长|这种说法]]"
		}
	]);
});
