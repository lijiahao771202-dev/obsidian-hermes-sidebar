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
	sourceText?: string;
	noteText?: string;
	noteContext?: string;
	noteTitle?: string;
	vaultNoteTitles?: string[];
	customInstruction?: string;
	followUp?: string;
	currentProposal?: string;
}

export type SelectionSourceMode = "source" | "preview";

export interface SelectionContextWindowInput {
	noteText: string;
	selectedText?: string;
	fromOffset?: number;
	toOffset?: number;
	preferredOffset?: number;
	mode?: SelectionSourceMode;
	windowLines?: number;
	maxCharacters?: number;
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

export interface InlineEditSourceRange {
	fromOffset: number;
	toOffset: number;
	sourceText: string;
	targetText: string;
	kind: "exact" | "line-span" | "table-rows";
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
		id: "format",
		label: "格式优化",
		shortLabel: "格式",
		description: "整理成更好看的 Obsidian Markdown。",
		mode: "replace",
		keywords: ["格式", "markdown", "排版", "美化", "好看"]
	},
	{
		id: "html",
		label: "HTML",
		shortLabel: "HTML",
		description: "转成 Obsidian 可直接使用的 HTML。",
		mode: "replace",
		keywords: ["html", "html化", "标签", "富文本"]
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
		description: "只链接知识库里真实存在的笔记。",
		mode: "replace",
		keywords: ["wiki", "链接", "双链", "link"]
	},
	{
		id: "custom",
		label: "自定义提问",
		shortLabel: "自定义",
		description: "直接写你的要求，让 Hermes 按要求修改。",
		mode: "replace",
		keywords: ["自定义", "custom", "提问", "要求"]
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

export function getInlineEditToolbarActions(actions = INLINE_EDIT_ACTIONS): InlineEditAction[] {
	const toolbarIds = new Set(["polish", "format", "html", "shorten", "wiki-link", "custom"]);
	return actions.filter((action) => toolbarIds.has(action.id));
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

export function selectVaultNoteTitlesForWikiPrompt(input: {
	titles: string[];
	targetText: string;
	noteTitle?: string;
	limit?: number;
}): string[] {
	const normalizedTarget = normalizeForSearch(input.targetText);
	const normalizedNoteTitle = normalizeForSearch(input.noteTitle ?? "");
	const scored = input.titles
		.map((title, index) => {
			const normalizedTitle = normalizeForSearch(title);
			let score = 0;
			if (normalizedTitle && normalizedTarget.includes(normalizedTitle)) {
				score += 1000;
			}
			if (normalizedTitle && normalizedNoteTitle.includes(normalizedTitle)) {
				score += 400;
			}
			for (const char of Array.from(normalizedTitle)) {
				if (normalizedTarget.includes(char)) {
					score += 1;
				}
			}
			return { title, index, score };
		})
		.sort((left, right) => right.score - left.score || left.index - right.index);
	return scored.slice(0, input.limit ?? 80).map((item) => item.title);
}

export function findInlineEditSourceRange(
	noteText: string,
	selectedText: string,
	preferredOffset = 0
): InlineEditSourceRange | null {
	const targetText = normalizeSelectedText(selectedText);
	if (!targetText) {
		return null;
	}

	const exactOffset = findClosestIndex(noteText, targetText, preferredOffset);
	if (exactOffset !== -1) {
		const exactTableRange = expandTableRange(noteText, exactOffset, exactOffset + targetText.length);
		if (exactTableRange) {
			return {
				fromOffset: exactTableRange.fromOffset,
				toOffset: exactTableRange.toOffset,
				sourceText: noteText.slice(exactTableRange.fromOffset, exactTableRange.toOffset),
				targetText,
				kind: "table-rows"
			};
		}
		return {
			fromOffset: exactOffset,
			toOffset: exactOffset + targetText.length,
			sourceText: noteText.slice(exactOffset, exactOffset + targetText.length),
			targetText,
			kind: "exact"
		};
	}

	const chunks = targetText
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (!chunks.length) {
		return null;
	}

	let searchOffset = Math.max(0, Math.min(preferredOffset, noteText.length));
	let firstMatch = -1;
	let lastMatchEnd = -1;
	for (const chunk of chunks) {
		let match = noteText.indexOf(chunk, searchOffset);
		if (match === -1 && searchOffset > 0) {
			match = noteText.indexOf(chunk);
		}
		if (match === -1) {
			return null;
		}
		if (firstMatch === -1) {
			firstMatch = match;
		}
		lastMatchEnd = match + chunk.length;
		searchOffset = lastMatchEnd;
	}

	const fromOffset = findLineStart(noteText, firstMatch);
	const toOffset = findLineEnd(noteText, lastMatchEnd);
	const tableRange = expandTableRange(noteText, fromOffset, toOffset);
	if (tableRange) {
		return {
			fromOffset: tableRange.fromOffset,
			toOffset: tableRange.toOffset,
			sourceText: noteText.slice(tableRange.fromOffset, tableRange.toOffset),
			targetText,
			kind: "table-rows"
		};
	}
	return {
		fromOffset,
		toOffset,
		sourceText: noteText.slice(fromOffset, toOffset),
		targetText,
		kind: "line-span"
	};
}

export function getInlineEditDraftOriginalText(input: { targetText: string; sourceText?: string }): string {
	if (input.sourceText && input.sourceText !== input.targetText) {
		return input.sourceText;
	}
	return input.targetText;
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
	const wikiTitles = input.action.id === "wiki-link" ? formatWikiTitleList(input.vaultNoteTitles ?? []) : "";
	const tableInstruction =
		input.sourceText && isMarkdownTableSource(input.sourceText)
			? "这是 Markdown 表格源码范围。返回可以直接替换该范围的 Markdown 表格源码；保持表格结构有效，包含必要的表头和分隔行，不要输出解释。"
			: "";
	const parts = [
		input.action.id === "html"
			? "你是 Obsidian 里的 Hermes inline edit。只返回可以直接写入笔记的 HTML 正文。"
			: "你是 Obsidian 里的 Hermes inline edit。只返回可以直接写入笔记的 Markdown 正文。",
		"不要寒暄，不要解释，不要包裹代码块，不要添加“以下是”等前缀。",
		instruction,
		tableInstruction,
		wikiTitles ? `## 可用 Wiki 笔记标题\n${wikiTitles}` : "",
		input.noteTitle ? `笔记标题：${input.noteTitle}` : "",
		input.noteContext ? `## 当前笔记上下文\n${input.noteContext}` : "",
		input.noteText ? `## 当前笔记\n${input.noteText}` : "",
		input.sourceText && input.sourceText !== input.targetText ? `## 原始 Markdown 源码范围\n${input.sourceText}` : "",
		`## ${targetLabel}\n${input.targetText || "(光标位置，无选区)"}`,
		input.customInstruction ? `## 用户自定义要求\n${input.customInstruction}` : "",
		input.currentProposal ? `## 当前候选稿\n${input.currentProposal}` : "",
		input.followUp ? `## 追问要求\n${input.followUp}` : ""
	].filter(Boolean);
	return parts.join("\n\n");
}

export function resolveSelectionSourceRange(
	noteText: string,
	selectedText: string,
	preferredOffset = 0,
	mode: SelectionSourceMode = "source"
): InlineEditSourceRange | null {
	const exactRange = findInlineEditSourceRange(noteText, selectedText, preferredOffset);
	if (mode === "source") {
		return exactRange;
	}
	if (exactRange) {
		const expandedRange = expandPreviewSourceRange(noteText, exactRange.fromOffset, exactRange.toOffset);
		const tableRange = expandTableRange(noteText, expandedRange.fromOffset, expandedRange.toOffset);
		if (tableRange) {
			return {
				fromOffset: tableRange.fromOffset,
				toOffset: tableRange.toOffset,
				sourceText: noteText.slice(tableRange.fromOffset, tableRange.toOffset),
				targetText: normalizeSelectedText(selectedText),
				kind: "table-rows"
			};
		}
		return {
			fromOffset: expandedRange.fromOffset,
			toOffset: expandedRange.toOffset,
			sourceText: noteText.slice(expandedRange.fromOffset, expandedRange.toOffset),
			targetText: normalizeSelectedText(selectedText),
			kind: exactRange.kind
		};
	}
	return findPreviewSelectionSourceRange(noteText, selectedText, preferredOffset);
}

export function buildSelectionContextWindow(input: SelectionContextWindowInput): string {
	const noteText = input.noteText.trim();
	if (!noteText) {
		return "";
	}

	const resolvedRange =
		typeof input.fromOffset === "number" && typeof input.toOffset === "number"
			? {
					fromOffset: input.fromOffset,
					toOffset: input.toOffset
				}
			: input.selectedText
				? resolveSelectionSourceRange(
						noteText,
						input.selectedText,
						input.preferredOffset ?? 0,
						input.mode ?? "source"
					)
				: null;

	if (!resolvedRange) {
		return trimContextSnippet(noteText, input.maxCharacters ?? 1800);
	}

	return extractContextWindow(noteText, resolvedRange.fromOffset, resolvedRange.toOffset, {
		windowLines: input.windowLines ?? 6,
		maxCharacters: input.maxCharacters ?? 1800
	});
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
		case "format":
			return "任务：只整理目标文本的格式和结构，保留原意，不要改内容，尽量不改语义。优先修复 Markdown 排版、标题、列表、表格、callout 和 Mermaid 语法，让它更适合 Obsidian 阅读。";
		case "html":
			return "任务：把目标文本转成 Obsidian 可直接使用的纯 HTML。只输出 HTML 标签和文本，不要混入 Markdown，不要解释。";
		case "clarify":
			return "任务：把目标文本改得更清楚，补足必要连接词，去掉含混和绕弯。";
		case "shorten":
			return "任务：压缩目标文本，删掉重复和空话，但保留核心意思。";
		case "translate":
			return "任务：翻译目标文本。中文翻成自然英文，英文翻成自然中文。";
		case "wiki-link":
			return "任务：在目标文本中自然穿插 Obsidian Wiki 链接。只能使用下方真实存在的笔记标题，格式必须是 [[真实笔记标题]]；不要创造列表外的新链接。没有合适笔记时不要添加 Wiki 链接。";
		case "custom":
			return "任务：严格按用户自定义要求处理目标文本；输出必须是可直接写入笔记的 Markdown 正文。";
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

function normalizeForSearch(value: string): string {
	return value.toLowerCase().replace(/\s+/g, "");
}

function normalizeSelectedText(value: string): string {
	return value.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trim();
}

function findClosestIndex(source: string, target: string, preferredOffset: number): number {
	let best = -1;
	let bestDistance = Number.POSITIVE_INFINITY;
	let index = source.indexOf(target);
	while (index !== -1) {
		const distance = Math.abs(index - preferredOffset);
		if (distance < bestDistance) {
			best = index;
			bestDistance = distance;
		}
		index = source.indexOf(target, index + target.length);
	}
	return best;
}

function findLineStart(source: string, offset: number): number {
	const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1));
	return lineStart === -1 ? 0 : lineStart + 1;
}

function findLineEnd(source: string, offset: number): number {
	const lineEnd = source.indexOf("\n", offset);
	return lineEnd === -1 ? source.length : lineEnd;
}

function formatWikiTitleList(titles: string[]): string {
	if (titles.length === 0) {
		return "- 没有可用标题。此时不要添加任何 Wiki 链接。";
	}
	return titles.map((title) => `- [[${title}]]`).join("\n");
}

function isMarkdownTableSource(value: string): boolean {
	const lines = value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	return lines.some(isLikelyMarkdownTableLine);
}

function expandTableRange(source: string, fromOffset: number, toOffset: number): { fromOffset: number; toOffset: number } | null {
	const lines = source.split("\n");
	const starts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		starts.push(offset);
		offset += line.length + 1;
	}
	const startLine = getLineIndexForOffset(starts, fromOffset);
	const endLine = getLineIndexForOffset(starts, Math.max(fromOffset, toOffset - 1));
	const selectedLines = lines.slice(startLine, endLine + 1);
	if (!selectedLines.some(isLikelyMarkdownTableLine)) {
		return null;
	}

	let tableStart = startLine;
	let tableEnd = endLine;
	while (tableStart > 0 && isLikelyMarkdownTableLine(lines[tableStart - 1])) {
		tableStart -= 1;
	}
	while (tableEnd < lines.length - 1 && isLikelyMarkdownTableLine(lines[tableEnd + 1])) {
		tableEnd += 1;
	}

	const rangeStart = starts[tableStart] ?? fromOffset;
	const lastLineStart = starts[tableEnd] ?? toOffset;
	return {
		fromOffset: rangeStart,
		toOffset: lastLineStart + (lines[tableEnd]?.length ?? 0)
	};
}

function getLineIndexForOffset(starts: number[], offset: number): number {
	let line = 0;
	for (let index = 0; index < starts.length; index += 1) {
		if (starts[index] <= offset) {
			line = index;
		} else {
			break;
		}
	}
	return line;
}

function isLikelyMarkdownTableLine(line: string): boolean {
	const trimmed = line.trim();
	if (!trimmed.includes("|")) {
		return false;
	}
	const cells = trimmed.split("|").map((cell) => cell.trim());
	return cells.filter(Boolean).length >= 2;
}

function findPreviewSelectionSourceRange(
	noteText: string,
	selectedText: string,
	preferredOffset = 0
): InlineEditSourceRange | null {
	const targetText = normalizeSelectionSearchText(selectedText);
	const displayText = normalizeSelectedText(selectedText);
	if (!targetText) {
		return null;
	}

	const rendered = buildRenderedSelectionIndex(noteText);
	const renderedIndex = findClosestRenderedIndex(rendered.text, targetText, preferredOffset, rendered.sourceOffsets);
	if (renderedIndex === null) {
		return null;
	}

	const fromOffset = rendered.sourceOffsets[renderedIndex] ?? 0;
	const toRenderedIndex = renderedIndex + targetText.length - 1;
	const toOffset = (rendered.sourceOffsets[toRenderedIndex] ?? fromOffset) + 1;
	const expandedRange = expandPreviewSourceRange(noteText, fromOffset, toOffset);
	const tableRange = expandTableRange(noteText, expandedRange.fromOffset, expandedRange.toOffset);
	if (tableRange) {
		return {
			fromOffset: tableRange.fromOffset,
			toOffset: tableRange.toOffset,
			sourceText: noteText.slice(tableRange.fromOffset, tableRange.toOffset),
			targetText: displayText,
			kind: "table-rows"
		};
	}

	return {
		fromOffset: expandedRange.fromOffset,
		toOffset: expandedRange.toOffset,
		sourceText: noteText.slice(expandedRange.fromOffset, expandedRange.toOffset),
		targetText: displayText,
		kind: "line-span"
	};
}

function expandPreviewSourceRange(
	noteText: string,
	fromOffset: number,
	toOffset: number
): { fromOffset: number; toOffset: number } {
	const currentLineStart = findLineStart(noteText, fromOffset);
	const currentLineEnd = findLineEnd(noteText, toOffset);
	const lineText = noteText.slice(currentLineStart, currentLineEnd);
	const localFrom = Math.max(0, fromOffset - currentLineStart);
	const localTo = Math.max(0, toOffset - currentLineStart);

	const wikiStart = lineText.lastIndexOf("[[", localFrom);
	const wikiEnd = lineText.indexOf("]]", localTo);
	if (wikiStart !== -1 && wikiEnd !== -1 && wikiStart < localFrom) {
		return {
			fromOffset: currentLineStart + wikiStart,
			toOffset: currentLineStart + wikiEnd + 2
		};
	}

	const linkStart = lineText.lastIndexOf("[", localFrom);
	const linkMarker = lineText.indexOf("](", localTo);
	const linkEnd = linkMarker === -1 ? -1 : lineText.indexOf(")", linkMarker + 2);
	if (linkStart !== -1 && linkMarker !== -1 && linkEnd !== -1 && linkStart < localFrom) {
		return {
			fromOffset: currentLineStart + linkStart,
			toOffset: currentLineStart + linkEnd + 1
		};
	}

	for (const marker of ["**", "__", "~~", "``", "*", "_"] as const) {
		const markerStart = lineText.lastIndexOf(marker, localFrom);
		const markerEnd = lineText.indexOf(marker, localTo);
		if (markerStart !== -1 && markerEnd !== -1 && markerStart < localFrom) {
			return {
				fromOffset: currentLineStart + markerStart,
				toOffset: currentLineStart + markerEnd + marker.length
			};
		}
	}

	return { fromOffset, toOffset };
}

function buildRenderedSelectionIndex(source: string): { text: string; sourceOffsets: number[] } {
	const textParts: string[] = [];
	const sourceOffsets: number[] = [];
	let index = 0;
	let inFence = false;

	while (index < source.length) {
		const lineEnd = source.indexOf("\n", index);
		const rawLine = source.slice(index, lineEnd === -1 ? source.length : lineEnd);
		const nextIndex = lineEnd === -1 ? source.length : lineEnd + 1;
		const isLineStart = index === 0 || source[index - 1] === "\n";

		if (/^\s*(```|~~~)/.test(rawLine)) {
			inFence = !inFence;
			index = nextIndex;
			continue;
		}

		if (inFence) {
			appendRenderedLine(textParts, sourceOffsets, rawLine, index, { preserveFormatting: true });
		} else {
			const stripped = stripMarkdownLinePrefix(rawLine, isLineStart);
			appendRenderedLine(textParts, sourceOffsets, stripped.text, index + stripped.sourceOffset, {
				treatTablePipesAsSpaces: stripped.isTable
			});
		}

		if (lineEnd !== -1) {
			appendWhitespaceIfNeeded(textParts, sourceOffsets, lineEnd, textParts.length > 0 && /\s/.test(textParts[textParts.length - 1] ?? ""));
		}
		index = nextIndex;
	}

	return {
		text: textParts.join(""),
		sourceOffsets
	};
}

function stripMarkdownLinePrefix(
	line: string,
	isLineStart: boolean
): { text: string; sourceOffset: number; isTable: boolean } {
	if (!isLineStart) {
		return { text: line, sourceOffset: 0, isTable: isLikelyMarkdownTableLine(line) };
	}

	let cursor = 0;
	while (cursor < line.length && /\s/.test(line[cursor] ?? "")) {
		cursor += 1;
	}

	const headingMatch = line.slice(cursor).match(/^(#{1,6})\s+/);
	if (headingMatch) {
		cursor += headingMatch[0].length;
	}

	const quoteMatch = line.slice(cursor).match(/^(?:>\s*)+/);
	if (quoteMatch) {
		cursor += quoteMatch[0].length;
	}

	const taskMatch = line.slice(cursor).match(/^(?:[-*+]\s+\[[ xX]\]\s*|[-*+]\s+|\d+[.)]\s+)/);
	if (taskMatch) {
		cursor += taskMatch[0].length;
	}

	const isTable = isLikelyMarkdownTableLine(line);
	if (isTable) {
		return {
			text: line.replace(/\|/g, " "),
			sourceOffset: 0,
			isTable: true
		};
	}

	return {
		text: line.slice(cursor),
		sourceOffset: cursor,
		isTable: false
	};
}

function appendRenderedLine(
	textParts: string[],
	sourceOffsets: number[],
	line: string,
	lineSourceOffset: number,
	options: { preserveFormatting?: boolean; treatTablePipesAsSpaces?: boolean } = {}
): void {
	let lastWasSpace = textParts.length > 0 && /\s/.test(textParts[textParts.length - 1] ?? "");
	let index = 0;
	while (index < line.length) {
		const char = line[index] ?? "";
		const sourceOffset = lineSourceOffset + index;

		if (options.treatTablePipesAsSpaces && char === "|") {
			appendWhitespaceIfNeeded(textParts, sourceOffsets, sourceOffset, lastWasSpace);
			lastWasSpace = true;
			index += 1;
			continue;
		}

		if (!options.preserveFormatting && isFormattingMarker(line, index)) {
			index += skipFormattingMarker(line, index);
			continue;
		}

		if (!options.preserveFormatting && char === "\\") {
			const nextChar = line[index + 1];
			if (nextChar) {
				appendRenderedChar(textParts, sourceOffsets, nextChar, sourceOffset + 1);
				lastWasSpace = false;
				index += 2;
				continue;
			}
		}

		if (!options.preserveFormatting && char === "!" && line[index + 1] === "[") {
			const image = parseVisibleLink(line, index + 1, lineSourceOffset);
			if (image) {
				appendText(textParts, sourceOffsets, image.text, image.sourceOffsets);
				lastWasSpace = textParts.length > 0 && /\s/.test(textParts[textParts.length - 1] ?? "");
				index = image.endIndex;
				continue;
			}
		}

		if (!options.preserveFormatting && char === "[") {
			const link = parseVisibleLink(line, index, lineSourceOffset);
			if (link) {
				appendText(textParts, sourceOffsets, link.text, link.sourceOffsets);
				lastWasSpace = textParts.length > 0 && /\s/.test(textParts[textParts.length - 1] ?? "");
				index = link.endIndex;
				continue;
			}
		}

		if (!options.preserveFormatting && char === "<") {
			const tagEnd = line.indexOf(">", index + 1);
			if (tagEnd !== -1 && looksLikeHtmlTag(line.slice(index, tagEnd + 1))) {
				index = tagEnd + 1;
				continue;
			}
		}

		if (!options.preserveFormatting && char === "`") {
			const code = parseInlineCode(line, index, lineSourceOffset);
			if (code) {
				appendText(textParts, sourceOffsets, code.text, code.sourceOffsets);
				lastWasSpace = textParts.length > 0 && /\s/.test(textParts[textParts.length - 1] ?? "");
				index = code.endIndex;
				continue;
			}
		}

		if (!options.preserveFormatting && char === "[" && line[index + 1] === "[") {
			const wiki = parseWikiLink(line, index, lineSourceOffset);
			if (wiki) {
				appendText(textParts, sourceOffsets, wiki.text, wiki.sourceOffsets);
				lastWasSpace = textParts.length > 0 && /\s/.test(textParts[textParts.length - 1] ?? "");
				index = wiki.endIndex;
				continue;
			}
		}

		if (/\s/.test(char)) {
			appendWhitespaceIfNeeded(textParts, sourceOffsets, sourceOffset, lastWasSpace);
			lastWasSpace = true;
			index += 1;
			continue;
		}

		appendRenderedChar(textParts, sourceOffsets, char, sourceOffset);
		lastWasSpace = false;
		index += 1;
	}
}

function appendWhitespaceIfNeeded(
	textParts: string[],
	sourceOffsets: number[],
	sourceOffset: number,
	lastWasSpace: boolean
): void {
	if (lastWasSpace) {
		return;
	}
	appendRenderedChar(textParts, sourceOffsets, " ", sourceOffset);
}

function appendRenderedChar(
	textParts: string[],
	sourceOffsets: number[],
	char: string,
	sourceOffset: number
): void {
	if (!char) {
		return;
	}
	textParts.push(char);
	sourceOffsets.push(sourceOffset);
}

function appendText(
	textParts: string[],
	sourceOffsets: number[],
	text: string,
	offsets: number[]
): void {
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index] ?? "";
		const offset = offsets[index];
		if (offset === undefined) {
			continue;
		}
		appendRenderedChar(textParts, sourceOffsets, char, offset);
	}
}

function skipFormattingMarker(line: string, index: number): number {
	const char = line[index];
	if (!char) {
		return 1;
	}
	if (char === "*" || char === "_" || char === "~") {
		let length = 1;
		while (line[index + length] === char) {
			length += 1;
		}
		return length;
	}
	return 1;
}

function isFormattingMarker(line: string, index: number): boolean {
	const char = line[index];
	if (!char) {
		return false;
	}
	return char === "*" || char === "_" || char === "~";
}

function parseVisibleLink(
	line: string,
	startIndex: number,
	lineSourceOffset: number
): { text: string; sourceOffsets: number[]; endIndex: number } | null {
	if (line[startIndex] !== "[") {
		return null;
	}

	const closeIndex = findMatchingBracket(line, startIndex + 1);
	if (closeIndex === -1) {
		return null;
	}

	const inner = line.slice(startIndex + 1, closeIndex);
	const nextChar = line[closeIndex + 1];
	if (nextChar !== "(") {
		return line[startIndex + 1] === "["
			? parseWikiLink(line, startIndex, lineSourceOffset)
			: {
					text: inner,
					sourceOffsets: Array.from({ length: inner.length }, (_, itemIndex) => lineSourceOffset + startIndex + 1 + itemIndex),
					endIndex: closeIndex + 1
				};
	}

	const endParen = findMatchingParen(line, closeIndex + 1);
	if (endParen === -1) {
		return null;
	}

	const text = inner.replace(/^!/, "").split("|").pop() ?? inner;
	return {
		text,
		sourceOffsets: Array.from({ length: text.length }, (_, itemIndex) => lineSourceOffset + startIndex + 1 + itemIndex),
		endIndex: endParen + 1
	};
}

function parseWikiLink(
	line: string,
	startIndex: number,
	lineSourceOffset: number
): { text: string; sourceOffsets: number[]; endIndex: number } | null {
	if (line[startIndex] !== "[" || line[startIndex + 1] !== "[") {
		return null;
	}

	const endIndex = line.indexOf("]]", startIndex + 2);
	if (endIndex === -1) {
		return null;
	}

	const inner = line.slice(startIndex + 2, endIndex);
	const display = inner.includes("|") ? inner.split("|").pop() ?? inner : inner;
	return {
		text: display,
		sourceOffsets: Array.from({ length: display.length }, (_, itemIndex) => lineSourceOffset + startIndex + 2 + itemIndex),
		endIndex: endIndex + 2
	};
}

function parseInlineCode(
	line: string,
	startIndex: number,
	lineSourceOffset: number
): { text: string; sourceOffsets: number[]; endIndex: number } | null {
	let fenceLength = 0;
	while (line[startIndex + fenceLength] === "`") {
		fenceLength += 1;
	}
	if (fenceLength === 0) {
		return null;
	}

	const closing = line.indexOf("`".repeat(fenceLength), startIndex + fenceLength);
	if (closing === -1) {
		return null;
	}
	const content = line.slice(startIndex + fenceLength, closing);
	return {
		text: content,
		sourceOffsets: Array.from({ length: content.length }, (_, itemIndex) => lineSourceOffset + startIndex + fenceLength + itemIndex),
		endIndex: closing + fenceLength
	};
}

function findMatchingBracket(line: string, startIndex: number): number {
	let depth = 0;
	for (let index = startIndex; index < line.length; index += 1) {
		const char = line[index];
		if (char === "\\") {
			index += 1;
			continue;
		}
		if (char === "[") {
			depth += 1;
			continue;
		}
		if (char === "]") {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}
	return -1;
}

function findMatchingParen(line: string, startIndex: number): number {
	let depth = 0;
	for (let index = startIndex; index < line.length; index += 1) {
		const char = line[index];
		if (char === "\\") {
			index += 1;
			continue;
		}
		if (char === "(") {
			depth += 1;
			continue;
		}
		if (char === ")") {
			depth -= 1;
			if (depth === 0) {
				return index;
			}
		}
	}
	return -1;
}

function looksLikeHtmlTag(value: string): boolean {
	return /^<\/?[A-Za-z][^>]*>$/.test(value.trim());
}

function normalizeSelectionSearchText(value: string): string {
	return normalizeSelectedText(value).replace(/\s+/g, " ");
}

function findClosestRenderedIndex(
	renderedText: string,
	targetText: string,
	preferredOffset: number,
	sourceOffsets: number[]
): number | null {
	let bestIndex: number | null = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	let searchIndex = renderedText.indexOf(targetText);
	while (searchIndex !== -1) {
		const sourceOffset = sourceOffsets[searchIndex];
		if (sourceOffset !== undefined) {
			const distance = Math.abs(sourceOffset - preferredOffset);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestIndex = searchIndex;
			}
		}
		searchIndex = renderedText.indexOf(targetText, searchIndex + 1);
	}
	return bestIndex;
}

function extractContextWindow(
	noteText: string,
	fromOffset: number,
	toOffset: number,
	options: { windowLines: number; maxCharacters: number }
): string {
	if (!noteText.trim()) {
		return "";
	}

	const lines = noteText.split("\n");
	const starts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		starts.push(offset);
		offset += line.length + 1;
	}

	const fromLine = getLineIndexForOffset(starts, fromOffset);
	const toLine = getLineIndexForOffset(starts, Math.max(fromOffset, toOffset - 1));
	const startLine = Math.max(0, fromLine - options.windowLines);
	const endLine = Math.min(lines.length - 1, toLine + options.windowLines);
	return trimContextSnippet(lines.slice(startLine, endLine + 1).join("\n"), options.maxCharacters);
}

function trimContextSnippet(text: string, maxCharacters: number): string {
	const normalized = text.trim();
	if (normalized.length <= maxCharacters) {
		return normalized;
	}
	return `${normalized.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
}
