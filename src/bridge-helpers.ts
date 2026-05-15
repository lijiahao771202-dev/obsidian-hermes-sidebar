export interface PickBridgeFinalTextInput {
	finalText?: string;
	streamedText?: string;
	progressTexts?: string[];
	reasoningPreviews?: string[];
	messageContents?: string[];
}

export interface ComposeObsidianPromptInput {
	userText: string;
	contexts: Array<{ label: string; content: string }>;
	liveContext: {
		noteTitle?: string;
		notePath?: string;
		selectionText?: string;
	};
}

function normalizeText(text?: string): string {
	return typeof text === "string" ? text.trim() : "";
}

export function buildTurnUserText(text: string, imageCount: number): string {
	const normalized = normalizeText(text);
	if (normalized) {
		return normalized;
	}
	if (imageCount > 1) {
		return "请帮我看看这几张图片。";
	}
	if (imageCount === 1) {
		return "请帮我看看这张图片。";
	}
	return "";
}

export function pickBridgeFinalText(input: PickBridgeFinalTextInput): string {
	const candidates = [
		normalizeText(input.finalText),
		normalizeText(input.streamedText),
		...dedupeNormalized(input.reasoningPreviews),
		...dedupeNormalized(input.progressTexts),
		...dedupeNormalized(input.messageContents)
	];

	return candidates.find(Boolean) ?? "";
}

export function composeObsidianPrompt(input: ComposeObsidianPromptInput): string {
	const liveBlocks: string[] = [];
	const { liveContext } = input;

	if (liveContext.noteTitle || liveContext.notePath) {
		liveBlocks.push(
			[
				"## Current open note",
				liveContext.noteTitle ? `Title: ${liveContext.noteTitle}` : "",
				liveContext.notePath ? `Path: ${liveContext.notePath}` : ""
			]
				.filter(Boolean)
				.join("\n")
		);
	}

	if (liveContext.selectionText) {
		liveBlocks.push(
			[
				"## User highlighted selection",
				"The following text is the exact text currently selected/highlighted by the user in Obsidian. Treat it as attached context for this turn and answer against this selected text first.",
				"```text",
				liveContext.selectionText,
				"```"
			].join("\n")
		);
	}

	if (input.contexts.length === 0 && liveBlocks.length === 0) {
		return input.userText;
	}

	const contextBlocks = input.contexts.map((context) => `## ${context.label}\n${context.content}`).join("\n\n");
	return [
		"The following Obsidian context is attached for this turn.",
		...liveBlocks,
		contextBlocks,
		"## User request",
		input.userText
	]
		.filter(Boolean)
		.join("\n\n");
}

function dedupeNormalized(items?: string[]): string[] {
	if (!Array.isArray(items) || items.length === 0) {
		return [];
	}

	const seen = new Set<string>();
	const output: string[] = [];
	for (const item of items) {
		const normalized = normalizeText(item);
		if (!normalized || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		output.push(normalized);
	}
	return output;
}
