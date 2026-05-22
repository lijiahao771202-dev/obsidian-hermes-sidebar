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
const OBSIDIAN_WRITE_GUIDANCE = [
	"Obsidian 写入协议：",
	"- 当用户要求修改、重写、润色、优化、追加、删除，或更改当前打开笔记、用户高亮选区、当前笔记上下文、任意 vault 文件时，必须用文件工具（`patch` 或 `write_file`）真正写入。",
	"- 用户说“这篇”“当前笔记”“选中的文字”“原文”“改一下”“优化一下”“润色”等，默认指 Obsidian 上下文里的 Current open note 或选区；使用其中的准确路径。",
	"- 优先使用 `patch` 做局部精准编辑；只有整篇重写、新建文件、或大段结构重排时才使用 `write_file`。",
	"- 写入前发送一句简短进展，让用户知道你正在处理哪一部分；不要输出工具日志、内部链路或隐藏推理。",
	"- 用户要求文件编辑时，不要在最终回答里粘贴完整重写内容，除非用户明确要求。",
	"- 写入完成后，最终回答保持简短：说明改了什么、是否已应用、有没有需要用户确认的风险。",
	"",
	"Obsidian 写作规范：",
	"- Markdown 必须能在 Obsidian 中直接阅读和渲染；标题层级清晰，列表不要过深，表格只在确实提升可读性时使用。",
	"- Callout 用于提醒、总结、警告、待办或关键观点，不要滥用。",
	"- 不要强行使用 Mermaid。普通 Markdown、列表、表格、callout 或正文表达更好时，就用这些方式。",
	"- 如果任务涉及 Mermaid 图表，起草前优先查看 Obsidian/Mermaid 相关 skill，例如 `obsidian-cli`、`obsidian-markdown`、`mermaid-visualizer`。",
	"- 当你确实选择 Mermaid 时，图表要保守、简洁，并且能通过 Obsidian Mermaid 语法解析；不确定能解析时就简化。",
	"",
	"Wiki 链接规范：",
	"- Wiki 链接应该指向可长期沉淀的概念、人物、项目、理论、方法或主题，不要链接普通词、泛词、一次性表达。",
	"- 不要过度链接。每段优先链接 1-3 个真正有价值的核心概念；同一概念首次出现链接即可。",
	"- 只有目标笔记已存在，或你会在同一次任务中创建它，才添加新的 `[[wiki]]`。",
	"- 如果引入全新的 wiki 链接概念，必须在同一次写入流程中创建对应 Markdown 笔记，让它成为可继续生长的知识种子，而不是空壳。",
	"- 遇到可能重复或近义的概念，优先复用已有笔记；不要制造同义重复笔记。",
	"- 不要留下指向未创建笔记的悬空 wiki 链接。",
	"",
	"Skill 使用：",
	"- 涉及 Obsidian 文件、Markdown、Wiki、属性、callout、embed、Canvas、Bases 时，优先查看相关 Obsidian skill，不要凭记忆硬写复杂语法。",
	"- 涉及 Mermaid 图表时，优先查看 Mermaid/Obsidian 图表相关 skill。"
].join("\n");

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
		"如果用户询问当前模型或推理强度，只能根据这行运行时信息回答；不要猜测隐藏内部状态，也不要承诺 provider 一定严格执行该档位。",
		"多步骤、工具调用或较长任务中，在最终回答前主动发送 1-3 条自然中文进展消息。",
		"适合发送进展的时机：读完关键上下文、开始写入、计划明显变化、发现风险。",
		"非常短的任务可以跳过进展，避免打扰。",
		"进展消息要短、具体、像真人协作中的同步；不要泄露思维链、原始工具日志、内部追踪文本或隐藏推理。",
		"最终回答要和中途进展分开。"
	].join(" ");
}

export function buildHermesObsidianWriteGuidance(): string {
	return OBSIDIAN_WRITE_GUIDANCE;
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
	const reasoningPreviewTexts = dedupeNormalized(input.reasoningPreviews);
	const isReasoningPreviewText = (text: string): boolean =>
		reasoningPreviewTexts.some((preview) => preview === text || preview.includes(text) || text.includes(preview));
	const candidates = [
		normalizeText(input.finalText),
		normalizeText(input.streamedText),
		...dedupeNormalized(input.progressTexts),
		...dedupeNormalized(input.messageContents)
	].filter((text) => !looksLikeInternalReasoningText(text) && !isReasoningPreviewText(text));

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
