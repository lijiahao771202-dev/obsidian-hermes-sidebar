import {
	App,
	EditorPosition,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	Modal,
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
	adjustIndexAfterInsertion,
	buildSessionTitle,
	canUpdateBridgeEventWithoutFullRender,
	formatSelectionPreview,
	getAppendIndexAfterTurnMessages,
	getNextStickToBottom,
	getRestoredScrollTop,
	pickNextActiveSessionId,
	pickSelectionText,
	shouldDeferScrollRestore,
	shouldHideStatusText,
	shouldMergeActivityEntry,
	shouldRefreshSelectionSnapshot,
	shouldRestoreComposerFocus,
	shouldShowActivityEntry,
	shouldStickToBottom
} from "./session-helpers";
import { buildTurnUserText, composeObsidianPrompt } from "./bridge-helpers";
import { InlineEditManager, type InlineEditRunInput } from "./inline-edit";

const VIEW_TYPE_HERMES_SIDEBAR = "hermes-sidebar-view";
const DEFAULT_HERMES_BINARY = "hermes";
const DEFAULT_PROVIDER = "xiaomi";
const DEFAULT_MODEL = "mimo-v2.5";
const DEFAULT_FALLBACK_PROVIDER = "deepseek";
const DEFAULT_FALLBACK_MODEL = "deepseek-v4-flash";
const DEFAULT_HERMES_PATH_PREFIX = "/Users/lijiahao/.hermes/hermes-agent/venv/bin:/Users/lijiahao/.local/bin:";
const DEFAULT_HERMES_ROOT = "/Users/lijiahao/.hermes/hermes-agent";
const DEFAULT_HERMES_BRIDGE = "hermes_bridge.py";
const DEFAULT_REASONING_EFFORT = "high";
const HERMES_MODEL_OPTIONS = [
	{
		label: "MiMo 2.5",
		shortLabel: "MiMo",
		value: "mimo-v2.5",
		provider: "xiaomi"
	},
	{
		label: "DeepSeek V4 Flash",
		shortLabel: "DS Flash",
		value: "deepseek-v4-flash",
		provider: "deepseek"
	},
	{
		label: "DeepSeek V4 Pro",
		shortLabel: "DS Pro",
		value: "deepseek-v4-pro",
		provider: "deepseek"
	}
] as const;
const HERMES_REASONING_OPTIONS = [
	{ label: "关闭", value: "none" },
	{ label: "低", value: "low" },
	{ label: "中", value: "medium" },
	{ label: "高", value: "high" },
	{ label: "超强", value: "xhigh" }
] as const;

type HermesRole = "user" | "assistant" | "system";
type HermesMessageKind = "user" | "progress" | "activity" | "final";

interface HermesMessageAttachment {
	type: "image";
	name: string;
	previewDataUrl: string;
}

interface HermesMessage {
	id?: string;
	role: HermesRole;
	kind: HermesMessageKind;
	content: string;
	pending?: boolean;
	interim?: boolean;
	attachments?: HermesMessageAttachment[];
	activities?: HermesActivityEntry[];
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
	type: "status" | "activity" | "progress" | "delta" | "segment_break" | "final" | "error";
	text?: string;
	message?: string;
	sessionId?: string;
	eventType?: string;
	toolName?: string;
	preview?: string;
	status?: "running" | "done" | "error" | "info";
	duration?: number;
	isError?: boolean;
}

interface HermesBridgeRun {
	promise: Promise<HermesRunResult>;
	cancel: () => void;
}

interface HermesActivityEntry {
	id: string;
	text: string;
	toolName?: string;
	preview?: string;
	status: "running" | "done" | "error" | "info";
	duration?: number;
	createdAt: number;
}

interface LocalActivityInput {
	text: string;
	preview?: string;
	status?: "running" | "done" | "error" | "info";
	toolName?: string;
}

interface RenderedChatMessage {
	row: HTMLDivElement;
	bubble: HTMLDivElement;
	body: HTMLDivElement;
	activity?: HTMLElement;
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
	systemPrompt: "You are Hermes inside Obsidian. Be concise, context-aware, and helpful with note-writing tasks.",
	pathPrefix: DEFAULT_HERMES_PATH_PREFIX
};

class HermesSidebarPlugin extends Plugin {
	settings: HermesSidebarSettings;
	private inlineEditManager: InlineEditManager | null = null;
	private selectionSnapshot = "";
	private refreshTimer: number | null = null;
	private isPointerSelecting = false;
	private lastActiveNotePath = "";
	private lastActiveNoteTitle = "";
	private chatSessions: HermesChatSession[] = [];
	private activeSessionId = "";

	async onload(): Promise<void> {
		await this.loadSettings();

		this.inlineEditManager = new InlineEditManager({
			plugin: this,
			app: this.app,
			getSettings: () => ({
				provider: this.settings.provider,
				model: this.settings.model,
				reasoningEffort: this.settings.reasoningEffort,
				systemPrompt: this.settings.systemPrompt
			}),
			run: (input) => runInlineHermesBridge(this, input)
		});

		this.registerView(VIEW_TYPE_HERMES_SIDEBAR, (leaf) => new HermesSidebarView(leaf, this));

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

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
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
			})
		);

		this.registerEvent(
			this.app.workspace.on("file-open", () => {
				const markdownView = this.getActiveMarkdownView();
				this.selectionSnapshot = "";
				this.lastActiveNotePath = markdownView?.file?.path ?? this.lastActiveNotePath;
				this.lastActiveNoteTitle = markdownView?.file?.basename ?? this.lastActiveNoteTitle;
				this.scheduleRefreshSidebarViews();
			})
		);

		this.registerDomEvent(document, "selectionchange", () => {
			const selection = this.getCurrentSelectionText();
			if (
				shouldRefreshSelectionSnapshot({
					nextSelection: selection,
					currentSnapshot: this.selectionSnapshot,
					isPointerDown: this.isPointerSelecting,
					keepExistingWhenEmpty: this.isEventInsideHermesSidebar()
				})
			) {
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
			if (
				shouldRefreshSelectionSnapshot({
					nextSelection: selection,
					currentSnapshot: this.selectionSnapshot,
					isPointerDown: false,
					keepExistingWhenEmpty: this.isEventInsideHermesSidebar()
				})
			) {
				this.selectionSnapshot = selection;
				this.scheduleRefreshSidebarViews();
			}
		});
	}

	async onunload(): Promise<void> {
		this.inlineEditManager?.destroy();
		this.inlineEditManager = null;
		await this.app.workspace.detachLeavesOfType(VIEW_TYPE_HERMES_SIDEBAR);
	}

	async loadSettings(): Promise<void> {
		const rawData = await this.loadData();
		const persistedData = isPersistedDataShape(rawData) ? rawData : undefined;
		const legacySettings = isPlainObject(rawData) ? rawData : undefined;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, persistedData?.settings ?? legacySettings ?? {});
		this.chatSessions = restoreSessions(persistedData?.sessions);
		this.activeSessionId =
			pickNextActiveSessionId(this.chatSessions, persistedData?.activeSessionId) ?? this.chatSessions[0]?.id ?? "";
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
		const editorSelection = view ? getEditorSelectionsText(view) : "";
		const browserSelection = window.getSelection();
		const browserText = browserSelection?.toString().trim();
		const mode = view?.getMode?.() ?? "";

		if (browserSelection && browserText && browserSelection.rangeCount > 0 && view) {
			const range = browserSelection.getRangeAt(0);
			const ancestor = range.commonAncestorContainer;
			const rootElement = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : (ancestor as Element | null);

			if (
				rootElement &&
				this.app.workspace.getLeavesOfType(VIEW_TYPE_HERMES_SIDEBAR).some((leaf) => {
					const sidebarView = leaf.view as HermesSidebarView;
					return sidebarView.containerEl.contains(rootElement);
				})
			) {
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

	isEventInsideHermesSidebar(): boolean {
		const activeElement = document.activeElement;
		if (!(activeElement instanceof HTMLElement)) {
			return false;
		}
		return this.app.workspace.getLeavesOfType(VIEW_TYPE_HERMES_SIDEBAR).some((leaf) => {
			const sidebarView = leaf.view as HermesSidebarView;
			return sidebarView.containerEl.contains(activeElement);
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
			messages: input.messages,
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
			markdownView.containerEl.querySelectorAll<HTMLElement>(".cm-scroller, .markdown-preview-view, .view-content")
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
			if (markdownView?.editor && typeof snapshot.editorLeft === "number" && typeof snapshot.editorTop === "number") {
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
	private liveContextEl?: HTMLDivElement;
	private activityEl?: HTMLDivElement;
	private sendButtonEl?: HTMLButtonElement;
	private modelSelectEl?: HTMLSelectElement;
	private reasoningSelectEl?: HTMLSelectElement;
	private isSending = false;
	private isDrainingQueue = false;
	private activeStreamingMessageIndex: number | null = null;
	private streamingMessageRef?: HermesMessage;
	private streamingRowEl?: HTMLDivElement;
	private streamingBubbleEl?: HTMLDivElement;
	private streamingBodyEl?: HTMLDivElement;
	private streamingRenderToken = 0;
	private pendingStreamingRenderFrame: number | null = null;
	private activityMessageRef?: HermesMessage;
	private activityRowEl?: HTMLDivElement;
	private activityBubbleEl?: HTMLDivElement;
	private activityTimelineEl?: HTMLElement;
	private dismissedLiveNoteKey = "";
	private activeTurnUserMessageId?: string;
	private activeActivityMessageId?: string;
	private activeRunCancel?: () => void;
	private messageCounter = 0;
	private queueCounter = 0;
	private hermesAvatarDataUrl?: string;
	private isHistoryOpen = false;
	private shouldAutoStickToBottom = true;
	private pendingBottomScrollFrame: number | null = null;
	private pendingScrollRestoreFrame: number | null = null;
	private suppressNextMessagesScroll = false;
	private activityEntries: HermesActivityEntry[] = [];
	private activityCounter = 0;

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
		if (this.pendingBottomScrollFrame !== null) {
			window.cancelAnimationFrame(this.pendingBottomScrollFrame);
			this.pendingBottomScrollFrame = null;
		}
		if (this.pendingScrollRestoreFrame !== null) {
			window.cancelAnimationFrame(this.pendingScrollRestoreFrame);
			this.pendingScrollRestoreFrame = null;
		}
		this.cancelPendingStreamingRender();
		this.pendingImages = [];
		this.containerEl.empty();
	}

	requestRefresh(): void {
		if (!this.liveContextEl) {
			this.render(false);
			return;
		}
		this.renderLiveContext();
	}

	isComposerFocused(): boolean {
		return !!this.inputEl && document.activeElement === this.inputEl;
	}

	attachContext(context: PendingContext): void {
		this.pendingContexts.push(context);
		this.statusText = `已附加 ${context.label.toLowerCase()} 上下文`;
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
		this.streamingMessageRef = undefined;
		this.streamingRowEl = undefined;
		this.streamingBubbleEl = undefined;
		this.streamingBodyEl = undefined;
		this.activityMessageRef = undefined;
		this.activityRowEl = undefined;
		this.activityBubbleEl = undefined;
		this.activityTimelineEl = undefined;
		this.liveContextEl = undefined;
		this.activityEl = undefined;
		const previousMessagesScrollTop = this.messagesEl?.scrollTop ?? null;
		const wasAutoSticking = this.shouldAutoStickToBottom;
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

		const headerActions = header.createDiv({
			cls: "hermes-sidebar-header-actions"
		});
		const historyButton = headerActions.createEl("button", {
			cls: "hermes-sidebar-button",
			text: "历史"
		});
		historyButton.toggleClass("is-active", this.isHistoryOpen);
		historyButton.addEventListener("click", () => {
			this.isHistoryOpen = !this.isHistoryOpen;
			this.render(false);
		});
		const resetButton = headerActions.createEl("button", {
			cls: "hermes-sidebar-button",
			text: "新对话"
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
			this.dismissedLiveNoteKey = "";
			this.plugin.clearSelectionSnapshot(true);
			this.plugin.createSession();
			this.statusText = "已开始新对话";
			this.render();
		});
		root.toggleClass("hermes-sidebar-history-open", this.isHistoryOpen);

		const historyPanel = root.createDiv({ cls: "hermes-sidebar-history" });
		historyPanel.createDiv({
			cls: "hermes-sidebar-history-title",
			text: "最近对话"
		});
		const historyList = historyPanel.createDiv({
			cls: "hermes-sidebar-history-list"
		});
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
				this.dismissedLiveNoteKey = "";
				this.plugin.setActiveSession(session.id);
				this.statusText = "已切换对话";
				this.render();
			});
			const deleteButton = item.createEl("button", {
				cls: "hermes-sidebar-history-delete",
				text: "删除"
			});
			deleteButton.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				if (this.isSending && session.id === activeSession.id) {
					new Notice("Stop the current run before deleting this chat.");
					return;
				}
				this.plugin.deleteSession(session.id);
				this.statusText = "已删除对话";
				this.render();
			});
		}

		this.liveContextEl = root.createDiv({ cls: "hermes-sidebar-live-context" });
		this.renderLiveContext();

		if (this.queuedTurns.length > 0) {
			const queueEl = root.createDiv({ cls: "hermes-sidebar-queue" });
			queueEl.createDiv({
				cls: "hermes-sidebar-queue-title",
				text: `队列 · ${this.queuedTurns.length}`
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
					this.statusText = this.queuedTurns.length > 0 ? `队列里还有 ${this.queuedTurns.length} 条` : "已清空发送队列";
					this.render(false);
				});
			}
		}

		this.messagesEl = root.createDiv({ cls: "hermes-sidebar-messages" });
		if (activeSession.messages.length === 0) {
			this.messagesEl.createDiv({
				cls: "hermes-sidebar-empty-state",
				text: "选择一段文字，或直接向 Hermes 提问。"
			});
		} else {
			for (const [index, message] of activeSession.messages.entries()) {
				const rendered = this.renderChatMessage(message);
				if (index === this.activeStreamingMessageIndex && message.kind === "final" && rendered) {
					this.streamingMessageRef = message;
					this.streamingRowEl = rendered.row;
					this.streamingBubbleEl = rendered.bubble;
					this.streamingBodyEl = rendered.body;
				}
				if (message.id === this.activeActivityMessageId && rendered?.activity) {
					this.activityMessageRef = message;
					this.activityRowEl = rendered.row;
					this.activityBubbleEl = rendered.bubble;
					this.activityTimelineEl = rendered.activity;
				}
			}
		}
		const restoredScrollTop = getRestoredScrollTop(previousMessagesScrollTop, this.shouldAutoStickToBottom);
		if (restoredScrollTop !== undefined) {
			this.restoreMessagesScrollTop(restoredScrollTop);
		}
		this.messagesEl.addEventListener("scroll", () => {
			if (this.suppressNextMessagesScroll) {
				this.suppressNextMessagesScroll = false;
				return;
			}
			this.shouldAutoStickToBottom = shouldStickToBottom({
				scrollTop: this.messagesEl?.scrollTop ?? 0,
				clientHeight: this.messagesEl?.clientHeight ?? 0,
				scrollHeight: this.messagesEl?.scrollHeight ?? 0
			});
		});
		if (this.shouldAutoStickToBottom && wasAutoSticking) {
			this.scheduleMessagesToBottom();
		}

		const composer = root.createDiv({ cls: "hermes-sidebar-composer" });
		this.activityEl = composer.createDiv({
			cls: "hermes-sidebar-activity-slot"
		});
		this.renderActivityStatus();
		const preserveFocus = shouldRestoreComposerFocus(
			!allowInputReset && !!this.inputEl && document.activeElement === this.inputEl,
			this.shouldAutoStickToBottom
		);
		const previousSelectionStart = preserveFocus ? (this.inputEl?.selectionStart ?? null) : null;
		const previousSelectionEnd = preserveFocus ? (this.inputEl?.selectionEnd ?? null) : null;
		const shell = composer.createDiv({ cls: "hermes-sidebar-composer-shell" });
		this.inputEl = shell.createEl("textarea", {
			cls: "hermes-sidebar-input"
		});
		this.inputEl.value = this.draftText;
		this.inputEl.placeholder = "问问 Hermes：可以围绕当前笔记、选区或图片...";
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

		const modelControl = controls.createDiv({
			cls: "hermes-sidebar-control-group"
		});
		modelControl.createDiv({
			cls: "hermes-sidebar-control-label",
			text: "模型"
		});
		this.modelSelectEl = modelControl.createEl("select", {
			cls: "hermes-sidebar-select"
		});
		for (const option of HERMES_MODEL_OPTIONS) {
			this.modelSelectEl.createEl("option", {
				value: option.value,
				text: option.shortLabel
			});
		}
		this.modelSelectEl.value = this.plugin.settings.model;
		this.modelSelectEl.addEventListener("change", async (event) => {
			const select = event.currentTarget instanceof HTMLSelectElement ? event.currentTarget : this.modelSelectEl;
			const selected = HERMES_MODEL_OPTIONS.find((item) => item.value === select?.value);
			if (!selected) {
				return;
			}
			this.applyModelSelection(selected.value);
			await this.plugin.saveSettings();
			this.statusText = `已切换到 ${selected.label}`;
			this.render(false);
		});

		const reasoningControl = controls.createDiv({
			cls: "hermes-sidebar-control-group"
		});
		reasoningControl.createDiv({
			cls: "hermes-sidebar-control-label",
			text: "思考"
		});
		this.reasoningSelectEl = reasoningControl.createEl("select", {
			cls: "hermes-sidebar-select"
		});
		for (const option of HERMES_REASONING_OPTIONS) {
			this.reasoningSelectEl.createEl("option", {
				value: option.value,
				text: option.label
			});
		}
		this.reasoningSelectEl.value = this.plugin.settings.reasoningEffort;
		this.reasoningSelectEl.addEventListener("change", async (event) => {
			const select = event.currentTarget instanceof HTMLSelectElement ? event.currentTarget : this.reasoningSelectEl;
			const value = select?.value?.trim() || DEFAULT_REASONING_EFFORT;
			this.applyReasoningSelection(value);
			await this.plugin.saveSettings();
			this.statusText = `思考强度已切到 ${this.getReasoningLabel(value)}`;
			this.render(false);
		});

		this.sendButtonEl = toolbar.createEl("button", {
			cls: "hermes-sidebar-send",
			text: this.isSending ? "排队" : "发送"
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
				if (this.inputEl && previousSelectionStart !== null && previousSelectionEnd !== null) {
					this.inputEl.setSelectionRange(previousSelectionStart, previousSelectionEnd);
				}
			}, 0);
		}
	}

	private renderLiveContext(): void {
		if (!this.liveContextEl) {
			return;
		}

		this.liveContextEl.empty();
		const liveContext = this.plugin.getLiveContextInfo();
		const liveNoteKey = this.getLiveNoteKey(liveContext);
		const isNoteDismissed = !!liveNoteKey && this.dismissedLiveNoteKey === liveNoteKey;
		const hasLiveContext = !!((liveContext.noteTitle && !isNoteDismissed) || liveContext.selectionText);
		this.liveContextEl.toggleClass("is-empty", !hasLiveContext);
		this.liveContextEl.toggleClass("has-selection", !!liveContext.selectionText);
		if (!hasLiveContext) {
			return;
		}

		if (liveContext.noteTitle && !isNoteDismissed) {
			const noteChip = this.liveContextEl.createDiv({
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
			const dismissNoteButton = noteChip.createEl("button", {
				cls: "hermes-sidebar-chip-remove hermes-sidebar-live-note-dismiss",
				text: "x",
				attr: {
					type: "button",
					"aria-label": "本轮不附加当前文章"
				}
			});
			dismissNoteButton.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.dismissedLiveNoteKey = liveNoteKey;
				this.statusText = "本轮已取消附加当前文章";
				this.renderLiveContext();
				this.refreshActivityStatus();
			});
		}

		if (!liveContext.selectionText) {
			return;
		}

		const selectionBox = this.liveContextEl.createEl("details", {
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
			text: "清除"
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

	private refreshActivityStatus(): void {
		if (!this.activityEl) {
			return;
		}
		this.renderActivityStatus();
	}

	private renderChatMessage(
		message: HermesMessage,
		options: { deferBodyRender?: boolean } = {}
	): RenderedChatMessage | null {
		if (!this.messagesEl) {
			return null;
		}
		if (message.kind === "activity" && !this.hasVisibleActivities(message)) {
			return null;
		}
		const hasAttachments = (message.attachments ?? []).length > 0;

		const row = this.messagesEl.createDiv({
			cls: [
				"hermes-sidebar-chat-row",
				message.kind === "activity" ? "is-activity" : "",
				message.role === "user" ? "is-user" : "is-assistant",
				message.kind,
				hasAttachments ? "has-attachments" : ""
			]
				.filter(Boolean)
				.join(" ")
		});
		if (message.id) {
			row.dataset.hermesMessageId = message.id;
		}

		if (message.kind === "activity") {
			const activity = this.renderMessageActivityTimeline(row, message);
			return { row, bubble: row, body: row, activity };
		}

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
			cls: [
				"hermes-sidebar-bubble",
				message.kind,
				message.role === "user" ? "is-user" : "is-ai",
				hasAttachments ? "has-attachments" : ""
			]
				.filter(Boolean)
				.join(" ")
		});
		const body = bubble.createDiv({
			cls: "hermes-sidebar-message-body"
		});
		if (!options.deferBodyRender) {
			void this.renderMarkdownInto(body, message.content);
		}
		this.renderMessageAttachments(bubble, message);
		return { row, bubble, body };
	}

	private hasVisibleActivities(message: HermesMessage): boolean {
		return (message.activities ?? []).some(
			(entry) => isHermesActivityEntry(entry) && shouldShowActivityEntry(entry.toolName)
		);
	}

	private renderMessageActivityTimeline(container: HTMLDivElement, message: HermesMessage): HTMLElement | undefined {
		const activities = (message.activities ?? []).filter(
			(entry) => isHermesActivityEntry(entry) && shouldShowActivityEntry(entry.toolName)
		);
		if (activities.length === 0 || message.role !== "assistant") {
			return undefined;
		}

		const isRunning = message.pending || activities.some((entry) => entry.status === "running");
		const trace = container.createDiv({
			cls: "hermes-sidebar-run-trace"
		});
		trace.toggleClass("is-running", isRunning);

		const list = trace.createDiv({ cls: "hermes-sidebar-run-steps" });
		for (const [index, entry] of activities.entries()) {
			const item = list.createDiv({
				cls: `hermes-sidebar-run-step is-${entry.status}`
			});
			item.createDiv({
				cls: "hermes-sidebar-run-step-rail",
				attr: { "aria-hidden": "true" }
			});
			const content = item.createDiv({
				cls: "hermes-sidebar-run-step-content"
			});
			const header = content.createDiv({
				cls: "hermes-sidebar-run-step-header"
			});
			header.createSpan({
				cls: "hermes-sidebar-run-step-name",
				text: formatActivityTitleForTimeline(entry, index)
			});
			header.createSpan({
				cls: "hermes-sidebar-run-step-state",
				text: formatActivityState(entry)
			});
			if (entry.preview) {
				if (entry.toolName === "thinking") {
					const thinkingPreview = content.createEl("details", {
						cls: "hermes-sidebar-run-step-preview hermes-sidebar-thinking-preview"
					});
					thinkingPreview.createEl("summary", {
						cls: "hermes-sidebar-thinking-preview-summary",
						text: "查看思考内容"
					});
					thinkingPreview.createDiv({
						cls: "hermes-sidebar-thinking-preview-body",
						text: entry.preview
					});
				} else {
					content.createDiv({
						cls: "hermes-sidebar-run-step-preview",
						text: entry.preview
					});
				}
			}
			const meta = formatActivityMeta(entry);
			if (meta) {
				content.createDiv({
					cls: "hermes-sidebar-run-step-meta",
					text: meta
				});
			}
		}

		return trace;
	}

	private ensureStreamingMessageElements(target: HermesMessage): HTMLDivElement | null {
		if (
			this.streamingMessageRef === target &&
			this.streamingRowEl?.isConnected &&
			this.streamingBubbleEl?.isConnected &&
			this.streamingBodyEl?.isConnected
		) {
			return this.streamingBodyEl;
		}

		const existingRow = this.findRenderedMessageRow(target);
		if (existingRow) {
			const bubble = existingRow.querySelector<HTMLDivElement>(".hermes-sidebar-bubble");
			const body = bubble?.querySelector<HTMLDivElement>(".hermes-sidebar-message-body");
			if (bubble && body) {
				this.streamingMessageRef = target;
				this.streamingRowEl = existingRow;
				this.streamingBubbleEl = bubble;
				this.streamingBodyEl = body;
				return body;
			}
		}

		const rendered = this.renderChatMessage(target, { deferBodyRender: true });
		if (!rendered) {
			return null;
		}

		this.streamingMessageRef = target;
		this.streamingRowEl = rendered.row;
		this.streamingBubbleEl = rendered.bubble;
		this.streamingBodyEl = rendered.body;
		return rendered.body;
	}

	private queueStreamingMessageRender(target: HermesMessage): void {
		const body = this.ensureStreamingMessageElements(target);
		if (!body) {
			return;
		}

		if (this.pendingStreamingRenderFrame !== null) {
			return;
		}

		this.pendingStreamingRenderFrame = window.requestAnimationFrame(() => {
			this.pendingStreamingRenderFrame = null;
			const currentBody = this.ensureStreamingMessageElements(target);
			if (!currentBody) {
				return;
			}
			void this.renderStreamingMarkdownInto(currentBody, target.content);
		});
	}

	private cancelPendingStreamingRender(): void {
		if (this.pendingStreamingRenderFrame === null) {
			return;
		}

		window.cancelAnimationFrame(this.pendingStreamingRenderFrame);
		this.pendingStreamingRenderFrame = null;
	}

	private renderMessageAttachments(container: HTMLDivElement, message: HermesMessage): void {
		const images = (message.attachments ?? []).filter((attachment) => attachment.type === "image");
		if (images.length === 0) {
			return;
		}

		const gallery = container.createDiv({
			cls: "hermes-sidebar-message-images"
		});
		for (const image of images) {
			const preview = gallery.createEl("button", {
				cls: "hermes-sidebar-message-image-button",
				attr: {
					type: "button",
					"aria-label": `查看图片 ${image.name || ""}`.trim()
				}
			});
			const thumb = preview.createEl("img", {
				cls: "hermes-sidebar-message-image"
			});
			thumb.src = image.previewDataUrl;
			thumb.alt = image.name || "Attached image";
			thumb.title = image.name || "Attached image";
			thumb.addEventListener("load", () => this.scheduleMessagesToBottom());
			preview.addEventListener("click", () => new HermesImagePreviewModal(this.app, image).open());
		}
	}

	private renderActivityStatus(): void {
		if (!this.activityEl) {
			return;
		}

		this.activityEl.empty();
		const statusText = this.buildStatusText();
		if (!statusText && this.activityEntries.length === 0) {
			return;
		}

		const panel = this.activityEl.createDiv({ cls: "hermes-sidebar-activity" });
		const header = panel.createDiv({ cls: "hermes-sidebar-activity-header" });
		header.createDiv({
			cls: "hermes-sidebar-activity-status",
			text: statusText || "活动记录"
		});

		const toggle = header.createEl("button", {
			cls: "hermes-sidebar-activity-toggle",
			text: "过程",
			attr: { type: "button" }
		});
		toggle.disabled = this.activityEntries.length === 0;
		toggle.addEventListener("click", () => {
			this.revealInlineActivityTimeline();
		});
	}

	private revealInlineActivityTimeline(): void {
		if (!this.activityTimelineEl?.isConnected) {
			const target = this.getActiveActivityMessage();
			if (target) {
				this.ensureActivityMessageElements(target);
			}
		}
		if (this.activityTimelineEl instanceof HTMLDetailsElement) {
			this.activityTimelineEl.open = true;
		}
		this.scheduleMessagesToBottom();
	}

	private settleInlineActivityTimeline(): void {
		const target = this.getActiveActivityMessage();
		if (target?.role === "assistant" && target.kind === "activity") {
			this.settleActivityMessage(target);
			const timeline = this.ensureActivityMessageElements(target);
			const bubble = this.activityBubbleEl;
			if (timeline && bubble) {
				timeline.remove();
				this.activityTimelineEl = this.renderMessageActivityTimeline(bubble, target);
			}
			this.persistActiveSession(false);
		}
	}

	private async renderMarkdownInto(container: HTMLDivElement, content: string): Promise<void> {
		container.empty();
		await MarkdownRenderer.render(this.app, content, container, "", this);
		this.scheduleMessagesToBottom();
	}

	private async renderStreamingMarkdownInto(container: HTMLDivElement, content: string): Promise<void> {
		const token = ++this.streamingRenderToken;
		const scratch = document.createElement("div");
		await MarkdownRenderer.render(this.app, content, scratch, "", this);
		if (token !== this.streamingRenderToken) {
			return;
		}
		container.replaceChildren(...Array.from(scratch.childNodes));
		this.scheduleMessagesToBottom();
	}

	private getHermesAvatarSrc(): string {
		if (this.hermesAvatarDataUrl) {
			return this.hermesAvatarDataUrl;
		}
		try {
			const avatarPath = resolvePluginAssetPath(this.app, this.plugin.manifest.dir ?? "", "hermes-avatar.png");
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
			const chip = this.contextEl.createDiv({
				cls: "hermes-sidebar-image-chip"
			});
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

	private applyModelSelection(value: string): void {
		const selected = HERMES_MODEL_OPTIONS.find((item) => item.value === value);
		if (!selected) {
			return;
		}
		this.plugin.settings.model = selected.value;
		this.plugin.settings.provider = selected.provider;
	}

	private applyReasoningSelection(value: string): void {
		const selected = HERMES_REASONING_OPTIONS.find((item) => item.value === value);
		this.plugin.settings.reasoningEffort = selected?.value ?? DEFAULT_REASONING_EFFORT;
	}

	private syncComposerSettingsFromControls(): void {
		if (this.modelSelectEl) {
			this.applyModelSelection(this.modelSelectEl.value);
		}
		if (this.reasoningSelectEl) {
			this.applyReasoningSelection(this.reasoningSelectEl.value);
		}
	}

	private getLiveNoteKey(liveContext = this.plugin.getLiveContextInfo()): string {
		return (liveContext.notePath || liveContext.noteTitle || "").trim();
	}

	private getActiveTurnLiveContext(): LiveContextInfo {
		const liveContext = { ...this.plugin.getLiveContextInfo() };
		const liveNoteKey = this.getLiveNoteKey(liveContext);
		if (liveNoteKey && this.dismissedLiveNoteKey === liveNoteKey) {
			delete liveContext.noteTitle;
			delete liveContext.notePath;
		}
		return liveContext;
	}

	private nextMessageId(prefix: string): string {
		return `${prefix}-${Date.now()}-${++this.messageCounter}`;
	}

	private getConversationHistory(): Array<{
		role: HermesRole;
		content: string;
	}> {
		return this.plugin
			.getActiveSession()
			.messages.filter((message) => !message.interim && message.kind !== "progress" && message.kind !== "activity")
			.map((message) => ({
				role: message.role,
				content: message.content
			}));
	}

	private appendInterimAssistantMessage(content: string): void {
		const text = content.trim();
		if (!text) {
			return;
		}

		const session = this.plugin.getActiveSession();
		this.appendTurnMessage(session, {
			id: this.nextMessageId("assistant"),
			role: "assistant",
			kind: "final",
			content: text,
			pending: false,
			interim: true
		});
		this.persistActiveSession(false);
		this.render(false);
		this.scheduleMessagesToBottom();
	}

	private appendTurnMessage(session: HermesChatSession, message: HermesMessage): number {
		const insertIndex = getAppendIndexAfterTurnMessages(session.messages, this.activeTurnUserMessageId);
		session.messages.splice(insertIndex, 0, message);
		this.activeStreamingMessageIndex = adjustIndexAfterInsertion(this.activeStreamingMessageIndex, insertIndex);
		return insertIndex;
	}

	private ensureActivityMessage(entry?: HermesActivityEntry): HermesMessage {
		const session = this.plugin.getActiveSession();
		const target: HermesMessage = {
			role: "assistant",
			kind: "activity",
			content: "",
			pending: true,
			id: this.nextMessageId("activity"),
			activities: entry ? [entry] : []
		};
		this.appendTurnMessage(session, target);
		this.activityMessageRef = target;
		this.activeActivityMessageId = target.id;
		this.activityRowEl = undefined;
		this.activityBubbleEl = undefined;
		this.activityTimelineEl = undefined;
		this.persistActiveSession(false);
		this.ensureActivityMessageElements(target);
		return target;
	}

	private ensureActivityMessageElements(target: HermesMessage): HTMLElement | null {
		if (
			this.activityMessageRef === target &&
			this.activityRowEl?.isConnected &&
			this.activityBubbleEl?.isConnected &&
			this.activityTimelineEl?.isConnected
		) {
			return this.activityTimelineEl;
		}

		if (this.activityMessageRef === target && this.activityBubbleEl?.isConnected) {
			const existing = this.activityBubbleEl.querySelector<HTMLElement>(".hermes-sidebar-run-trace");
			if (existing) {
				this.activityTimelineEl = existing;
				return existing;
			}
			const rendered = this.renderMessageActivityTimeline(this.activityBubbleEl, target);
			if (rendered) {
				this.activityTimelineEl = rendered;
				return rendered;
			}
		}

		const existingRow = this.findRenderedMessageRow(target);
		if (existingRow) {
			const existingActivity = this.bindActivityMessageElements(target, existingRow);
			if (existingActivity) {
				return existingActivity;
			}
		}

		const rendered = this.renderChatMessage(target);
		if (!rendered?.activity) {
			return null;
		}
		this.activityMessageRef = target;
		this.activityRowEl = rendered.row;
		this.activityBubbleEl = rendered.bubble;
		this.activityTimelineEl = rendered.activity;
		this.scheduleMessagesToBottom();
		return rendered.activity;
	}

	private findRenderedMessageRow(message: HermesMessage): HTMLDivElement | null {
		if (!this.messagesEl || !message.id) {
			return null;
		}
		return (
			Array.from(this.messagesEl.querySelectorAll<HTMLDivElement>(".hermes-sidebar-chat-row")).find(
				(row) => row.dataset.hermesMessageId === message.id
			) ?? null
		);
	}

	private bindActivityMessageElements(target: HermesMessage, row: HTMLDivElement): HTMLElement | null {
		const bubble =
			target.kind === "activity" ? row : (row.querySelector<HTMLDivElement>(".hermes-sidebar-bubble") ?? undefined);
		if (!bubble) {
			return null;
		}
		let activity = bubble.querySelector<HTMLElement>(".hermes-sidebar-run-trace");
		if (!activity) {
			activity = this.renderMessageActivityTimeline(bubble, target) ?? null;
		}
		if (!activity) {
			return null;
		}
		this.activityMessageRef = target;
		this.activityRowEl = row;
		this.activityBubbleEl = bubble;
		this.activityTimelineEl = activity;
		return activity;
	}

	private pushActivityEntry(event: HermesBridgeEvent): void {
		const text = this.formatActivityText(event);
		if (!text) {
			return;
		}

		const toolName = event.toolName?.trim() || undefined;
		if (!shouldShowActivityEntry(toolName)) {
			return;
		}
		const preview = event.preview?.trim() || undefined;
		const status = event.status ?? (event.isError ? "error" : "info");
		if (toolName && toolName !== "thinking" && status === "running") {
			this.settleCurrentActivityIf((entry) => entry.toolName === "thinking" && entry.status === "running");
		}
		const existingIndex = toolName
			? this.activityEntries.findIndex(
					(entry) =>
						entry.toolName === toolName &&
						shouldMergeActivityEntry(toolName, entry.status, status, entry.preview, preview)
				)
			: -1;
		const entry: HermesActivityEntry = {
			id: `activity-${Date.now()}-${++this.activityCounter}`,
			text,
			toolName,
			preview,
			status,
			duration: typeof event.duration === "number" ? event.duration : undefined,
			createdAt: Date.now()
		};

		if (existingIndex >= 0) {
			const mergedEntry = {
				...this.activityEntries[existingIndex],
				...entry,
				id: this.activityEntries[existingIndex].id
			};
			this.activityEntries[existingIndex] = mergedEntry;
			this.updateActivityMessageByEntryId(mergedEntry.id, mergedEntry);
		} else {
			this.activityEntries.push(entry);
			this.ensureActivityMessage(entry);
		}

		this.activityEntries = this.activityEntries.slice(-20);
	}

	private getLatestVisibleActivityText(): string {
		const entry = [...this.activityEntries]
			.reverse()
			.find((item) => item.toolName !== "run.config" && item.text.trim());
		return entry?.text.trim() ?? "";
	}

	private getActivityMessageByEntryId(entryId: string): HermesMessage | undefined {
		return this.plugin
			.getActiveSession()
			.messages.find(
				(message) =>
					message.kind === "activity" &&
					message.role === "assistant" &&
					(message.activities ?? []).some((entry) => entry.id === entryId)
			);
	}

	private getActiveActivityMessage(): HermesMessage | undefined {
		if (this.activityMessageRef?.id === this.activeActivityMessageId) {
			return this.activityMessageRef;
		}
		return this.activeActivityMessageId
			? this.plugin
					.getActiveSession()
					.messages.find(
						(message) =>
							message.id === this.activeActivityMessageId &&
							message.role === "assistant" &&
							message.kind === "activity"
					)
			: undefined;
	}

	private updateActivityMessageByEntryId(entryId: string, entry: HermesActivityEntry): void {
		const message = this.getActivityMessageByEntryId(entryId);
		if (!message) {
			return;
		}
		message.activities = (message.activities ?? []).map((activity) => (activity.id === entryId ? entry : activity));
		message.pending = this.isSending && entry.status === "running";
		this.refreshActivityMessage(message);
	}

	private settleActivityMessage(message: HermesMessage): void {
		const activities = message.activities ?? [];
		for (const entry of activities) {
			if (entry.status === "running") {
				entry.status = "done";
			}
		}
		message.pending = false;
	}

	private settleCurrentActivityIf(predicate: (entry: HermesActivityEntry) => boolean): void {
		const target = this.getActiveActivityMessage();
		if (!target?.activities?.some(predicate)) {
			return;
		}
		for (const entry of target.activities) {
			if (predicate(entry)) {
				entry.status = "done";
			}
		}
		target.pending = false;
		for (const entry of this.activityEntries) {
			if (predicate(entry)) {
				entry.status = "done";
			}
		}
		this.refreshActivityMessage(target);
	}

	private refreshActivityMessage(target: HermesMessage): void {
		const timeline = this.ensureActivityMessageElements(target);
		const bubble = this.activityBubbleEl;
		if (!timeline || !bubble) {
			this.render(false);
			return;
		}

		timeline.remove();
		const nextTimeline = this.renderMessageActivityTimeline(bubble, target);
		this.activityTimelineEl = nextTimeline;
		this.persistActiveSession(false);
		this.scheduleMessagesToBottom();
	}

	private pushLocalActivity(input: LocalActivityInput): void {
		const text = input.text.trim();
		if (!text) {
			return;
		}

		const existingRunningIndex = input.toolName
			? this.activityEntries.findIndex(
					(entry) =>
						entry.toolName === input.toolName &&
						shouldMergeActivityEntry(input.toolName, entry.status, input.status ?? "info", entry.preview, input.preview)
				)
			: -1;

		const entry: HermesActivityEntry = {
			id: `activity-${Date.now()}-${++this.activityCounter}`,
			text,
			toolName: input.toolName,
			preview: input.preview?.trim() || undefined,
			status: input.status ?? "info",
			createdAt: Date.now()
		};
		if (existingRunningIndex >= 0) {
			const updatedEntry = {
				...this.activityEntries[existingRunningIndex],
				text,
				status: entry.status,
				preview: entry.preview,
				createdAt: entry.createdAt
			};
			this.activityEntries[existingRunningIndex] = updatedEntry;
			this.updateActivityMessageByEntryId(updatedEntry.id, updatedEntry);
		} else {
			this.activityEntries.push(entry);
			this.ensureActivityMessage(entry);
		}
		this.activityEntries = this.activityEntries.slice(-20);
		this.statusText = text;
	}

	private setFallbackStatus(text: string): void {
		if (!this.statusText || !this.activityEntries.length) {
			this.statusText = text;
		}
	}

	private formatActivityText(event: HermesBridgeEvent): string {
		if (event.status === "info") {
			return event.text?.trim() || event.message?.trim() || "";
		}
		const toolName = event.toolName?.trim() || "";
		const preview = event.preview?.trim() || "";
		if (event.status === "running") {
			return toolName
				? joinActivityText(formatToolStatusText(toolName, "running"), preview)
				: joinActivityText("正在调用工具", preview);
		}
		if (event.status === "done") {
			return toolName
				? joinActivityText(formatToolStatusText(toolName, "done"), preview)
				: joinActivityText("工具处理完了", preview);
		}
		if (event.status === "error" || event.isError) {
			return toolName
				? joinActivityText(formatToolStatusText(toolName, "error"), preview)
				: joinActivityText("工具调用失败", preview);
		}
		return event.text?.trim() || event.message?.trim() || "";
	}

	private ensureStreamingFinalMessage(): HermesMessage {
		const session = this.plugin.getActiveSession();
		if (this.activeStreamingMessageIndex !== null) {
			const existing = session.messages[this.activeStreamingMessageIndex];
			if (existing && existing.kind === "final") {
				this.ensureStreamingMessageElements(existing);
				return existing;
			}
		}

		const message: HermesMessage = {
			role: "assistant",
			kind: "final",
			content: "",
			pending: true,
			id: this.nextMessageId("assistant")
		};
		this.activeStreamingMessageIndex = this.appendTurnMessage(session, message);
		this.persistActiveSession(false);
		const target = session.messages[this.activeStreamingMessageIndex];
		this.ensureStreamingMessageElements(target);
		return target;
	}

	private convertActiveStreamToProgress(): void {
		const session = this.plugin.getActiveSession();
		if (this.activeStreamingMessageIndex !== null) {
			const target = session.messages[this.activeStreamingMessageIndex];
			if (target?.kind === "final" && target.content.trim()) {
				target.pending = false;
				this.cancelPendingStreamingRender();
				if (this.streamingBodyEl?.isConnected) {
					void this.renderStreamingMarkdownInto(this.streamingBodyEl, target.content);
				}
				this.persistActiveSession(false);
			}
		}
		this.activeStreamingMessageIndex = null;
		this.streamingMessageRef = undefined;
		this.streamingRowEl = undefined;
		this.streamingBubbleEl = undefined;
		this.streamingBodyEl = undefined;
	}

	private finalizeActiveStream(finalText?: string): void {
		const session = this.plugin.getActiveSession();
		if (this.activeStreamingMessageIndex === null) {
			const message: HermesMessage = {
				id: this.nextMessageId("assistant"),
				role: "assistant",
				kind: "final",
				content: finalText?.trim() || "(Hermes returned an empty response.)",
				pending: false
			};
			this.activeStreamingMessageIndex = this.appendTurnMessage(session, message);
			const target = session.messages[this.activeStreamingMessageIndex];
			this.ensureStreamingMessageElements(target);
			if (this.streamingBodyEl?.isConnected) {
				void this.renderStreamingMarkdownInto(this.streamingBodyEl, target.content);
			}
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
		this.cancelPendingStreamingRender();
		if (this.streamingBodyEl?.isConnected) {
			void this.renderStreamingMarkdownInto(this.streamingBodyEl, target.content);
		}
		if ((target.activities ?? []).length > 0) {
			this.refreshActivityMessage(target);
		}
		this.persistActiveSession(false);
	}

	private async handlePasteImages(event: ClipboardEvent): Promise<void> {
		const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
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

		this.syncComposerSettingsFromControls();
		await this.plugin.saveSettings();

		const turn: QueuedTurn = {
			id: `queue-${Date.now()}-${++this.queueCounter}`,
			userText,
			contexts: [...this.pendingContexts],
			images: this.pendingImages.map((image) => ({ ...image })),
			liveContext: this.getActiveTurnLiveContext(),
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
		this.dismissedLiveNoteKey = "";
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

		const imageAttachments: HermesMessageAttachment[] = turn.images.map((image) => ({
			type: "image",
			name: image.name,
			previewDataUrl: image.previewDataUrl
		}));
		const userMessage: HermesMessage = {
			id: this.nextMessageId("user"),
			role: "user",
			kind: "user",
			content: turn.userText
		};
		if (imageAttachments.length > 0) {
			userMessage.attachments = imageAttachments;
		}
		session.messages.push(userMessage);
		this.activeTurnUserMessageId = userMessage.id;
		if (!session.title || session.title === DEFAULT_SESSION_TITLE) {
			session.title = buildSessionTitle(turn.userText);
		}
		this.persistActiveSession();
		this.activeStreamingMessageIndex = null;
		this.activityMessageRef = undefined;
		this.activeActivityMessageId = undefined;
		this.isSending = true;
		this.activityEntries = [];
		this.statusText = "";
		this.setFallbackStatus("Hermes 已收到这条消息");
		this.render(false);
		this.scrollMessagesToBottom();
		let hasFinalized = false;

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
				systemPrompt: buildHermesSystemPrompt(this.plugin.settings.systemPrompt, {
					provider: turn.provider,
					model: turn.model,
					reasoningEffort: turn.reasoningEffort
				}),
				pathPrefix: this.plugin.settings.pathPrefix,
				onEvent: (event) => {
					if (canUpdateBridgeEventWithoutFullRender(event.type)) {
						if (event.type === "status") {
							if (this.activityEntries.length === 0 || isDetailedStatusText(event.text || "")) {
								this.statusText = event.text || this.statusText;
							}
							this.refreshActivityStatus();
							return;
						}

						if (event.type === "activity") {
							this.pushActivityEntry(event);
							const activityText = this.formatActivityText(event);
							if (activityText && event.eventType !== "run.config") {
								this.statusText = activityText;
							}
							this.refreshActivityStatus();
							return;
						}

						if (event.type === "progress") {
							if (event.text) {
								this.appendInterimAssistantMessage(event.text);
								this.statusText = `正在处理：${formatSelectionPreview(event.text, 72)}`;
								this.refreshActivityStatus();
							}
							return;
						}

						const target = this.ensureStreamingFinalMessage();
						target.content += event.text || "";
						target.pending = true;
						this.statusText = `正在写回复：已输出 ${target.content.length} chars`;
						this.queueStreamingMessageRender(target);
						this.refreshActivityStatus();
						return;
					}

					if (event.type === "segment_break") {
						this.convertActiveStreamToProgress();
						this.setFallbackStatus("Hermes 正在继续处理");
						this.refreshActivityStatus();
						this.scrollMessagesToBottom();
						return;
					}

					if (event.type === "final") {
						if (event.sessionId) {
							session.sessionId = event.sessionId;
						}
						this.finalizeActiveStream(event.text);
						this.settleInlineActivityTimeline();
						this.activeStreamingMessageIndex = null;
						hasFinalized = true;
						this.statusText = session.sessionId ? "已连接" : "已收到回复";
						this.refreshActivityStatus();
						this.scheduleMessagesToBottom();
					}
				}
			});

			this.activeRunCancel = run.cancel;
			const result = await run.promise;

			if (result.sessionId) {
				session.sessionId = result.sessionId;
			}
			if (!hasFinalized) {
				this.finalizeActiveStream(result.text);
				this.settleInlineActivityTimeline();
				this.activeStreamingMessageIndex = null;
				hasFinalized = true;
			}
			this.persistActiveSession();
			this.statusText = session.sessionId ? "已连接" : "已收到回复";
			this.refreshActivityStatus();
		} catch (error) {
			if (isHermesAbortError(error)) {
				this.convertActiveStreamToProgress();
				this.appendInterimAssistantMessage("好，我先停在这里。");
				this.settleInlineActivityTimeline();
				this.activeStreamingMessageIndex = null;
				this.statusText = "当前任务已停止";
			} else {
				this.activeStreamingMessageIndex = null;
				const message = error instanceof Error ? error.message : String(error);
				this.settleInlineActivityTimeline();
				const errorMessage: HermesMessage = {
					id: this.nextMessageId("assistant"),
					role: "assistant",
					kind: "final",
					content: `Hermes call failed.\n\n${message}`
				};
				this.appendTurnMessage(session, errorMessage);
				this.persistActiveSession();
				this.renderChatMessage(errorMessage);
				this.statusText = "Hermes call failed";
				new Notice("Hermes request failed. Check the sidebar for details.");
			}
			this.refreshActivityStatus();
		} finally {
			this.activeTurnUserMessageId = undefined;
			this.activeActivityMessageId = undefined;
			for (const image of turn.images) {
				cleanupAttachmentFile(image.path);
			}
			this.activeRunCancel = undefined;
			this.isSending = false;
			this.settleInlineActivityTimeline();
			this.refreshActivityStatus();
			this.scheduleMessagesToBottom();
		}
	}

	private stopActiveRun(): void {
		if (!this.isSending || !this.activeRunCancel) {
			return;
		}
		this.statusText = "正在停止当前任务";
		this.activeRunCancel();
		this.refreshActivityStatus();
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
		return composeObsidianPrompt({ userText, contexts, liveContext });
	}

	private buildStatusText(): string {
		const parts: string[] = [];
		const visibleActivity = this.getLatestVisibleActivityText();
		const primaryStatus = visibleActivity || this.statusText;
		if (!shouldHideStatusText(primaryStatus)) {
			parts.push(primaryStatus);
		}
		if (this.queuedTurns.length > 0) {
			parts.push(`队列 ${this.queuedTurns.length}`);
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
		if (this.pendingScrollRestoreFrame !== null) {
			window.cancelAnimationFrame(this.pendingScrollRestoreFrame);
			this.pendingScrollRestoreFrame = null;
		}
		this.suppressNextMessagesScroll = true;
		this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
	}

	private restoreMessagesScrollTop(targetScrollTop: number): void {
		if (!this.messagesEl) {
			return;
		}

		if (this.pendingScrollRestoreFrame !== null) {
			window.cancelAnimationFrame(this.pendingScrollRestoreFrame);
			this.pendingScrollRestoreFrame = null;
		}

		this.suppressNextMessagesScroll = true;
		this.messagesEl.scrollTop = targetScrollTop;

		if (
			!shouldDeferScrollRestore({
				targetScrollTop,
				scrollTop: this.messagesEl.scrollTop,
				clientHeight: this.messagesEl.clientHeight,
				scrollHeight: this.messagesEl.scrollHeight
			})
		) {
			return;
		}

		this.pendingScrollRestoreFrame = window.requestAnimationFrame(() => {
			this.pendingScrollRestoreFrame = null;
			if (!this.messagesEl || this.shouldAutoStickToBottom) {
				return;
			}
			this.suppressNextMessagesScroll = true;
			this.messagesEl.scrollTop = targetScrollTop;
		});
	}

	private scheduleMessagesToBottom(): void {
		if (!this.messagesEl || !this.shouldAutoStickToBottom) {
			return;
		}
		if (this.pendingBottomScrollFrame !== null) {
			window.cancelAnimationFrame(this.pendingBottomScrollFrame);
		}

		this.pendingBottomScrollFrame = window.requestAnimationFrame(() => {
			this.pendingBottomScrollFrame = null;
			this.scrollMessagesToBottom();
			window.requestAnimationFrame(() => this.scrollMessagesToBottom());
		});
	}

	private captureScrollIntent(): void {
		if (!this.messagesEl) {
			this.shouldAutoStickToBottom = true;
			return;
		}
		this.shouldAutoStickToBottom = getNextStickToBottom({
			scrollTop: this.messagesEl.scrollTop,
			clientHeight: this.messagesEl.clientHeight,
			scrollHeight: this.messagesEl.scrollHeight,
			isSending: this.isSending,
			currentlySticking: this.shouldAutoStickToBottom
		});
	}
}

class HermesImagePreviewModal extends Modal {
	private attachment: HermesMessageAttachment;

	constructor(app: App, attachment: HermesMessageAttachment) {
		super(app);
		this.attachment = attachment;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("hermes-sidebar-image-preview-modal");
		contentEl.createEl("img", {
			cls: "hermes-sidebar-image-preview-full",
			attr: {
				src: this.attachment.previewDataUrl,
				alt: this.attachment.name || "Attached image"
			}
		});
		if (this.attachment.name) {
			contentEl.createDiv({
				cls: "hermes-sidebar-image-preview-caption",
				text: this.attachment.name
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
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
				text.setValue(this.plugin.settings.pathPrefix).onChange(async (value) => {
					this.plugin.settings.pathPrefix = value.trim();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("System prompt")
			.setDesc("A short instruction injected before each turn.")
			.addTextArea((text) =>
				text.setValue(this.plugin.settings.systemPrompt).onChange(async (value) => {
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
					reject(new Error(canceled ? "__HERMES_ABORTED__" : event.message || "Hermes bridge error"));
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
			resolve(
				finalResult ?? {
					text: "",
					sessionId: input.sessionId,
					rawOutput: cleanOutputForDisplay(stderrBuffer)
				}
			);
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

function runInlineHermesBridge(plugin: HermesSidebarPlugin, input: InlineEditRunInput): HermesBridgeRun {
	return runHermesBridge({
		binary: plugin.settings.hermesBinary,
		bridgeScript: resolveBridgeScriptPath(plugin.app, plugin.manifest.dir ?? ""),
		hermesRoot: DEFAULT_HERMES_ROOT,
		prompt: input.prompt,
		conversationHistory: [],
		provider: input.provider,
		model: input.model,
		reasoningEffort: input.reasoningEffort,
		systemPrompt: input.systemPrompt,
		pathPrefix: plugin.settings.pathPrefix
	});
}

function buildHermesSystemPrompt(
	basePrompt: string,
	runtime?: { provider?: string; model?: string; reasoningEffort?: string }
): string {
	const trimmed = basePrompt.trim();
	const runtimeProvider = runtime?.provider?.trim() || "unknown";
	const runtimeModel = runtime?.model?.trim() || "unknown";
	const runtimeReasoning = runtime?.reasoningEffort?.trim() || "default";
	const progressInstruction = [
		`Current runtime: provider=${runtimeProvider}, model=${runtimeModel}, reasoning_effort=${runtimeReasoning}.`,
		"If the user asks what reasoning strength is active, answer from this Current runtime line instead of guessing from your hidden internals.",
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
	return messages.map((message) => ({
		...message,
		attachments: cloneMessageAttachments(message.attachments),
		activities: cloneActivityEntries(message.activities)
	}));
}

function cloneMessageAttachments(attachments?: HermesMessageAttachment[]): HermesMessageAttachment[] | undefined {
	if (!Array.isArray(attachments) || attachments.length === 0) {
		return undefined;
	}
	const cloned = attachments.filter(isHermesMessageAttachment).map((attachment) => ({ ...attachment }));
	return cloned.length > 0 ? cloned : undefined;
}

function cloneActivityEntries(activities?: HermesActivityEntry[]): HermesActivityEntry[] | undefined {
	if (!Array.isArray(activities) || activities.length === 0) {
		return undefined;
	}
	const cloned = activities.filter(isHermesActivityEntry).map((activity) => ({ ...activity }));
	return cloned.length > 0 ? cloned : undefined;
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
				messages: Array.isArray(session.messages) ? session.messages.filter(isHermesMessage) : []
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
	if ("id" in value && value.id !== undefined && typeof value.id !== "string") {
		return false;
	}
	if ("attachments" in value && value.attachments !== undefined && !Array.isArray(value.attachments)) {
		return false;
	}
	if ("activities" in value && value.activities !== undefined && !Array.isArray(value.activities)) {
		return false;
	}
	if ("interim" in value && value.interim !== undefined && typeof value.interim !== "boolean") {
		return false;
	}
	return (
		(value.role === "user" || value.role === "assistant" || value.role === "system") &&
		(value.kind === "user" || value.kind === "progress" || value.kind === "activity" || value.kind === "final") &&
		typeof value.content === "string"
	);
}

function isHermesActivityEntry(value: unknown): value is HermesActivityEntry {
	return (
		isPlainObject(value) &&
		typeof value.id === "string" &&
		typeof value.text === "string" &&
		(value.status === "running" || value.status === "done" || value.status === "error" || value.status === "info") &&
		typeof value.createdAt === "number"
	);
}

function isHermesMessageAttachment(value: unknown): value is HermesMessageAttachment {
	return (
		isPlainObject(value) &&
		value.type === "image" &&
		typeof value.name === "string" &&
		typeof value.previewDataUrl === "string"
	);
}

function getEditorSelectionsText(view: MarkdownView): string {
	const editor = view.editor;
	const ranges =
		editor
			.listSelections()
			.map((selection) => getEditorSelectionRangeText(view, selection.anchor, selection.head))
			.map((text) => text.trim())
			.filter(Boolean) ?? [];
	if (ranges.length > 1) {
		return ranges.join("\n\n---\n\n");
	}
	return ranges[0] ?? editor.getSelection();
}

function getEditorSelectionRangeText(view: MarkdownView, anchor: EditorPosition, head: EditorPosition): string {
	const [from, to] = compareEditorPositions(anchor, head) <= 0 ? [anchor, head] : [head, anchor];
	if (from.line === to.line && from.ch === to.ch) {
		return "";
	}
	return view.editor.getRange(from, to);
}

function compareEditorPositions(left: EditorPosition, right: EditorPosition): number {
	if (left.line !== right.line) {
		return left.line - right.line;
	}
	return left.ch - right.ch;
}

function summarizeSelectionLength(text: string): string {
	const compact = text.replace(/\s+/g, " ").trim();
	if (!compact) {
		return "0 chars";
	}
	return `${compact.length} chars`;
}

function joinActivityText(label: string, preview: string, maxLength = 72): string {
	const compactPreview = preview.replace(/\s+/g, " ").trim();
	if (!compactPreview) {
		return label;
	}
	return `${label}：${formatSelectionPreview(compactPreview, maxLength)}`;
}

function formatActivityTitleForTimeline(entry: HermesActivityEntry, index: number): string {
	if (entry.toolName === "run.config") {
		return "Run config";
	}
	if (entry.toolName === "thinking") {
		return "thinking";
	}
	if (entry.toolName) {
		return formatToolDisplayName(entry.toolName);
	}
	return `Step ${index + 1}`;
}

function formatActivityState(entry: HermesActivityEntry): string {
	if (entry.status === "running") {
		return "running";
	}
	if (entry.status === "done") {
		return typeof entry.duration === "number" ? `${entry.duration.toFixed(1)}s` : "done";
	}
	if (entry.status === "error") {
		return "error";
	}
	return "info";
}

function formatActivityMeta(entry: HermesActivityEntry): string {
	const parts = [
		entry.text,
		typeof entry.duration === "number" && entry.status !== "done" ? `${entry.duration.toFixed(1)}s` : ""
	].filter(Boolean);
	return parts.join(" · ");
}

function isDetailedStatusText(text: string): boolean {
	const value = text.trim();
	if (!value) {
		return false;
	}
	return !new Set([
		"Hermes 已收到这条消息",
		"正在思考中",
		"正在调用工具中",
		"Hermes 正在处理",
		"Hermes 正在继续处理",
		"Hermes 正在写回复"
	]).has(value);
}

function formatToolDisplayName(toolName: string): string {
	if (toolName === "skill_view") {
		return "skill_view";
	}
	if (toolName === "skills_list") {
		return "skills_list";
	}
	if (toolName === "skill_manage") {
		return "skill_manage";
	}
	return toolName;
}

function formatToolStatusText(toolName: string, status: "running" | "done" | "error"): string {
	if (toolName === "skill_view") {
		return status === "running" ? "正在读取 skill" : status === "done" ? "已读取 skill" : "skill 读取失败";
	}
	if (toolName === "skills_list") {
		return status === "running" ? "正在列出 skills" : status === "done" ? "已列出 skills" : "skills 列表读取失败";
	}
	if (toolName === "skill_manage") {
		return status === "running" ? "正在管理 skill" : status === "done" ? "已管理 skill" : "skill 管理失败";
	}
	if (status === "running") {
		return `正在调用 ${toolName}`;
	}
	if (status === "done") {
		return `已完成 ${toolName}`;
	}
	return `${toolName} 调用失败`;
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
	const raw = extname(file.name || "")
		.trim()
		.toLowerCase();
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
