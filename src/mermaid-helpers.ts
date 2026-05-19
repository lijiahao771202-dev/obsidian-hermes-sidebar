export interface MermaidValidationProblem {
	index: number;
	code: string;
	message: string;
}

interface MermaidRuntimeLike {
	parse?: (code: string) => Promise<unknown> | unknown;
}

type MermaidLoader = () => Promise<MermaidRuntimeLike | null | undefined>;

const MERMAID_FENCE_START = /^```mermaid\s*$/i;
const FENCE_END = /^```\s*$/;

export async function collectMermaidValidationProblems(
	markdown: string,
	loadMermaidRuntime: MermaidLoader
): Promise<MermaidValidationProblem[]> {
	const fences = extractMermaidFences(markdown);
	if (fences.length === 0) {
		return [];
	}

	const runtime = await loadMermaidRuntime();
	const parse = runtime?.parse;
	const problems: MermaidValidationProblem[] = [];

	for (const fence of fences) {
		if (!fence.closed) {
			problems.push({
				index: fence.index,
				code: fence.code,
				message: "Unclosed mermaid code fence."
			});
			continue;
		}
		if (typeof parse !== "function") {
			problems.push({
				index: fence.index,
				code: fence.code,
				message: "Mermaid runtime is unavailable."
			});
			continue;
		}
		try {
			await Promise.resolve(parse.call(runtime, fence.code));
		} catch (error) {
			problems.push({
				index: fence.index,
				code: fence.code,
				message: stringifyMermaidError(error)
			});
		}
	}

	return problems;
}

function extractMermaidFences(markdown: string): Array<{ index: number; code: string; closed: boolean }> {
	const lines = String(markdown ?? "").split("\n");
	const fences: Array<{ index: number; code: string; closed: boolean }> = [];
	let insideFence = false;
	let currentLines: string[] = [];
	let currentIndex = 0;

	for (const line of lines) {
		if (!insideFence) {
			if (MERMAID_FENCE_START.test(line.trim())) {
				insideFence = true;
				currentLines = [];
				currentIndex = fences.length;
			}
			continue;
		}

		if (FENCE_END.test(line.trim())) {
			fences.push({
				index: currentIndex,
				code: currentLines.join("\n").trim(),
				closed: true
			});
			insideFence = false;
			currentLines = [];
			continue;
		}

		currentLines.push(line);
	}

	if (insideFence) {
		fences.push({
			index: currentIndex,
			code: currentLines.join("\n").trim(),
			closed: false
		});
	}

	return fences;
}

function stringifyMermaidError(error: unknown): string {
	if (error instanceof Error) {
		return error.message.trim() || error.name;
	}
	return String(error || "Unknown Mermaid parse error");
}
