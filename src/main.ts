import {
	App,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf
} from "obsidian";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, extname, isAbsolute, join, resolve } from "node:path";
import {
	DEFAULT_SESSION_TITLE,
	buildSessionTitle,
	formatSelectionPreview,
	getRestoredScrollTop,
	pickNextActiveSessionId,
	pickSelectionText,
	shouldHideStatusText,
	shouldRefreshSelectionSnapshot,
	shouldRestoreComposerFocus,
	shouldStickToBottom
} from "./session-helpers";
import { buildTurnUserText, pickBridgeFinalText } from "./bridge-helpers";

const VIEW_TYPE_HERMES_SIDEBAR = "hermes-sidebar-view";
const DEFAULT_HERMES_BINARY = "hermes";
const DEFAULT_PROVIDER = "xiaomi";
const DEFAULT_MODEL = "mimo-v2.5";
const DEFAULT_FALLBACK_PROVIDER = "deepseek";
const DEFAULT_FALLBACK_MODEL = "deepseek-v4-flash";
const DEFAULT_HERMES_PATH_PREFIX =
	"/Users/lijiahao/.hermes/hermes-agent/venv/bin:/Users/lijiahao/.local/bin:";
const DEFAULT_HERMES_ROOT = "/Users/lijiahao/.hermes/hermes-agent";
const DEFAULT_HERMES_BRIDGE = "hermes_bridge.py";
const DEFAULT_REASONING_EFFORT = "high";
const HERMES_MODEL_OPTIONS = [
	{ label: "MiMo 2.5", value: "mimo-v2.5", provider: "xiaomi" },
	{ label: "DeepSeek V4 Flash", value: "deepseek-v4-flash", provider: "deepseek" },
	{ label: "DeepSeek V4 Pro", value: "deepseek-v4-pro", provider: "deepseek" }
] as const;
const HERMES_REASONING_OPTIONS = [
	{ label: "关闭", value: "none" },
	{ label: "低", value: "low" },
	{ label: "中", value: "medium" },
	{ label: "高", value: "high" },
	{ label: "超强", value: "xhigh" }
] as const;

type HermesRole = "user" | "assistant" | "system";
type HermesMessageKind = "user" | "progress" | "final";

interface HermesMessage {
	role: HermesRole;
	kind: HermesMessageKind;
	content: string;
	pending?: boolean;
}

interface PendingContext {
	label: string;
	content: string;
}

interface PendingImageAttachment {
	id: string;
	name: string;
	path: string;
	previewDataUrl: string;
}

interface QueuedTurn {
	id: string;
	userText: string;
	contexts: PendingContext[];
	images: PendingImageAttachment[];
	liveContext: LiveContextInfo;
	provider: string;
	model: string;
	reasoningEffort: string;
}

interface HermesSidebarSettings {
	hermesBinary: string;
	provider: string;
	model: string;
	reasoningEffort: string;
	fallbackProvider: string;
	fallbackModel: string;
	systemPrompt: string;
	pathPrefix: string;
}

interface HermesChatSession {
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	sessionId?: string;
	messages: HermesMessage[];
}

interface HermesPersistedData {
	settings?: Partial<HermesSidebarSettings>;
	sessions?: HermesChatSession[];
	activeSessionId?: string;
}

interface LiveContextInfo {
	noteTitle?: string;
	notePath?: string;
	selectionText?: string;
}

interface HermesRunResult {
	text: string;
	sessionId?: string;
	rawOutput: string;
}

interface HermesBridgePayload {
	prompt: string;
	systemPrompt: string;
	provider: string;
	model: string;
	reasoningEffort: string;
	sessionId?: string;
	imagePaths?: string[];
	conversationHistory: Array<{ role: HermesRole; content: string }>;
}

interface HermesBridgeEvent {
	type: "status" | "progress" | "delta" | "segment_break" | "final" | "error";
	text?: string;
	message?: string;
	sessionId?: string;
}

interface HermesBridgeRun {
	promise: Promise<HermesRunResult>;
	cancel: () => void;
}

interface ActiveViewScrollSnapshot {
	editorLeft?: number;
	editorTop?: number;
	elementScrolls: Array<{
		element: HTMLElement;
		left: number;
		top: number;
	}>;
}

const DEFAULT_SETTINGS: HermesSidebarSettings = {
	hermesBinary: DEFAULT_HERMES_BINARY,
	provider: DEFAULT_PROVIDER,
	model: DEFAULT_MODEL,
	reasoningEffort: DEFAULT_REASONING_EFFORT,
	fallbackProvider: DEFAULT_FALLBACK_PROVIDER,
	fallbackModel: DEFAULT_FALLBACK_MODEL,
	systemPrompt:
		"You are Hermes inside Obsidian. Be concise, context-aware, and helpful with note-writing tasks.",
	pathPrefix: DEFAULT_HERMES_PATH_PREFIX
};

class HermesSidebarPlugin extends Plugin {
	settings: HermesSidebarSettings;
	private selectionSnapshot = "";
	private refreshTimer: number | null = null;
	private isPointerSelecting = false;
	private lastActiveNotePath = "";
	private lastActiveNoteTitle = "";
	private chatSessions: HermesChatSession[] = [];
	private activeSessionId = "";

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_HERMES_SIDEBAR,
			(leaf) => new HermesSidebarView(leaf, this)
		);

		this.addRibbonIcon("messages-square", "Open Hermes Sidebar", async () => {
			await this.activateView();
		});

		this.addCommand({
			id: "open-hermes-sidebar",
			name: "Open Hermes Sidebar",
			callback: async () => {
				await this.activateView();
			}
		});

		this.addCommand({
			id: "attach-current-selection-to-hermes",
			name: "Attach current selection to Hermes",
			callback: async () => {
				const selection = this.getCurrentSelectionText();
				if (!selection) {
					new Notice("No selected text found in the active note.");
					return;
				}
				const sidebar = await this.activateView();
				sidebar.attachContext({
					label: "Selection",
					content: selection
				});
			}
		});

		this.addSettingTab(new HermesSidebarSettingTab(this.app, this));

		this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
			const markdownView = leaf?.view instanceof MarkdownView ? leaf.view : null;
			if (!markdownView) {
				return;
			}

			const currentPath = markdownView.file?.path ?? "";
			const currentTitle = markdownView.file?.basename ?? "";
			if (currentPath !== this.lastActiveNotePath || currentTitle !== this.lastActiveNoteTitle) {
				this.lastActiveNotePath = currentPath;
				this.lastActiveNoteTitle = currentTitle;
				this.scheduleRefreshSidebarViews();
			}
		}));

		this.registerEvent(this.app.workspace.on("file-open", () => {
			const markdownView = this.getActiveMarkdownView();
			this.selectionSnapshot = "";
			this.lastActiveNotePath = markdownView?.file?.path ?? this.lastActiveNotePath;
			this.lastActiveNoteTitle = markdownView?.file?.basename ?? this.lastActiveNoteTitle;
			this.scheduleRefreshSidebarViews();
		}));

		this.registerDomEvent(document, "selectionchange", () => {
			const selection = this.getCurrentSelectionText();
			if (shouldRefreshSelectionSnapshot({
				nextSelection: selection,
				currentSnapshot: this.selectionSnapshot,
				isPointerDown: this.isPointerSelecting
			})) {
				this.selectionSnapshot = selection;
				this.scheduleRefreshSidebarViews();
			}
		});
		this.registerDomEvent(document, "pointerdown", () => {
			this.isPointerSelecting = true;
		});
		this.registerDomEvent(document, "pointerup", () => {
			this.isPointerSelecting = false;
			const selection = this.getCurrentSelectionText();
			if (selection !== this.selectionSnapshot) {
				this.selectionSnapshot = selection;
				this.scheduleRefreshSidebarViews();
			}
		});
	}

	async onunload(): Promise<void> {
		await this.app.workspace.detachLeavesOfType(VIEW_TYPE_HERMES_SIDEBAR);
	}

	async loadSettings(): Promise<void> {
		const rawData = await this.loadData();
		const persistedData = isPersistedDataShape(rawData) ? rawData : undefined;
		const legacySettings = isPlainObject(rawData) ? rawData : undefined;
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			persistedData?.settings ?? legacySettings ?? {}
		);
		this.chatSessions = restoreSessions(persistedData?.sessions);
		this.activeSessionId =
			pickNextActiveSessionId(this.chatSessions, persistedData?.activeSessionId) ??
			this.chatSessions[0]?.id ??
			"";
	}

	async saveSettings(): Promise<void> {
		await this.savePluginState();
	}

	getActiveMarkdownView(): MarkdownView | null {
		return this.app.workspace.getActiveViewOfType(MarkdownView) ?? null;
	}

	getCurrentContextFile() {
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			return activeFile;
		}

		const mostRecentLeaf = this.app.workspace.getMostRecentLeaf();
		if (mostRecentLeaf?.view instanceof MarkdownView) {
			return mostRecentLeaf.view.file ?? null;
		}

		const markdownLeaf = this.app.workspace.getLeavesOfType("markdown")[0];
		if (markdownLeaf?.view instanceof MarkdownView) {
			return markdownLeaf.view.file ?? null;
		}

		return null;
	}

	getCurrentSelectionText(): string {
		const view = this.getActiveMarkdownView();
		const editorSelection = view?.editor.getSelection() ?? "";
		const browserSelection = window.getSelection();
		const browserText = browserSelection?.toString().trim();
		const mode = view?.getMode?.() ?? "";

		if (browserSelection && browserText && browserSelection.rangeCount > 0 && view) {
			const range = browserSelection.getRangeAt(0);
			const ancestor = range.commonAncestorContainer;
			const rootElement = ancestor.nodeType === Node.TEXT_NODE
				? ancestor.parentElement
				: (ancestor as Element | null);

			if (rootElement && this.app.workspace.getLeavesOfType(VIEW_TYPE_HERMES_SIDEBAR).some((leaf) => {
				const sidebarView = leaf.view as HermesSidebarView;
				return sidebarView.containerEl.contains(rootElement);
			})) {
				return "";
			}

			if (rootElement && view.containerEl.contains(rootElement)) {
				return pickSelectionText({
					mode,
					editorSelection,
					browserSelection: browserText
				});
			}
		}

		return pickSelectionText({
			mode,
			editorSelection,
			browserSelection: ""
		});
	}

	getLiveContextInfo(): LiveContextInfo {
		const file = this.getCurrentContextFile();
		return {
			noteTitle: (file?.basename ?? this.lastActiveNoteTitle) || undefined,
			notePath: (file?.path ?? this.lastActiveNotePath) || undefined,
			selectionText: this.selectionSnapshot.trim() || undefined
		};
	}

	clearSelectionSnapshot(collapseSelection = false): void {
		if (collapseSelection) {
			this.collapseCurrentSelection();
		}
		this.selectionSnapshot = "";
		this.scheduleRefreshSidebarViews();
	}

	getSessions(): HermesChatSession[] {
		return [...this.chatSessions].sort(
			(left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt
		);
	}

	getActiveSession(): HermesChatSession {
		let session = this.chatSessions.find((entry) => entry.id === this.activeSessionId);
		if (!session) {
			session = createChatSession();
			this.chatSessions = [session, ...this.chatSessions];
			this.activeSessionId = session.id;
			void this.savePluginState();
		}
		return session;
	}

	createSession(): HermesChatSession {
		const session = createChatSession();
		this.chatSessions = [session, ...this.chatSessions];
		this.activeSessionId = session.id;
		void this.savePluginState();
		return session;
	}

	setActiveSession(sessionId: string): boolean {
		if (!this.chatSessions.some((session) => session.id === sessionId)) {
			return false;
		}
		this.activeSessionId = sessionId;
		void this.savePluginState();
		return true;
	}

	deleteSession(sessionId: string): void {
		const remaining = this.chatSessions.filter((session) => session.id !== sessionId);
		this.chatSessions = remaining.length > 0 ? remaining : [createChatSession()];
		this.activeSessionId =
			pickNextActiveSessionId(
				this.chatSessions,
				this.activeSessionId === sessionId ? undefined : this.activeSessionId
			) ?? this.chatSessions[0].id;
		void this.savePluginState();
	}

	saveSessionSnapshot(
		sessionId: string,
		input: { title?: string; messages: HermesMessage[]; sessionId?: string },
		touch = true
	): void {
		const index = this.chatSessions.findIndex((session) => session.id === sessionId);
		if (index === -1) {
			return;
		}

		const current = this.chatSessions[index];
		this.chatSessions[index] = {
			...current,
			title: input.title?.trim() || current.title || DEFAULT_SESSION_TITLE,
			sessionId: input.sessionId,
			messages: cloneMessages(input.messages),
			updatedAt: touch ? Date.now() : current.updatedAt
		};
		void this.savePluginState();
	}

	private async savePluginState(): Promise<void> {
		const payload: HermesPersistedData = {
			settings: this.settings,
			sessions: this.chatSessions.map((session) => ({
				...session,
				messages: cloneMessages(session.messages)
			})),
			activeSessionId: this.activeSessionId
		};
		await this.saveData(payload);
	}

	private captureActiveViewScrollSnapshot(): ActiveViewScrollSnapshot | null {
		const markdownView = this.getActiveMarkdownView();
		if (!markdownView) {
			return null;
		}

		const editorScroll = markdownView.editor?.getScrollInfo?.();
		const elementScrolls = Array.from(
			markdownView.containerEl.querySelectorAll<HTMLElement>(
				".cm-scroller, .markdown-preview-view, .view-content"
			)
		).map((element) => ({
			element,
			left: element.scrollLeft,
			top: element.scrollTop
		}));

		return {
			editorLeft: editorScroll?.left,
			editorTop: editorScroll?.top,
			elementScrolls
		};
	}

	private restoreActiveViewScrollSnapshot(snapshot: ActiveViewScrollSnapshot | null): void {
		if (!snapshot) {
			return;
		}

		const markdownView = this.getActiveMarkdownView();
		const restore = () => {
			if (
				markdownView?.editor &&
				typeof snapshot.editorLeft === "number" &&
				typeof snapshot.editorTop === "number"
			) {
				markdownView.editor.scrollTo(snapshot.editorLeft, snapshot.editorTop);
			}

			for (const entry of snapshot.elementScrolls) {
				entry.element.scrollLeft = entry.left;
				entry.element.scrollTop = entry.top;
			}
		};

		restore();
		window.requestAnimationFrame(restore);
	}

	private collapseCurrentSelection(): void {
		const scrollSnapshot = this.captureActiveViewScrollSnapshot();
		const markdownView = this.getActiveMarkdownView();
		if (markdownView?.editor) {
			try {
				const cursor = markdownView.editor.getCursor("to");
				markdownView.editor.setSelection(cursor, cursor);
			} catch {
				// Best effort only. Reading mode selection is handled by removeAllRanges below.
			}
		}
		window.getSelection()?.removeAllRanges();
		this.restoreActiveViewScrollSnapshot(scrollSnapshot);
	}

	private scheduleRefreshSidebarViews(): void {
		if (this.refreshTimer !== null) {
			window.clearTimeout(this.refreshTimer);
		}
		this.refreshTimer = window.setTimeout(() => {
			this.refreshTimer = null;
			this.refreshSidebarViews();
		}, 60);
	}

	private refreshSidebarViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HERMES_SIDEBAR)) {
			const view = leaf.view as HermesSidebarView;
			if (view.isComposerFocused()) {
				continue;
			}
			view.requestRefresh();
		}
	}

	async activateView(): Promise<HermesSidebarView> {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_HERMES_SIDEBAR)[0];

		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("split", "vertical");
			await leaf.setViewState({
				type: VIEW_TYPE_HERMES_SIDEBAR,
				active: true
			});
		}

		this.app.workspace.revealLeaf(leaf);
		return leaf.view as HermesSidebarView;
	}
}

class HermesSidebarView extends ItemView {
	private plugin: HermesSidebarPlugin;
	private pendingContexts: PendingContext[] = [];
	private pendingImages: PendingImageAttachment[] = [];
	private queuedTurns: QueuedTurn[] = [];
	private statusText = "";
	private draftText = "";
	private inputEl?: HTMLTextAreaElement;
	private messagesEl?: HTMLDivElement;
	private contextEl?: HTMLDivElement;
	private sendButtonEl?: HTMLButtonElement;
	private modelSelectEl?: HTMLSelectElement;
	private reasoningSelectEl?: HTMLSelectElement;
	private isSending = false;
	private isDrainingQueue = false;
	private activeStreamingMessageIndex: number | null = null;
	private activeRunCancel?: () => void;
	private queueCounter = 0;
	private hermesAvatarDataUrl?: string;
	private isHistoryOpen = false;
	private shouldAutoStickToBottom = true;

	constructor(leaf: WorkspaceLeaf, plugin: HermesSidebarPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_HERMES_SIDEBAR;
	}

	getDisplayText(): string {
		return "Hermes";
	}

	getIcon(): string {
		return "messages-square";
	}

	async onOpen(): Promise<void> {
		this.containerEl.empty();
		this.containerEl.addClass("hermes-sidebar-view");
		this.render();
	}

	async onClose(): Promise<void> {
		for (const image of this.pendingImages) {
			cleanupAttachmentFile(image.path);
		}
		this.pendingImages = [];
		this.containerEl.empty();
	}

	requestRefresh(): void {
		this.render(false);
	}

	isComposerFocused(): boolean {
		return !!this.inputEl && document.activeElement === this.inputEl;
	}

	attachContext(context: PendingContext): void {
		this.pendingContexts.push(context);
		this.statusText = `Attached ${context.label.toLowerCase()} context`;
		this.render();
		new Notice(`${context.label} attached to Hermes.`);
	}

	private focusComposerWithoutScroll(): void {
		if (!this.inputEl) {
			return;
		}

		try {
			this.inputEl.focus({ preventScroll: true });
		} catch {
			this.inputEl.focus();
		}
	}

	private render(allowInputReset = true): void {
		if (!allowInputReset && this.inputEl) {
			this.draftText = this.inputEl.value;
		}
		const previousMessagesScrollTop = this.messagesEl?.scrollTop ?? null;
		this.captureScrollIntent();

		const root = this.containerEl;
		root.empty();
		root.addClass("hermes-sidebar-view");

		const header = root.createDiv({ cls: "hermes-sidebar-header" });
		const titleWrap = header.createDiv({ cls: "hermes-sidebar-title-wrap" });
		const activeSession = this.plugin.getActiveSession();
		titleWrap.createDiv({
			cls: "hermes-sidebar-title",
			text: "Hermes"
		});
		titleWrap.createDiv({
			cls: "hermes-sidebar-meta",
			text: `${this.getModelLabel(this.plugin.settings.model)} · ${this.getReasoningLabel(this.plugin.settings.reasoningEffort)}`
		});

		const headerActions = header.createDiv({ cls: "hermes-sidebar-header-actions" });
		const historyButton = headerActions.createEl("button", {
			cls: "hermes-sidebar-button",
			text: "History"
		});
		historyButton.toggleClass("is-active", this.isHistoryOpen);
		historyButton.addEventListener("click", () => {
			this.isHistoryOpen = !this.isHistoryOpen;
			this.render(false);
		});
		const resetButton = headerActions.createEl("button", {
			cls: "hermes-sidebar-button",
			text: "New chat"
		});
		resetButton.addEventListener("click", () => {
			if (this.isSending) {
				new Notice("Stop the current reply before starting a new chat.");
				return;
			}
			this.stopActiveRun();
			this.pendingContexts = [];
			this.queuedTurns = [];
			this.activeStreamingMessageIndex = null;
			this.plugin.clearSelectionSnapshot(true);
			this.plugin.createSession();
			this.statusText = "Started a fresh session";
			this.render();
		});
		root.toggleClass("hermes-sidebar-history-open", this.isHistoryOpen);

		const historyPanel = root.createDiv({ cls: "hermes-sidebar-history" });
		historyPanel.createDiv({
			cls: "hermes-sidebar-history-title",
			text: "Recent chats"
		});
		const historyList = historyPanel.createDiv({ cls: "hermes-sidebar-history-list" });
		for (const session of this.plugin.getSessions()) {
			const item = historyList.createDiv({
				cls: `hermes-sidebar-history-item ${session.id === activeSession.id ? "is-active" : ""}`
			});
			const itemButton = item.createEl("button", {
				cls: "hermes-sidebar-history-main"
			});
			itemButton.createDiv({
				cls: "hermes-sidebar-history-name",
				text: session.title || DEFAULT_SESSION_TITLE
			});
			itemButton.createDiv({
				cls: "hermes-sidebar-history-meta",
				text: `${session.messages.length} messages`
			});
			itemButton.addEventListener("click", () => {
				if (this.isSending) {
					new Notice("Wait for the current reply to finish before switching chats.");
					return;
				}
				this.pendingContexts = [];
				this.queuedTurns = [];
				this.activeStreamingMessageIndex = null;
				this.plugin.setActiveSession(session.id);
				this.statusText = "Switched chat";
				this.render();
			});
			const deleteButton = item.createEl("button", {
				cls: "hermes-sidebar-history-delete",
				text: "Delete"
			});
			deleteButton.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				if (this.isSending && session.id === activeSession.id) {
					new Notice("Stop the current run before deleting this chat.");
					return;
				}
				this.plugin.deleteSession(session.id);
				this.statusText = "Deleted chat";
				this.render();
			});
		}

		const liveContext = this.plugin.getLiveContextInfo();
		if (liveContext.noteTitle || liveContext.selectionText) {
			const liveContextEl = root.createDiv({ cls: "hermes-sidebar-live-context" });
			if (liveContext.noteTitle) {
				const noteChip = liveContextEl.createDiv({
					cls: "hermes-sidebar-chip hermes-sidebar-chip-note"
				});
				noteChip.createSpan({
					cls: "hermes-sidebar-chip-prefix",
					text: "Reading"
				});
				noteChip.createSpan({
					cls: "hermes-sidebar-chip-value",
					text: liveContext.noteTitle
				});
			}

			if (liveContext.selectionText) {
				const selectionBox = liveContextEl.createEl("details", {
					cls: "hermes-sidebar-selection-preview"
				});
				const selectionHeader = selectionBox.createEl("summary", {
					cls: "hermes-sidebar-selection-header"
				});
				const selectionHeaderMain = selectionHeader.createDiv({
					cls: "hermes-sidebar-selection-summary-main"
				});
				selectionHeaderMain.createDiv({
					cls: "hermes-sidebar-selection-label",
					text: "Selection"
				});
				selectionHeaderMain.createDiv({
					cls: "hermes-sidebar-selection-text",
					text: formatSelectionPreview(liveContext.selectionText)
				});
				const selectionHeaderSide = selectionHeader.createDiv({
					cls: "hermes-sidebar-selection-summary-side"
				});
				selectionHeaderSide.createDiv({
					cls: "hermes-sidebar-selection-meta",
					text: summarizeSelectionLength(liveContext.selectionText)
				});
				const clearButton = selectionHeaderSide.createEl("button", {
					cls: "hermes-sidebar-clear-selection",
					text: "Clear"
				});
				clearButton.addEventListener("click", (event) => {
					event.preventDefault();
					event.stopPropagation();
					this.plugin.clearSelectionSnapshot(true);
				});
				selectionBox.createDiv({
					cls: "hermes-sidebar-selection-fulltext",
					text: liveContext.selectionText
				});
			}
		}

		const statusText = this.buildStatusText();
		if (statusText) {
			root.createDiv({
				cls: "hermes-sidebar-status",
				text: statusText
			});
		}

		if (this.queuedTurns.length > 0) {
			const queueEl = root.createDiv({ cls: "hermes-sidebar-queue" });
			queueEl.createDiv({
				cls: "hermes-sidebar-queue-title",
				text: `Queue · ${this.queuedTurns.length}`
			});
			const queueList = queueEl.createDiv({ cls: "hermes-sidebar-queue-list" });
			for (const queued of this.queuedTurns) {
				const item = queueList.createDiv({ cls: "hermes-sidebar-queue-item" });
				item.createDiv({
					cls: "hermes-sidebar-queue-text",
					text: queued.userText
				});
				const remove = item.createEl("button", {
					cls: "hermes-sidebar-queue-remove",
					text: "x"
				});
				remove.addEventListener("click", () => {
					this.queuedTurns = this.queuedTurns.filter((turn) => turn.id !== queued.id);
					this.statusText = this.queuedTurns.length > 0
						? `队列里还有 ${this.queuedTurns.length} 条`
						: "已清空发送队列";
					this.render(false);
				});
			}
		}

		this.messagesEl = root.createDiv({ cls: "hermes-sidebar-messages" });
		if (activeSession.messages.length === 0) {
			this.messagesEl.createDiv({
				cls: "hermes-sidebar-empty-state",
				text: "Start a chat."
			});
		} else {
			for (const message of activeSession.messages) {
				this.renderChatMessage(message);
			}
		}
		const restoredScrollTop = getRestoredScrollTop(
			previousMessagesScrollTop,
			this.shouldAutoStickToBottom
		);
		if (restoredScrollTop !== undefined) {
			this.messagesEl.scrollTop = restoredScrollTop;
		}

		const composer = root.createDiv({ cls: "hermes-sidebar-composer" });
		const preserveFocus = shouldRestoreComposerFocus(
			!allowInputReset && !!this.inputEl && document.activeElement === this.inputEl,
			this.shouldAutoStickToBottom
		);
		const previousSelectionStart = preserveFocus ? this.inputEl?.selectionStart ?? null : null;
		const previousSelectionEnd = preserveFocus ? this.inputEl?.selectionEnd ?? null : null;
		const shell = composer.createDiv({ cls: "hermes-sidebar-composer-shell" });
		this.inputEl = shell.createEl("textarea", {
			cls: "hermes-sidebar-input"
		});
		this.inputEl.value = this.draftText;
		this.inputEl.placeholder =
			"Ask Hermes about this note...";
		this.inputEl.addEventListener("input", () => {
			this.draftText = this.inputEl?.value ?? "";
		});
		this.inputEl.addEventListener("paste", (event: ClipboardEvent) => {
			void this.handlePasteImages(event);
		});

		this.contextEl = shell.createDiv({ cls: "hermes-sidebar-context" });
		this.renderContextChips();

		const toolbar = shell.createDiv({ cls: "hermes-sidebar-composer-toolbar" });
		const controls = toolbar.createDiv({ cls: "hermes-sidebar-controls" });
		const attachButton = controls.createEl("button", {
			cls: "hermes-sidebar-attach-button",
			text: "图片"
		});
		const fileInput = controls.createEl("input", {
			type: "file",
			cls: "hermes-sidebar-file-input"
		});
		fileInput.accept = "image/*";
		fileInput.multiple = true;
		attachButton.addEventListener("click", () => {
			fileInput.click();
		});
		fileInput.addEventListener("change", () => {
			void this.handleFileInput(fileInput.files);
			fileInput.value = "";
		});

		const modelControl = controls.createDiv({ cls: "hermes-sidebar-control-group" });
		modelControl.createDiv({ cls: "hermes-sidebar-control-label", text: "模型" });
		this.modelSelectEl = modelControl.createEl("select", { cls: "hermes-sidebar-select" });
		for (const option of HERMES_MODEL_OPTIONS) {
			this.modelSelectEl.createEl("option", {
				value: option.value,
				text: option.label
			});
		}
		this.modelSelectEl.value = this.plugin.settings.model;
		this.modelSelectEl.addEventListener("change", async () => {
			const selected = HERMES_MODEL_OPTIONS.find((item) => item.value === this.modelSelectEl?.value);
			if (!selected) {
				return;
			}
			this.plugin.settings.model = selected.value;
			this.plugin.settings.provider = selected.provider;
			await this.plugin.saveSettings();
			this.statusText = `已切换到 ${selected.label}`;
			this.render(false);
		});

		const reasoningControl = controls.createDiv({ cls: "hermes-sidebar-control-group" });
		reasoningControl.createDiv({ cls: "hermes-sidebar-control-label", text: "思考" });
		this.reasoningSelectEl = reasoningControl.createEl("select", { cls: "hermes-sidebar-select" });
		for (const option of HERMES_REASONING_OPTIONS) {
			this.reasoningSelectEl.createEl("option", {
				value: option.value,
				text: option.label
			});
		}
		this.reasoningSelectEl.value = this.plugin.settings.reasoningEffort;
		this.reasoningSelectEl.addEventListener("change", async () => {
			const value = this.reasoningSelectEl?.value?.trim() || DEFAULT_REASONING_EFFORT;
			this.plugin.settings.reasoningEffort = value;
			await this.plugin.saveSettings();
			this.statusText = `思考强度已切到 ${this.getReasoningLabel(value)}`;
			this.render(false);
		});

		this.sendButtonEl = toolbar.createEl("button", {
			cls: "hermes-sidebar-send",
			text: this.isSending ? "Queue" : "Send"
		});
		this.sendButtonEl.addEventListener("click", () => void this.handleSend());

		this.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
			if (event.key === "Escape" && this.isSending) {
				event.preventDefault();
				this.stopActiveRun();
				return;
			}
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				void this.handleSend();
			}
		});

		if (preserveFocus && this.inputEl) {
			window.setTimeout(() => {
				this.focusComposerWithoutScroll();
				if (
					this.inputEl &&
					previousSelectionStart !== null &&
					previousSelectionEnd !== null
				) {
					this.inputEl.setSelectionRange(previousSelectionStart, previousSelectionEnd);
				}
			}, 0);
		}
	}

	private renderChatMessage(message: HermesMessage): void {
		if (!this.messagesEl) {
			return;
		}

		const row = this.messagesEl.createDiv({
			cls: `hermes-sidebar-chat-row ${message.role === "user" ? "is-user" : "is-assistant"} ${message.kind}`.trim()
		});

		const avatar = row.createDiv({
			cls: `hermes-sidebar-avatar ${message.role === "user" ? "is-user" : "is-ai"}`
		});
		if (message.role === "user") {
			avatar.setText("嘉");
		} else {
			const avatarImg = avatar.createEl("img", {
				cls: "hermes-sidebar-avatar-image"
			});
			avatarImg.src = this.getHermesAvatarSrc();
			avatarImg.alt = "Hermes";
		}

		const bubble = row.createDiv({
			cls: `hermes-sidebar-bubble ${message.kind} ${message.role === "user" ? "is-user" : "is-ai"}`
		});
		const body = bubble.createDiv({
			cls: "hermes-sidebar-message-body"
		});
		void this.renderMarkdownInto(body, message.content);
	}

	private async renderMarkdownInto(container: HTMLDivElement, content: string): Promise<void> {
		container.empty();
		await MarkdownRenderer.render(this.app, content, container, "", this);
	}

	private getHermesAvatarSrc(): string {
		if (this.hermesAvatarDataUrl) {
			return this.hermesAvatarDataUrl;
		}
		try {
			const avatarPath = resolvePluginAssetPath(
				this.app,
				this.plugin.manifest.dir ?? "",
				"hermes-avatar.png"
			);
			const bytes = readFileSync(avatarPath);
			this.hermesAvatarDataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
			return this.hermesAvatarDataUrl;
		} catch {
			return "";
		}
	}

	private renderContextChips(): void {
		if (!this.contextEl) {
			return;
		}

		this.contextEl.empty();
		if (this.pendingContexts.length === 0 && this.pendingImages.length === 0) {
			this.contextEl.classList.add("is-empty");
			return;
		}
		this.contextEl.classList.remove("is-empty");

		for (const [index, context] of this.pendingContexts.entries()) {
			const chip = this.contextEl.createDiv({ cls: "hermes-sidebar-chip" });
			chip.setText(context.label);

			const remove = chip.createEl("button", {
				cls: "hermes-sidebar-chip-remove",
				text: "x"
			});
			remove.addEventListener("click", () => {
				this.pendingContexts.splice(index, 1);
				this.renderContextChips();
			});
		}

		for (const image of this.pendingImages) {
			const chip = this.contextEl.createDiv({ cls: "hermes-sidebar-image-chip" });
			const thumb = chip.createEl("img", { cls: "hermes-sidebar-image-thumb" });
			thumb.src = image.previewDataUrl;
			thumb.alt = image.name;
			chip.createSpan({
				cls: "hermes-sidebar-image-name",
				text: image.name
			});

			const remove = chip.createEl("button", {
				cls: "hermes-sidebar-chip-remove",
				text: "x"
			});
			remove.addEventListener("click", () => {
				this.removePendingImage(image.id);
			});
		}
	}

	private removePendingImage(imageId: string): void {
		const index = this.pendingImages.findIndex((image) => image.id === imageId);
		if (index === -1) {
			return;
		}
		const [removed] = this.pendingImages.splice(index, 1);
		cleanupAttachmentFile(removed.path);
		this.renderContextChips();
	}

	private getConversationHistory(): Array<{ role: HermesRole; content: string }> {
		return this.plugin
			.getActiveSession()
			.messages
			.filter((message) => message.kind !== "progress")
			.map((message) => ({
				role: message.role,
				content: message.content
			}));
	}

	private pushProgressBubble(content: string): void {
		const text = content.trim();
		if (!text) {
			return;
		}

		const session = this.plugin.getActiveSession();
		const last = session.messages[session.messages.length - 1];
		if (last && last.kind === "progress" && last.content === text) {
			return;
		}

		session.messages.push({
			role: "assistant",
			kind: "progress",
			content: text
		});
		this.persistActiveSession(false);
	}

	private ensureStreamingFinalMessage(): HermesMessage {
		const session = this.plugin.getActiveSession();
		if (this.activeStreamingMessageIndex !== null) {
			const existing = session.messages[this.activeStreamingMessageIndex];
			if (existing && existing.kind === "final") {
				return existing;
			}
		}

		this.activeStreamingMessageIndex = session.messages.push({
			role: "assistant",
			kind: "final",
			content: "",
			pending: true
		}) - 1;

		this.persistActiveSession(false);
		return session.messages[this.activeStreamingMessageIndex];
	}

	private convertActiveStreamToProgress(): void {
		const session = this.plugin.getActiveSession();
		if (this.activeStreamingMessageIndex === null) {
			return;
		}

		const target = session.messages[this.activeStreamingMessageIndex];
		if (!target || target.kind !== "final") {
			this.activeStreamingMessageIndex = null;
			return;
		}

		target.kind = "progress";
		target.pending = false;
		target.content = target.content.trim();
		this.activeStreamingMessageIndex = null;
		this.persistActiveSession(false);
	}

	private finalizeActiveStream(finalText?: string): void {
		const session = this.plugin.getActiveSession();
		if (this.activeStreamingMessageIndex === null) {
			this.activeStreamingMessageIndex = session.messages.push({
				role: "assistant",
				kind: "final",
				content: finalText?.trim() || "(Hermes returned an empty response.)",
				pending: false
			}) - 1;
			this.persistActiveSession(false);
			return;
		}

		const target = session.messages[this.activeStreamingMessageIndex];
		if (!target || target.kind !== "final") {
			return;
		}

		if (finalText && finalText.trim()) {
			target.content = finalText.trim();
		} else if (!target.content.trim()) {
			target.content = "(Hermes returned an empty response.)";
		}
		target.pending = false;
		this.persistActiveSession(false);
	}

	private async handlePasteImages(event: ClipboardEvent): Promise<void> {
		const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
			file.type.startsWith("image/")
		);
		if (files.length === 0) {
			return;
		}

		event.preventDefault();
		await this.addPendingImages(files);
	}

	private async handleFileInput(fileList: FileList | null): Promise<void> {
		const files = Array.from(fileList ?? []).filter((file) => file.type.startsWith("image/"));
		if (files.length === 0) {
			return;
		}
		await this.addPendingImages(files);
	}

	private async addPendingImages(files: File[]): Promise<void> {
		const attachments = await Promise.all(files.map((file) => createPendingImageAttachment(file)));
		this.pendingImages.push(...attachments);
		this.statusText = attachments.length > 1 ? `已附加 ${attachments.length} 张图片` : "已附加图片";
		this.render(false);
	}

	private async handleSend(): Promise<void> {
		if (!this.inputEl) {
			return;
		}

		const text = this.inputEl.value.trim();
		const userText = buildTurnUserText(text, this.pendingImages.length);
		if (!userText) {
			new Notice("Type a message or attach an image first.");
			return;
		}

		const turn: QueuedTurn = {
			id: `queue-${Date.now()}-${++this.queueCounter}`,
			userText,
			contexts: [...this.pendingContexts],
			images: this.pendingImages.map((image) => ({ ...image })),
			liveContext: { ...this.plugin.getLiveContextInfo() },
			provider: this.plugin.settings.provider,
			model: this.plugin.settings.model,
			reasoningEffort: this.plugin.settings.reasoningEffort
		};

		this.queuedTurns.push(turn);
		this.pendingContexts = [];
		this.pendingImages = [];
		this.draftText = "";
		this.inputEl.value = "";
		if (turn.liveContext.selectionText) {
			this.plugin.clearSelectionSnapshot(false);
		}
		this.statusText = this.isSending
			? `已加入队列（还有 ${this.queuedTurns.length} 条待处理）`
			: "Hermes 已收到这条消息";
		this.render(false);
		this.focusComposerWithoutScroll();
		void this.processQueue();
	}

	private async processQueue(): Promise<void> {
		if (this.isDrainingQueue) {
			return;
		}
		this.isDrainingQueue = true;

		try {
			while (!this.isSending && this.queuedTurns.length > 0) {
				const turn = this.queuedTurns.shift();
				if (!turn) {
					break;
				}
				await this.executeTurn(turn);
			}
		} finally {
			this.isDrainingQueue = false;
			this.render(false);
		}
	}

	private async executeTurn(turn: QueuedTurn): Promise<void> {
		const session = this.plugin.getActiveSession();
		const prompt = this.composePrompt(turn.userText, turn.contexts, turn.liveContext);
		const conversationHistory = this.getConversationHistory();

		session.messages.push({
			role: "user",
			kind: "user",
			content: turn.userText
		});
		if (!session.title || session.title === DEFAULT_SESSION_TITLE) {
			session.title = buildSessionTitle(turn.userText);
		}
		this.persistActiveSession();
		this.activeStreamingMessageIndex = null;
		this.isSending = true;
		this.statusText = "Hermes 已收到这条消息";
		this.render(false);
		this.scrollMessagesToBottom();

		try {
			const run = runHermesBridge({
				binary: this.plugin.settings.hermesBinary,
				bridgeScript: resolveBridgeScriptPath(this.app, this.plugin.manifest.dir ?? ""),
				hermesRoot: DEFAULT_HERMES_ROOT,
				prompt,
				conversationHistory,
				sessionId: session.sessionId,
				provider: turn.provider,
				model: turn.model,
				reasoningEffort: turn.reasoningEffort,
				imagePaths: turn.images.map((image) => image.path),
				systemPrompt: buildHermesSystemPrompt(this.plugin.settings.systemPrompt),
				pathPrefix: this.plugin.settings.pathPrefix,
				onEvent: (event) => {
					if (event.type === "status") {
						this.statusText = event.text || this.statusText;
						this.render(false);
						return;
					}

					if (event.type === "progress") {
						if (event.text) {
							this.pushProgressBubble(event.text);
							this.statusText = "Hermes 正在继续处理";
							this.render(false);
							this.scrollMessagesToBottom();
						}
						return;
					}

					if (event.type === "delta") {
						const target = this.ensureStreamingFinalMessage();
						target.content += event.text || "";
						target.pending = true;
						this.statusText = "Hermes 正在写回复";
						this.render(false);
						this.scrollMessagesToBottom();
						return;
					}

					if (event.type === "segment_break") {
						this.convertActiveStreamToProgress();
						this.statusText = "Hermes 正在继续处理";
						this.render(false);
						this.scrollMessagesToBottom();
						return;
					}

					if (event.type === "final") {
						if (event.sessionId) {
							session.sessionId = event.sessionId;
						}
						this.finalizeActiveStream(event.text);
						this.statusText = session.sessionId ? "Connected" : "Reply received";
						this.render(false);
						this.scrollMessagesToBottom();
					}
				}
			});

			this.activeRunCancel = run.cancel;
			const result = await run.promise;

			if (result.sessionId) {
				session.sessionId = result.sessionId;
			}
			this.finalizeActiveStream(result.text);
			this.persistActiveSession();
			this.statusText = session.sessionId ? "Connected" : "Reply received";
		} catch (error) {
			if (isHermesAbortError(error)) {
				this.convertActiveStreamToProgress();
				this.pushProgressBubble("好，我先停在这里。");
				this.statusText = "当前任务已停止";
			} else {
				this.activeStreamingMessageIndex = null;
				const message = error instanceof Error ? error.message : String(error);
				session.messages.push({
					role: "assistant",
					kind: "final",
					content: `Hermes call failed.\n\n${message}`
				});
				this.persistActiveSession();
				this.statusText = "Hermes call failed";
				new Notice("Hermes request failed. Check the sidebar for details.");
			}
		} finally {
			for (const image of turn.images) {
				cleanupAttachmentFile(image.path);
			}
			this.activeRunCancel = undefined;
			this.isSending = false;
			this.render(false);
			this.scrollMessagesToBottom();
		}
	}

	private stopActiveRun(): void {
		if (!this.isSending || !this.activeRunCancel) {
			return;
		}
		this.statusText = "正在停止当前任务";
		this.activeRunCancel();
		this.render(false);
	}

	private persistActiveSession(touch = true): void {
		const session = this.plugin.getActiveSession();
		const firstUserMessage = session.messages.find((message) => message.role === "user");
		this.plugin.saveSessionSnapshot(
			session.id,
			{
				title: firstUserMessage ? buildSessionTitle(firstUserMessage.content) : session.title,
				messages: session.messages,
				sessionId: session.sessionId
			},
			touch
		);
	}

	private composePrompt(userText: string, contexts: PendingContext[], liveContext: LiveContextInfo): string {
		const liveBlocks: string[] = [];

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
			liveBlocks.push(`## Current selection\n${liveContext.selectionText}`);
		}

		if (contexts.length === 0 && liveBlocks.length === 0) {
			return userText;
		}

		const contextBlocks = contexts
			.map((context) => `## ${context.label}\n${context.content}`)
			.join("\n\n");

		return [
			"The following Obsidian context is attached for this turn.",
			...liveBlocks,
			contextBlocks,
			"## User request",
			userText
		]
			.filter(Boolean)
			.join("\n\n");
	}

	private buildStatusText(): string {
		const parts: string[] = [];
		if (!shouldHideStatusText(this.statusText)) {
			parts.push(this.statusText);
		}
		if (this.queuedTurns.length > 0) {
			parts.push(`Queue ${this.queuedTurns.length}`);
		}
		if (this.isSending) {
			parts.push("Esc 停止");
		}
		return parts.join(" · ");
	}

	private getModelLabel(value: string): string {
		return HERMES_MODEL_OPTIONS.find((option) => option.value === value)?.label ?? value;
	}

	private getReasoningLabel(value: string): string {
		return HERMES_REASONING_OPTIONS.find((option) => option.value === value)?.label ?? value;
	}

	private scrollMessagesToBottom(): void {
		if (!this.messagesEl || !this.shouldAutoStickToBottom) {
			return;
		}
		this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
	}

	private captureScrollIntent(): void {
		if (!this.messagesEl) {
			this.shouldAutoStickToBottom = true;
			return;
		}
		this.shouldAutoStickToBottom = shouldStickToBottom({
			scrollTop: this.messagesEl.scrollTop,
			clientHeight: this.messagesEl.clientHeight,
			scrollHeight: this.messagesEl.scrollHeight
		});
	}
}

class HermesSidebarSettingTab extends PluginSettingTab {
	private plugin: HermesSidebarPlugin;

	constructor(app: App, plugin: HermesSidebarPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Hermes Sidebar Settings" });

		new Setting(containerEl)
			.setName("Hermes binary")
			.setDesc("Optional explicit Hermes binary path. If left as 'hermes', the PATH prefix below is used.")
			.addText((text) =>
				text
					.setPlaceholder("hermes")
					.setValue(this.plugin.settings.hermesBinary)
					.onChange(async (value) => {
						this.plugin.settings.hermesBinary = value.trim() || DEFAULT_HERMES_BINARY;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Provider")
			.setDesc("Primary Hermes provider for Obsidian chat.")
			.addText((text) =>
				text.setValue(this.plugin.settings.provider).onChange(async (value) => {
					this.plugin.settings.provider = value.trim() || DEFAULT_PROVIDER;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Model")
			.setDesc("Primary Hermes model for Obsidian chat.")
			.addText((text) =>
				text.setValue(this.plugin.settings.model).onChange(async (value) => {
					this.plugin.settings.model = value.trim() || DEFAULT_MODEL;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Reasoning effort")
			.setDesc("Default reasoning strength used by the Obsidian sidebar.")
			.addText((text) =>
				text.setValue(this.plugin.settings.reasoningEffort).onChange(async (value) => {
					this.plugin.settings.reasoningEffort = value.trim() || DEFAULT_REASONING_EFFORT;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("PATH prefix")
			.setDesc("Prepended to PATH so Obsidian can resolve the Hermes Python environment.")
			.addTextArea((text) =>
				text
					.setValue(this.plugin.settings.pathPrefix)
					.onChange(async (value) => {
						this.plugin.settings.pathPrefix = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("System prompt")
			.setDesc("A short instruction injected before each turn.")
			.addTextArea((text) =>
				text
					.setValue(this.plugin.settings.systemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.systemPrompt = value.trim();
						await this.plugin.saveSettings();
					})
			);
	}
}

function runHermesBridge(input: {
	binary: string;
	bridgeScript: string;
	hermesRoot: string;
	prompt: string;
	conversationHistory: Array<{ role: HermesRole; content: string }>;
	sessionId?: string;
	provider: string;
	model: string;
	reasoningEffort: string;
	imagePaths?: string[];
	systemPrompt: string;
	pathPrefix: string;
	onEvent?: (event: HermesBridgeEvent) => void;
}): HermesBridgeRun {
	const binaryDir = input.binary.includes("/") ? dirname(input.binary) : "";
	const pythonCommand = binaryDir ? join(binaryDir, "python") : "python";

	const prefixParts = input.pathPrefix
		.split(delimiter)
		.map((part) => part.trim())
		.filter(Boolean);
	if (binaryDir) {
		prefixParts.unshift(binaryDir);
	}
	const currentParts = (process.env.PATH ?? "")
		.split(delimiter)
		.map((part) => part.trim())
		.filter(Boolean);

	const env = {
		...process.env,
		PATH: [...prefixParts, ...currentParts].join(delimiter),
		HERMES_AGENT_ROOT: input.hermesRoot,
		PYTHONUNBUFFERED: "1"
	};

	let child: ReturnType<typeof spawn> | null = null;
	let canceled = false;

	const promise = new Promise<HermesRunResult>((resolve, reject) => {
		child = spawn(pythonCommand, [input.bridgeScript], {
			env,
			cwd: input.hermesRoot,
			stdio: ["pipe", "pipe", "pipe"]
		});

		let stdoutBuffer = "";
		let stderrBuffer = "";
		let settled = false;
		let finalResult: HermesRunResult | null = null;

		const handleEvent = (event: HermesBridgeEvent) => {
			if (!event || typeof event !== "object") {
				return;
			}

			if (event.type === "error") {
				if (!settled) {
					settled = true;
					reject(new Error(canceled ? "__HERMES_ABORTED__" : (event.message || "Hermes bridge error")));
				}
				return;
			}

			if (event.type === "final") {
				finalResult = {
					text: event.text || "",
					sessionId: event.sessionId ?? input.sessionId,
					rawOutput: cleanOutputForDisplay(stderrBuffer)
				};
			}

			input.onEvent?.(event);
		};

		const flushStdoutLines = (finalFlush = false) => {
			const lines = stdoutBuffer.split("\n");
			if (!finalFlush) {
				stdoutBuffer = lines.pop() ?? "";
			} else {
				stdoutBuffer = "";
			}

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed) {
					continue;
				}
				try {
					handleEvent(JSON.parse(trimmed) as HermesBridgeEvent);
				} catch {
					// Ignore bridge noise that is not JSON.
				}
			}
		};

		child.stdout?.on("data", (chunk) => {
			stdoutBuffer += chunk.toString();
			flushStdoutLines(false);
		});

		child.stderr?.on("data", (chunk) => {
			stderrBuffer += chunk.toString();
		});

		child.stdin?.on("error", () => {
			// Best-effort write: broken pipe simply means the bridge exited early.
		});

		child.on("error", (error) => {
			if (settled) {
				return;
			}
			settled = true;
			reject(error);
		});

		child.on("close", (code) => {
			if (settled) {
				return;
			}
			flushStdoutLines(true);
			if (canceled) {
				settled = true;
				reject(new Error("__HERMES_ABORTED__"));
				return;
			}
			if (code && code !== 0) {
				settled = true;
				reject(new Error(cleanOutputForDisplay(stderrBuffer) || `Hermes bridge exited with code ${code}`));
				return;
			}

			settled = true;
			resolve(finalResult ?? {
				text: "",
				sessionId: input.sessionId,
				rawOutput: cleanOutputForDisplay(stderrBuffer)
			});
		});

		const payload: HermesBridgePayload = {
			prompt: input.prompt,
			systemPrompt: input.systemPrompt,
			provider: input.provider,
			model: input.model,
			reasoningEffort: input.reasoningEffort,
			sessionId: input.sessionId,
			imagePaths: input.imagePaths,
			conversationHistory: input.conversationHistory
		};

		try {
			child.stdin?.write(JSON.stringify(payload));
			child.stdin?.end();
		} catch (error) {
			if (!settled) {
				settled = true;
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		}
	});

	return {
		promise,
		cancel: () => {
			if (!child || child.killed) {
				return;
			}
			canceled = true;
			child.kill("SIGTERM");
			window.setTimeout(() => {
				if (child && !child.killed) {
					child.kill("SIGKILL");
				}
			}, 1200);
		}
	};
}

function buildHermesSystemPrompt(basePrompt: string): string {
	const trimmed = basePrompt.trim();
	const progressInstruction = [
		"While working, you may send brief interim assistant messages to the user in natural Chinese.",
		"Use those interim messages like real progress updates someone would actually say in chat.",
		"Keep them short and warm.",
		"Do not reveal chain-of-thought, raw tool logs, internal trace text, or hidden reasoning.",
		"Keep the final answer separate from any interim progress updates."
	].join(" ");

	return trimmed ? `${trimmed}\n\n${progressInstruction}` : progressInstruction;
}

function resolveBridgeScriptPath(app: App, manifestDir: string): string {
	if (manifestDir && isAbsolute(manifestDir)) {
		return resolve(join(manifestDir, DEFAULT_HERMES_BRIDGE));
	}

	const vaultBasePath = (app.vault as unknown as { adapter?: { basePath?: string } }).adapter?.basePath;
	if (vaultBasePath && manifestDir) {
		return resolve(vaultBasePath, manifestDir, DEFAULT_HERMES_BRIDGE);
	}

	if (vaultBasePath) {
		return resolve(vaultBasePath, ".obsidian/plugins/hermes-sidebar", DEFAULT_HERMES_BRIDGE);
	}

	return resolve(".obsidian/plugins/hermes-sidebar", DEFAULT_HERMES_BRIDGE);
}

function resolvePluginAssetPath(app: App, manifestDir: string, assetName: string): string {
	if (manifestDir && isAbsolute(manifestDir)) {
		return resolve(join(manifestDir, assetName));
	}

	const vaultBasePath = (app.vault as unknown as { adapter?: { basePath?: string } }).adapter?.basePath;
	if (vaultBasePath && manifestDir) {
		return resolve(vaultBasePath, manifestDir, assetName);
	}

	if (vaultBasePath) {
		return resolve(vaultBasePath, ".obsidian/plugins/hermes-sidebar", assetName);
	}

	return resolve(".obsidian/plugins/hermes-sidebar", assetName);
}

function cleanOutputForDisplay(output: string): string {
	return output
		.replace(/\u001b\[[0-9;]*m/g, "")
		.replace(/\r\n/g, "\n")
		.trim();
}

function isHermesAbortError(error: unknown): boolean {
	return error instanceof Error && error.message === "__HERMES_ABORTED__";
}

function cloneMessages(messages: HermesMessage[]): HermesMessage[] {
	return messages.map((message) => ({ ...message }));
}

function createChatSession(seed?: Partial<HermesChatSession>): HermesChatSession {
	const now = Date.now();
	return {
		id: seed?.id ?? `session-${now}-${Math.random().toString(36).slice(2, 8)}`,
		title: seed?.title?.trim() || DEFAULT_SESSION_TITLE,
		createdAt: seed?.createdAt ?? now,
		updatedAt: seed?.updatedAt ?? now,
		sessionId: seed?.sessionId,
		messages: cloneMessages(seed?.messages ?? [])
	};
}

function restoreSessions(input?: HermesChatSession[]): HermesChatSession[] {
	if (!Array.isArray(input) || input.length === 0) {
		return [createChatSession()];
	}

	const restored = input
		.filter((session) => isPlainObject(session) && typeof session.id === "string")
		.map((session) =>
			createChatSession({
				id: session.id,
				title: typeof session.title === "string" ? session.title : DEFAULT_SESSION_TITLE,
				createdAt: typeof session.createdAt === "number" ? session.createdAt : Date.now(),
				updatedAt: typeof session.updatedAt === "number" ? session.updatedAt : Date.now(),
				sessionId: typeof session.sessionId === "string" ? session.sessionId : undefined,
				messages: Array.isArray(session.messages)
					? session.messages.filter(isHermesMessage)
					: []
			})
		);

	return restored.length > 0 ? restored : [createChatSession()];
}

function isPersistedDataShape(value: unknown): value is HermesPersistedData {
	if (!isPlainObject(value)) {
		return false;
	}
	if ("sessions" in value && value.sessions !== undefined && !Array.isArray(value.sessions)) {
		return false;
	}
	if ("activeSessionId" in value && value.activeSessionId !== undefined && typeof value.activeSessionId !== "string") {
		return false;
	}
	return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function isHermesMessage(value: unknown): value is HermesMessage {
	if (!isPlainObject(value)) {
		return false;
	}
	return (
		(value.role === "user" || value.role === "assistant" || value.role === "system") &&
		(value.kind === "user" || value.kind === "progress" || value.kind === "final") &&
		typeof value.content === "string"
	);
}

function summarizeSelectionLength(text: string): string {
	const compact = text.replace(/\s+/g, " ").trim();
	if (!compact) {
		return "0 chars";
	}
	return `${compact.length} chars`;
}

async function createPendingImageAttachment(file: File): Promise<PendingImageAttachment> {
	const extension = normalizeImageExtension(file);
	const buffer = Buffer.from(await file.arrayBuffer());
	const attachmentDir = join(tmpdir(), "obsidian-hermes-sidebar");
	mkdirSync(attachmentDir, { recursive: true });
	const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const filePath = join(attachmentDir, `${id}${extension}`);
	writeFileSync(filePath, buffer);
	return {
		id,
		name: file.name || basename(filePath),
		path: filePath,
		previewDataUrl: `data:${file.type || mimeTypeFromExtension(extension)};base64,${buffer.toString("base64")}`
	};
}

function cleanupAttachmentFile(path: string): void {
	if (!path) {
		return;
	}
	try {
		unlinkSync(path);
	} catch {
		// Best effort cleanup.
	}
}

function normalizeImageExtension(file: File): string {
	const raw = extname(file.name || "").trim().toLowerCase();
	if (raw) {
		return raw;
	}
	const type = (file.type || "").toLowerCase();
	if (type === "image/jpeg") {
		return ".jpg";
	}
	if (type === "image/webp") {
		return ".webp";
	}
	if (type === "image/gif") {
		return ".gif";
	}
	return ".png";
}

function mimeTypeFromExtension(extension: string): string {
	switch (extension) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		case ".gif":
			return "image/gif";
		default:
			return "image/png";
	}
}

export default HermesSidebarPlugin;
