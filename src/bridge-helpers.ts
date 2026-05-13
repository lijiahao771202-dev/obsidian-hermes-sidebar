export interface PickBridgeFinalTextInput {
	finalText?: string;
	streamedText?: string;
	progressTexts?: string[];
	reasoningPreviews?: string[];
	messageContents?: string[];
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
