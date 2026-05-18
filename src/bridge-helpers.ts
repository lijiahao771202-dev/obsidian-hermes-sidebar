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
		noteContext?: string;
	};
}

export interface ReplayUserContentInput extends ComposeObsidianPromptInput {
	imageNames?: string[];
}

export interface ReplayAssistantActivityInput {
	toolName?: string | null;
	status?: string | null;
	preview?: string | null;
}

export interface ReplayAssistantContentInput {
	finalText: string;
	activities?: ReplayAssistantActivityInput[];
}

export interface HermesRuntimePromptInput {
	provider?: string;
	model?: string;
	reasoningEffort?: string;
}

const OBSIDIAN_CONTEXT_PREAMBLE = [
	"Use the following Obsidian context only for this turn.",
	"Stable schema:",
	"- Current open note gives the active note title and vault path when available.",
	"- User highlighted selection is exact selected text; prioritize it over nearby context.",
	"- Current note context is a nearby window from the open note.",
	"- Manual attachments are explicit note or selection attachments added by the user.",
	"Answer the user request at the end. Do not invent vault files, note titles, or wiki links."
].join("\n");
const OBSIDIAN_CONTEXT_CLAMP_MAX_CHARACTERS = 2400;
const OBSIDIAN_CONTEXT_CLAMP_HEAD_CHARACTERS = 1400;
const OBSIDIAN_CONTEXT_CLAMP_TAIL_CHARACTERS = 800;

function normalizeText(text?: string): string {
	return typeof text === "string" ? text.trim() : "";
}

export function looksLikeInternalReasoningText(text?: string): boolean {
	const value = normalizeText(text);
	if (!value) {
		return false;
	}
	const lower = value.toLowerCase();
	const markers = [
		"必须用 file 工具",
		"没有 file toolset",
		"让我看看子代理",
		"我可以给子代理",
		"让我先直接处理",
		"让我重新扫描",
		"chain-of-thought",
		"hidden reasoning"
	];

	if (markers.some((marker) => lower.includes(marker.toLowerCase()))) {
		return true;
	}

	const planningLines = value.split(/\n+/).filter((line) => line.trim());
	const firstPersonPlanningCount = planningLines.filter((line) =>
		/(^|[，。；\s])(我先|我再|我会|让我|接下来|先|然后|同时)/.test(line)
	).length;
	const toolReferenceCount = planningLines.filter((line) =>
		/(tool|工具|toolset|read_file|write_file|execute_code|terminal|file)/i.test(line)
	).length;

	return planningLines.length >= 3 && firstPersonPlanningCount >= 2 && toolReferenceCount >= 1;
}

export function buildHermesInterimGuidance(runtime?: HermesRuntimePromptInput): string {
	const runtimeProvider = normalizeText(runtime?.provider) || "unknown";
	const runtimeModel = normalizeText(runtime?.model) || "unknown";
	const runtimeReasoning = normalizeText(runtime?.reasoningEffort) || "default";

	return [
		`Current runtime: provider=${runtimeProvider}, model=${runtimeModel}, reasoning_effort=${runtimeReasoning}.`,
		"If the user asks what reasoning strength is active, answer from this Current runtime line instead of guessing from your hidden internals.",
		"For multi-step, tool-using, or longer tasks, proactively send 1-3 brief interim assistant messages to the user in natural Chinese before the final answer.",
		"Good moments include after you finish reading important context, when you begin writing, or when your plan meaningfully changes.",
		"Skip interim updates for very short tasks where they would feel noisy.",
		"Use those interim messages like real progress updates someone would actually say in chat.",
		"Keep them short, warm, and concrete.",
		"Do not reveal chain-of-thought, raw tool logs, internal trace text, or hidden reasoning.",
		"Keep the final answer separate from any interim progress updates."
	].join(" ");
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

	if (liveContext.noteContext) {
		liveBlocks.push(
			[
				"## Current note context",
				"The following text is a nearby context window from the open note. Use it together with the highlighted selection.",
				"```text",
				clampCacheFriendlyContext(liveContext.noteContext),
				"```"
			].join("\n")
		);
	}

	if (input.contexts.length === 0 && liveBlocks.length === 0) {
		return input.userText;
	}

	const contextBlocks = input.contexts
		.map((context) => {
			const label = normalizeText(context.label) || "Manual attachment";
			const content = clampCacheFriendlyContext(context.content);
			return content ? `## ${label}\n${content}` : "";
		})
		.filter(Boolean)
		.join("\n\n");
	return [
		OBSIDIAN_CONTEXT_PREAMBLE,
		"## Dynamic Obsidian context",
		...liveBlocks,
		contextBlocks,
		"## User request",
		input.userText
	]
		.filter(Boolean)
		.join("\n\n");
}

export function buildReplayUserContent(input: ReplayUserContentInput): string {
	const sections: string[] = [];
	const userText = normalizeText(input.userText);
	if (userText) {
		sections.push(`User request:\n${userText}`);
	}

	const { liveContext } = input;
	if (liveContext.noteTitle || liveContext.notePath) {
		sections.push(
			[
				"Current open note:",
				liveContext.noteTitle ? `- Title: ${liveContext.noteTitle}` : "",
				liveContext.notePath ? `- Path: ${liveContext.notePath}` : ""
			]
				.filter(Boolean)
				.join("\n")
		);
	}

	if (liveContext.selectionText) {
		sections.push(
			[
				"Highlighted selection attached:",
				liveContext.selectionText.trim()
			].join("\n")
		);
	}

	if (liveContext.noteContext) {
		sections.push(
			[
				"Nearby note context attached:",
				clampCacheFriendlyContext(liveContext.noteContext)
			].join("\n")
		);
	}

	for (const context of input.contexts) {
		const label = normalizeText(context.label) || "附加上下文";
		const content = normalizeText(context.content);
		if (!content) {
			continue;
		}
		sections.push(`Manual attachment - ${label}:\n${clampCacheFriendlyContext(content)}`);
	}

	const imageNames = (input.imageNames ?? []).map((name) => normalizeText(name)).filter(Boolean);
	if (imageNames.length > 0) {
		sections.push(`Attached images: ${imageNames.join(", ")}`);
	}

	return sections.filter(Boolean).join("\n\n");
}

function clampCacheFriendlyContext(text?: string): string {
	const value = normalizeText(text);
	if (value.length <= OBSIDIAN_CONTEXT_CLAMP_MAX_CHARACTERS) {
		return value;
	}

	const head = value.slice(0, OBSIDIAN_CONTEXT_CLAMP_HEAD_CHARACTERS).trimEnd();
	const tail = value.slice(value.length - OBSIDIAN_CONTEXT_CLAMP_TAIL_CHARACTERS).trimStart();
	const omitted = Math.max(0, value.length - OBSIDIAN_CONTEXT_CLAMP_HEAD_CHARACTERS - OBSIDIAN_CONTEXT_CLAMP_TAIL_CHARACTERS);
	return [head, `[omitted ${omitted} chars for cache-friendly context clamp]`, tail].join("\n\n");
}

export function buildReplayAssistantContent(input: ReplayAssistantContentInput): string {
	const sections: string[] = [];
	const finalText = normalizeText(input.finalText);
	if (finalText) {
		sections.push(finalText);
	}

	const recap = summarizeReplayActivities(input.activities);
	if (recap.length > 0) {
		sections.push(["Work recap:", ...recap.map((item) => `- ${item}`)].join("\n"));
	}

	return sections.filter(Boolean).join("\n\n");
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

function summarizeReplayActivities(activities?: ReplayAssistantActivityInput[]): string[] {
	if (!Array.isArray(activities) || activities.length === 0) {
		return [];
	}

	const ignoredTools = new Set(["thinking", "writer", "run.config"]);
	const seen = new Set<string>();
	const output: string[] = [];

	for (const activity of activities) {
		const toolName = normalizeText(activity.toolName ?? undefined);
		const preview = normalizeText(activity.preview ?? undefined);
		const status = normalizeText(activity.status ?? undefined).toLowerCase();
		if (!toolName || ignoredTools.has(toolName) || !preview) {
			continue;
		}
		if (status === "running") {
			continue;
		}
		const line = `${toolName}: ${preview}`;
		if (seen.has(line)) {
			continue;
		}
		seen.add(line);
		output.push(line);
		if (output.length >= 4) {
			break;
		}
	}

	return output;
}
