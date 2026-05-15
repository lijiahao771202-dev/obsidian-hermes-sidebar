import type { EditorPosition } from "obsidian";

export type InlineEditActionMode = "replace" | "insert" | "note";
export type InlineEditDraftStatus = "idle" | "generating" | "ready" | "error";

export interface InlineEditAction {
	id: string;
	label: string;
	shortLabel: string;
	description: string;
	mode: InlineEditActionMode;
	keywords: string[];
}

export interface InlineEditRange {
	from: EditorPosition;
	to: EditorPosition;
	text: string;
	mode: InlineEditActionMode;
}

export interface InlineEditPromptInput {
	action: InlineEditAction;
	targetText: string;
	noteText?: string;
	noteTitle?: string;
	followUp?: string;
	currentProposal?: string;
}

export interface InlineEditDraftState {
	actionId: string;
	filePath: string;
	fromOffset: number;
	toOffset: number;
	originalText: string;
	proposedText: string;
	status: InlineEditDraftStatus;
	requestId: number;
}

export interface InlineEditDraftTransition {
	state: InlineEditDraftState | null;
	reason?: string;
}

export const INLINE_EDIT_ACTIONS: InlineEditAction[] = [
	{
		id: "polish",
		label: "润色",
		shortLabel: "润色",
		description: "保持原意，让文字更自然高级。",
		mode: "replace",
		keywords: ["润色", "polish", "rewrite", "改写"]
	},
	{
		id: "clarify",
		label: "改清楚",
		shortLabel: "清楚",
		description: "消除含混表达，让逻辑更直白。",
		mode: "replace",
		keywords: ["清楚", "clarify", "逻辑", "表达"]
	},
	{
		id: "shorten",
		label: "改短",
		shortLabel: "改短",
		description: "压缩冗余，保留重点。",
		mode: "replace",
		keywords: ["短", "short", "精简", "压缩"]
	},
	{
		id: "translate",
		label: "翻译",
		shortLabel: "翻译",
		description: "在中英文之间自然翻译。",
		mode: "replace",
		keywords: ["翻译", "translate", "english", "中文"]
	},
	{
		id: "wiki-link",
		label: "加入 Wiki 链接",
		shortLabel: "Wiki",
		description: "自然穿插 Obsidian Wiki 链接。",
		mode: "replace",
		keywords: ["wiki", "链接", "双链", "link"]
	},
	{
		id: "continue",
		label: "续写",
		shortLabel: "续写",
		description: "沿着当前语气继续写下去。",
		mode: "insert",
		keywords: ["续写", "continue", "接着写"]
	},
	{
		id: "summarize",
		label: "总结",
		shortLabel: "总结",
		description: "提炼成可直接放入笔记的摘要。",
		mode: "insert",
		keywords: ["总结", "summary", "摘要"]
	},
	{
		id: "outline",
		label: "生成大纲",
		shortLabel: "大纲",
		description: "根据当前笔记生成结构化大纲。",
		mode: "note",
		keywords: ["大纲", "outline", "结构"]
	},
	{
		id: "title",
		label: "提炼标题",
		shortLabel: "标题",
		description: "生成几个可插入的标题候选。",
		mode: "note",
		keywords: ["标题", "title", "命名"]
	}
];

export function getInlineEditAction(actionId: string): InlineEditAction | undefined {
	return INLINE_EDIT_ACTIONS.find((action) => action.id === actionId);
}

export function parseSlashTrigger(line: string, cursorCh: number): { query: string; fromCh: number } | null {
	const beforeCursor = line.slice(0, cursorCh);
	const match = beforeCursor.match(/(?:^|\s)\/([\p{L}\p{N}\p{Script=Han}_-]*)$/u);
	if (!match || match.index === undefined) {
		return null;
	}
	const prefix = beforeCursor.slice(0, match.index + match[0].lastIndexOf("/"));
	if (prefix.endsWith("http:/") || prefix.endsWith("https:/")) {
		return null;
	}
	return {
		query: match[1] ?? "",
		fromCh: match.index + match[0].lastIndexOf("/")
	};
}

export function filterInlineEditActions(query: string, actions = INLINE_EDIT_ACTIONS): InlineEditAction[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) {
		return actions;
	}
	return actions.filter((action) =>
		[action.label, action.shortLabel, action.description, ...action.keywords]
			.join(" ")
			.toLowerCase()
			.includes(normalized)
	);
}

export function isContinuousSelection(
	selections: Array<{ anchor: EditorPosition; head: EditorPosition }>
): boolean {
	return selections.length === 1 && comparePositions(selections[0].anchor, selections[0].head) !== 0;
}

export function getParagraphRangeAtCursor(
	lines: string[],
	cursor: EditorPosition
): { from: EditorPosition; to: EditorPosition; text: string } {
	const boundedLine = Math.min(Math.max(cursor.line, 0), Math.max(lines.length - 1, 0));
	let startLine = boundedLine;
	let endLine = boundedLine;

	while (startLine > 0 && lines[startLine - 1]?.trim()) {
		startLine -= 1;
	}
	while (endLine < lines.length - 1 && lines[endLine + 1]?.trim()) {
		endLine += 1;
	}

	const text = lines.slice(startLine, endLine + 1).join("\n");
	return {
		from: { line: startLine, ch: 0 },
		to: { line: endLine, ch: lines[endLine]?.length ?? 0 },
		text
	};
}

export function buildInlineEditPrompt(input: InlineEditPromptInput): string {
	const instruction = getActionInstruction(input.action);
	const targetLabel = input.action.mode === "note" ? "当前笔记" : "目标文本";
	const parts = [
		"你是 Obsidian 里的 Hermes inline edit。只返回可以直接写入笔记的 Markdown 正文。",
		"不要寒暄，不要解释，不要包裹代码块，不要添加“以下是”等前缀。",
		instruction,
		input.noteTitle ? `笔记标题：${input.noteTitle}` : "",
		input.noteText ? `## 当前笔记\n${input.noteText}` : "",
		`## ${targetLabel}\n${input.targetText || "(光标位置，无选区)"}`,
		input.currentProposal ? `## 当前候选稿\n${input.currentProposal}` : "",
		input.followUp ? `## 追问要求\n${input.followUp}` : ""
	].filter(Boolean);
	return parts.join("\n\n");
}

export function transitionInlineDraft(
	draft: InlineEditDraftState,
	event: "ready" | "error" | "cancel",
	payload: { requestId?: number; proposedText?: string; message?: string } = {}
): InlineEditDraftTransition {
	if (event === "cancel") {
		return { state: null, reason: payload.message };
	}
	if (payload.requestId !== undefined && payload.requestId !== draft.requestId) {
		return { state: draft, reason: "stale-request" };
	}
	if (event === "error") {
		return {
			state: { ...draft, status: "error" },
			reason: payload.message
		};
	}
	return {
		state: {
			...draft,
			status: "ready",
			proposedText: payload.proposedText ?? draft.proposedText
		}
	};
}

export function comparePositions(left: EditorPosition, right: EditorPosition): number {
	if (left.line !== right.line) {
		return left.line - right.line;
	}
	return left.ch - right.ch;
}

function getActionInstruction(action: InlineEditAction): string {
	switch (action.id) {
		case "polish":
			return "任务：润色目标文本，保持原意和信息密度，让表达更自然、有质感。";
		case "clarify":
			return "任务：把目标文本改得更清楚，补足必要连接词，去掉含混和绕弯。";
		case "shorten":
			return "任务：压缩目标文本，删掉重复和空话，但保留核心意思。";
		case "translate":
			return "任务：翻译目标文本。中文翻成自然英文，英文翻成自然中文。";
		case "wiki-link":
			return "任务：在目标文本中自然穿插 Obsidian Wiki 链接，格式使用 [[概念]]，不要为了链接而破坏句子。";
		case "continue":
			return "任务：沿着目标文本或光标前上下文续写一小段，语气和结构保持一致。";
		case "summarize":
			return "任务：把目标文本或当前段落总结成适合插入笔记的 Markdown 摘要。";
		case "outline":
			return "任务：根据当前笔记生成结构化 Markdown 大纲，只输出大纲正文。";
		case "title":
			return "任务：根据当前笔记提炼 5 个标题候选，用 Markdown 列表输出，不要重命名文件。";
		default:
			return `任务：${action.description}`;
	}
}
