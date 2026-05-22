export const DEFAULT_SESSION_TITLE = "新对话";

export interface SessionLike {
	id: string;
	createdAt: number;
	updatedAt: number;
}

export interface SessionSnapshotLike<Message = unknown> extends SessionLike {
	title: string;
	sessionId?: string;
	messages: Message[];
}

export interface SessionSnapshotInput<Message = unknown> {
	title?: string;
	messages: Message[];
	sessionId?: string;
}

export interface BridgeUsageSummaryLike {
	apiCalls?: number;
	inputTokens?: number;
	lastPromptTokens?: number;
	contextLength?: number;
	contextPercent?: number;
	cacheHitRate?: number | null;
}

export type ContextMode = "auto" | "selection" | "note" | "manual";

export interface LiveContextLike {
	noteTitle?: string;
	notePath?: string;
	selectionText?: string;
	noteContext?: string;
}

export interface ContextHealthInput {
	sessionId?: string;
	contextMode: ContextMode;
	pendingContextCount: number;
	pendingImageCount: number;
	queueCount: number;
	liveContext: LiveContextLike;
	usage?: BridgeUsageSummaryLike;
}

export interface ContextHealthItem {
	label: string;
	value: string;
}

export interface SelectionSourceInput {
	mode?: string | null;
	editorSelection?: string | null;
	browserSelection?: string | null;
}

export interface ScrollPositionInput {
	scrollTop: number;
	clientHeight: number;
	scrollHeight: number;
	threshold?: number;
}

export interface ScrollIntentInput extends ScrollPositionInput {
	isSending: boolean;
	currentlySticking: boolean;
}

export interface ScrollRestoreInput extends ScrollPositionInput {
	targetScrollTop: number;
}

export interface SelectionRefreshInput {
	nextSelection: string;
	currentSnapshot: string;
	isPointerDown: boolean;
	keepExistingWhenEmpty?: boolean;
}

export interface ComposerShortcutInput {
	key: string;
	shiftKey?: boolean;
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
}

export interface MessageIdLike {
	id?: string | null;
}

export interface MessageKindLike extends MessageIdLike {
	kind?: string | null;
}

export type BridgeEventRenderType =
	| "status"
	| "activity"
	| "write_trace"
	| "progress"
	| "delta"
	| "segment_break"
	| "final"
	| "error"
	| "write_review";

export interface ActivityTimelineEntryLike {
	status?: string | null;
	toolName?: string | null;
	preview?: string | null;
}

export interface ActivityTimelineVisibilityResult<T extends ActivityTimelineEntryLike = ActivityTimelineEntryLike> {
	visibleEntries: T[];
	hiddenCount: number;
	totalCount: number;
}

export interface ActivityMessageLike {
	pending?: boolean | null;
	activities?: Array<ActivityTimelineEntryLike | null | undefined> | null;
}

export interface ActivityMessageCompactLike extends ActivityMessageLike, MessageKindLike {
	role?: string | null;
}

export interface ActivityMessageVisibilityResult<T extends ActivityMessageLike = ActivityMessageLike> {
	visibleMessages: T[];
	hiddenCount: number;
	totalCount: number;
}

export function getActivityChainTailVisibleCount<T extends ActivityMessageLike>(messages: T[]): number {
	const filtered = messages.filter((message) =>
		(message.activities ?? []).some((entry) => {
			if (!entry) {
				return false;
			}
			return shouldShowActivityEntry(entry.toolName);
		})
	);
	if (filtered.length <= 1) {
		return 1;
	}

	const latestVisibleMessage = filtered[filtered.length - 1];
	const visibleEntries = (latestVisibleMessage.activities ?? []).filter((entry): entry is ActivityTimelineEntryLike => {
		if (!entry) {
			return false;
		}
		return shouldShowActivityEntry(entry.toolName);
	});
	const latestVisibleEntry = visibleEntries.length > 0 ? visibleEntries[visibleEntries.length - 1] : null;

	return latestVisibleEntry?.toolName === "thinking" || latestVisibleEntry?.toolName === "write_trace" ? 2 : 1;
}

export function formatSelectionPreview(text: string, maxLength = 48): string {
	const compact = text.replace(/\s+/g, " ").trim();
	if (!compact) {
		return "";
	}
	if (compact.length <= maxLength) {
		return compact;
	}
	return `${compact.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function buildSessionTitle(text: string, maxLength = 24): string {
	const preview = formatSelectionPreview(text, maxLength);
	return preview || DEFAULT_SESSION_TITLE;
}

export function isComposerSendShortcut(input: ComposerShortcutInput): boolean {
	if (input.key !== "Enter" || input.altKey) {
		return false;
	}
	return !!(input.shiftKey || input.metaKey || input.ctrlKey);
}

export function pickNextActiveSessionId(
	sessions: SessionLike[],
	preferredId?: string
): string | undefined {
	if (preferredId && sessions.some((session) => session.id === preferredId)) {
		return preferredId;
	}

	const sorted = [...sessions].sort(
		(left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt
	);
	return sorted.length > 0 ? sorted[0].id : undefined;
}

export function applySessionSnapshot<Message>(
	session: SessionSnapshotLike<Message>,
	input: SessionSnapshotInput<Message>,
	touch: boolean,
	now: number
): SessionSnapshotLike<Message> {
	session.title = input.title?.trim() || session.title || DEFAULT_SESSION_TITLE;
	session.sessionId = input.sessionId;
	session.messages = input.messages;
	if (touch) {
		session.updatedAt = now;
	}
	return session;
}

export function formatBridgeConnectionStatus(
	sessionId?: string,
	usage?: BridgeUsageSummaryLike
): string {
	const sessionLabel = sessionId ? `已连接 ${formatSelectionPreview(sessionId, 24)}` : "已收到回复";
	if (!usage || typeof usage.cacheHitRate !== "number") {
		return sessionLabel;
	}
	const calls = typeof usage.apiCalls === "number" && usage.apiCalls > 0 ? ` · ${usage.apiCalls} calls` : "";
	return `${sessionLabel} · cache ${usage.cacheHitRate}%${calls}`;
}

export function formatTokenCount(value: number): string {
	if (!Number.isFinite(value)) {
		return "0";
	}
	return Math.max(0, Math.round(value)).toLocaleString("en-US");
}

export function formatUsageInputTokens(usage?: BridgeUsageSummaryLike): string {
	if (!usage || typeof usage.inputTokens !== "number") {
		return "等待下一次回复";
	}
	return `${formatTokenCount(usage.inputTokens)} tokens`;
}

export function getContextModeDescription(mode: ContextMode): string {
	switch (mode) {
		case "selection":
			return "选区优先";
		case "note":
			return "当前笔记";
		case "manual":
			return "手动";
		case "auto":
		default:
			return "自动";
	}
}

export function pickLiveContextForMode(liveContext: LiveContextLike, mode: ContextMode): LiveContextLike {
	const titleContext = {
		noteTitle: liveContext.noteTitle,
		notePath: liveContext.notePath
	};
	if (mode === "manual") {
		return {};
	}
	if (mode === "note") {
		return removeEmptyLiveContext(titleContext);
	}
	if (mode === "selection" || (mode === "auto" && liveContext.selectionText)) {
		return removeEmptyLiveContext({
			...titleContext,
			selectionText: liveContext.selectionText,
			noteContext: liveContext.noteContext
		});
	}
	return removeEmptyLiveContext(titleContext);
}

export function buildContextHealthItems(input: ContextHealthInput): ContextHealthItem[] {
	const sessionValue = input.sessionId ? formatSelectionPreview(input.sessionId, 32) : "未连接";
	const cacheValue =
		input.usage && typeof input.usage.cacheHitRate === "number"
			? `${input.usage.cacheHitRate}%${input.usage.apiCalls ? ` · ${input.usage.apiCalls} calls` : ""}`
			: "等待下一次回复";
	const contextParts = [
		input.liveContext.noteTitle,
		input.liveContext.selectionText ? `选区 ${input.liveContext.selectionText.trim().length} 字` : "",
		input.liveContext.noteContext ? `附近上下文 ${input.liveContext.noteContext.trim().length} 字` : ""
	].filter(Boolean);
	const pendingParts = [
		input.pendingContextCount > 0 ? `${input.pendingContextCount} 段上下文` : "",
		input.pendingImageCount > 0 ? `${input.pendingImageCount} 张图片` : "",
		input.queueCount > 0 ? `${input.queueCount} 条排队` : ""
	].filter(Boolean);

	return [
		{ label: "Session", value: sessionValue },
		{ label: "Cache", value: cacheValue },
		{ label: "Context", value: contextParts.join(" · ") || "无实时上下文" },
		{ label: "Pending", value: pendingParts.join(" · ") || "无待发送附件" }
	];
}

function removeEmptyLiveContext(input: LiveContextLike): LiveContextLike {
	return Object.fromEntries(
		Object.entries(input).filter(([, value]) => typeof value === "string" && value.trim())
	) as LiveContextLike;
}

export function pickSelectionText(input: SelectionSourceInput): string {
	const mode = (input.mode || "").trim().toLowerCase();
	const editorSelection = (input.editorSelection || "").trim();
	const browserSelection = (input.browserSelection || "").trim();

	if (mode === "preview") {
		return browserSelection || editorSelection;
	}

	if (mode === "source") {
		return editorSelection || browserSelection;
	}

	return editorSelection || browserSelection;
}

export function shouldStickToBottom(input: ScrollPositionInput): boolean {
	const threshold = input.threshold ?? 24;
	return input.scrollTop + input.clientHeight >= input.scrollHeight - threshold;
}

export function getNextStickToBottom(input: ScrollIntentInput): boolean {
	if (input.isSending && input.currentlySticking) {
		return true;
	}
	return shouldStickToBottom(input);
}

export function getRestoredScrollTop(
	previousScrollTop: number | null,
	shouldAutoStickToBottom: boolean
): number | undefined {
	if (shouldAutoStickToBottom || previousScrollTop === null) {
		return undefined;
	}
	return previousScrollTop;
}

export function shouldDeferScrollRestore(input: ScrollRestoreInput): boolean {
	if (input.targetScrollTop <= 0) {
		return false;
	}
	return input.scrollHeight - input.clientHeight < input.targetScrollTop;
}

export function canUpdateBridgeEventWithoutFullRender(type: BridgeEventRenderType): boolean {
	return (
		type === "status" ||
		type === "activity" ||
		type === "write_trace" ||
		type === "write_review" ||
		type === "progress" ||
		type === "delta"
	);
}

export function shouldShowActivityEntry(toolName?: string | null): boolean {
	return (toolName || "").trim() !== "run.config";
}

export function formatActivityTimelineSummary(totalCount: number, hiddenCount: number): string {
	if (totalCount <= 0) {
		return "";
	}
	if (hiddenCount > 0 && hiddenCount < totalCount) {
		return `过程 · ${totalCount} 条 · 已折叠 ${hiddenCount} 条`;
	}
	return `过程 · ${totalCount} 条`;
}

export function getVisibleActivityTimelineEntries<T extends ActivityTimelineEntryLike>(
	entries: T[],
	expanded = false,
	tailVisibleCount = 1,
	includeCollapsedTail = true
): ActivityTimelineVisibilityResult<T> {
	const filtered = entries.filter((entry) => shouldShowActivityEntry(entry.toolName));
	if (filtered.length === 0) {
		return { visibleEntries: [], hiddenCount: 0, totalCount: 0 };
	}
	if (expanded || (includeCollapsedTail && filtered.length <= tailVisibleCount)) {
		return { visibleEntries: filtered, hiddenCount: 0, totalCount: filtered.length };
	}

	const visibleIndexes = new Set<number>();
	if (includeCollapsedTail) {
		const latestIndex = Math.max(0, filtered.length - tailVisibleCount);
		for (let index = latestIndex; index < filtered.length; index += 1) {
			visibleIndexes.add(index);
		}
	}

	const visibleEntries = filtered.filter((_, index) => visibleIndexes.has(index));
	return {
		visibleEntries,
		hiddenCount: filtered.length - visibleEntries.length,
		totalCount: filtered.length
	};
}

export function getVisibleActivityMessages<T extends ActivityMessageLike>(
	messages: T[],
	expanded = false,
	tailVisibleCount = 1,
	includeCollapsedTail = true
): ActivityMessageVisibilityResult<T> {
	const filtered = messages.filter((message) =>
		(message.activities ?? []).some((entry) => entry && shouldShowActivityEntry(entry.toolName))
	);
	if (filtered.length === 0) {
		return { visibleMessages: [], hiddenCount: 0, totalCount: 0 };
	}
	if (expanded || (includeCollapsedTail && filtered.length <= tailVisibleCount)) {
		return { visibleMessages: filtered, hiddenCount: 0, totalCount: filtered.length };
	}

	const visibleIndexes = new Set<number>();
	if (includeCollapsedTail) {
		const latestIndex = Math.max(0, filtered.length - tailVisibleCount);
		for (let index = latestIndex; index < filtered.length; index += 1) {
			visibleIndexes.add(index);
		}
	}

	const visibleMessages = filtered.filter((_, index) => visibleIndexes.has(index));
	return {
		visibleMessages,
		hiddenCount: filtered.length - visibleMessages.length,
		totalCount: filtered.length
	};
}

export function collapseCompletedTurnActivityMessages<T extends ActivityMessageCompactLike>(
	messages: T[],
	turnStartMessageId?: string,
	preferredSurvivorId?: string
): { messages: T[]; survivorMessageId?: string } {
	const anchorIndex = turnStartMessageId
		? messages.findIndex((message) => message.id === turnStartMessageId)
		: -1;
	if (anchorIndex < 0) {
		return { messages };
	}

	let nextUserIndex = messages.length;
	for (let index = anchorIndex + 1; index < messages.length; index += 1) {
		if (messages[index].kind === "user") {
			nextUserIndex = index;
			break;
		}
	}

	const activityIndexes: number[] = [];
	for (let index = anchorIndex + 1; index < nextUserIndex; index += 1) {
		const message = messages[index];
		if (message.kind !== "activity" || message.role !== "assistant") {
			continue;
		}
		if (!(message.activities ?? []).some((entry) => entry && shouldShowActivityEntry(entry.toolName))) {
			continue;
		}
		activityIndexes.push(index);
	}

	if (activityIndexes.length <= 1) {
		const survivorIndex = activityIndexes[0];
		return { messages, survivorMessageId: survivorIndex !== undefined ? messages[survivorIndex]?.id ?? undefined : undefined };
	}

	const survivorIndex =
		(preferredSurvivorId
			? activityIndexes.find((index) => messages[index]?.id === preferredSurvivorId)
			: undefined) ?? activityIndexes[activityIndexes.length - 1];
	const survivor = messages[survivorIndex];
	if (!survivor) {
		return { messages };
	}

	const mergedActivities = activityIndexes.flatMap((index) => messages[index]?.activities ?? []);
	const nextMessages = messages
		.filter((_, index) => !activityIndexes.includes(index) || index === survivorIndex)
		.map((message, index, source) => {
			if (message !== survivor) {
				return message;
			}
			return {
				...message,
				pending: false,
				activities: mergedActivities
			};
		}) as T[];

	return {
		messages: nextMessages,
		survivorMessageId: survivor.id ?? undefined
	};
}

export function shouldMergeActivityEntry(
	toolName: string | undefined,
	currentStatus: string,
	incomingStatus: string,
	currentPreview?: string,
	incomingPreview?: string
): boolean {
	if (!toolName) {
		return false;
	}
	if (toolName === "thinking") {
		return currentStatus === "running" && incomingStatus === "running";
	}
	if (toolName === "write_trace") {
		return currentStatus === "running" && incomingStatus === "running";
	}
	if (incomingStatus === "done" || incomingStatus === "error") {
		return currentStatus === "running" && currentPreview === incomingPreview;
	}
	return currentStatus === "running" && currentPreview === incomingPreview;
}

export function getInsertIndexAfterMessage(messages: MessageIdLike[], messageId?: string): number | undefined {
	if (!messageId) {
		return undefined;
	}
	const index = messages.findIndex((message) => message.id === messageId);
	return index >= 0 ? index + 1 : undefined;
}

export function adjustIndexAfterInsertion(index: number | null, insertIndex: number): number | null {
	if (index === null) {
		return null;
	}
	return index >= insertIndex ? index + 1 : index;
}

export function getAppendIndexAfterTurnMessages(messages: MessageKindLike[], turnStartMessageId?: string): number {
	const anchorIndex = turnStartMessageId
		? messages.findIndex((message) => message.id === turnStartMessageId)
		: -1;
	if (anchorIndex < 0) {
		return messages.length;
	}

	for (let index = anchorIndex + 1; index < messages.length; index += 1) {
		if (messages[index].kind === "user") {
			return index;
		}
	}
	return messages.length;
}

export function getAppendIndexAfterLatestTurnAssistant(
	messages: MessageKindLike[],
	turnStartMessageId?: string
): number | undefined {
	const anchorIndex = turnStartMessageId
		? messages.findIndex((message) => message.id === turnStartMessageId)
		: -1;
	if (anchorIndex < 0) {
		return undefined;
	}

	let nextUserIndex = messages.length;
	for (let index = anchorIndex + 1; index < messages.length; index += 1) {
		if (messages[index].kind === "user") {
			nextUserIndex = index;
			break;
		}
	}

	for (let index = nextUserIndex - 1; index > anchorIndex; index -= 1) {
		const kind = (messages[index].kind || "").trim();
		if (kind === "final" || kind === "write-review" || kind === "progress") {
			return index + 1;
		}
	}

	return undefined;
}

export function shouldRestoreComposerFocus(
	hadComposerFocus: boolean,
	shouldAutoStickToBottom: boolean
): boolean {
	return hadComposerFocus && shouldAutoStickToBottom;
}

export function shouldRefreshSelectionSnapshot(input: SelectionRefreshInput): boolean {
	const nextSelection = input.nextSelection.trim();
	const currentSnapshot = input.currentSnapshot.trim();

	if (nextSelection === currentSnapshot) {
		return false;
	}

	if (!nextSelection && currentSnapshot && input.keepExistingWhenEmpty) {
		return false;
	}

	if (input.isPointerDown && nextSelection) {
		return false;
	}

	return true;
}

export function shouldHideStatusText(statusText: string): boolean {
	return new Set([
		"",
		"Ready",
		"Connected",
		"Reply received",
		"Started a fresh session",
		"已连接",
		"已收到回复",
		"已开始新对话"
	]).has(statusText);
}
