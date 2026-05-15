export const DEFAULT_SESSION_TITLE = "新对话";

export interface SessionLike {
	id: string;
	createdAt: number;
	updatedAt: number;
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

export interface MessageIdLike {
	id?: string | null;
}

export interface MessageKindLike extends MessageIdLike {
	kind?: string | null;
}

export type BridgeEventRenderType =
	| "status"
	| "activity"
	| "progress"
	| "delta"
	| "segment_break"
	| "final"
	| "error";

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
	return type === "status" || type === "activity" || type === "progress" || type === "delta";
}

export function shouldShowActivityEntry(toolName?: string | null): boolean {
	return (toolName || "").trim() !== "run.config";
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
