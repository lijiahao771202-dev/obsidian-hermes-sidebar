import * as assert from "node:assert/strict";
import { test } from "node:test";

import { collectMermaidValidationProblems } from "./mermaid-helpers.ts";

test("collectMermaidValidationProblems extracts valid mermaid fences without errors", async () => {
	const problems = await collectMermaidValidationProblems(
		[
			"# Demo",
			"```mermaid",
			"flowchart TD",
			"A[开始] --> B[结束]",
			"```"
		].join("\n"),
		async () => ({
			parse: async () => true
		})
	);

	assert.deepEqual(problems, []);
});

test("collectMermaidValidationProblems reports parser failures with fence index and readable message", async () => {
	const problems = await collectMermaidValidationProblems(
		[
			"```mermaid",
			"flowchart TD",
			"A -->",
			"```",
			"",
			"```mermaid",
			"sequenceDiagram",
			"Alice->>Bob: hi",
			"```"
		].join("\n"),
		async () => ({
			parse: async (code: string) => {
				if (code.includes("A -->")) {
					throw new Error("Parse error on line 3");
				}
				return true;
			}
		})
	);

	assert.equal(problems.length, 1);
	assert.equal(problems[0]?.index, 0);
	assert.match(problems[0]?.message ?? "", /Parse error/);
	assert.match(problems[0]?.code ?? "", /A -->/);
});

test("collectMermaidValidationProblems catches unclosed mermaid fences before parser stage", async () => {
	const problems = await collectMermaidValidationProblems(
		["```mermaid", "flowchart TD", "A --> B"].join("\n"),
		async () => ({
			parse: async () => true
		})
	);

	assert.equal(problems.length, 1);
	assert.match(problems[0]?.message ?? "", /Unclosed mermaid code fence/);
});
