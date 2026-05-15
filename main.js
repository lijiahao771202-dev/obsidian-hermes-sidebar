var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => main_default
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");

// src/session-helpers.ts
var DEFAULT_SESSION_TITLE = "\u65B0\u5BF9\u8BDD";
function formatSelectionPreview(text, maxLength = 48) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
function buildSessionTitle(text, maxLength = 24) {
  const preview = formatSelectionPreview(text, maxLength);
  return preview || DEFAULT_SESSION_TITLE;
}
function pickNextActiveSessionId(sessions, preferredId) {
  if (preferredId && sessions.some((session) => session.id === preferredId)) {
    return preferredId;
  }
  const sorted = [...sessions].sort(
    (left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt
  );
  return sorted.length > 0 ? sorted[0].id : void 0;
}
function pickSelectionText(input) {
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
function shouldStickToBottom(input) {
  const threshold = input.threshold ?? 24;
  return input.scrollTop + input.clientHeight >= input.scrollHeight - threshold;
}
function getNextStickToBottom(input) {
  if (input.isSending && input.currentlySticking) {
    return true;
  }
  return shouldStickToBottom(input);
}
function getRestoredScrollTop(previousScrollTop, shouldAutoStickToBottom) {
  if (shouldAutoStickToBottom || previousScrollTop === null) {
    return void 0;
  }
  return previousScrollTop;
}
function shouldDeferScrollRestore(input) {
  if (input.targetScrollTop <= 0) {
    return false;
  }
  return input.scrollHeight - input.clientHeight < input.targetScrollTop;
}
function canUpdateBridgeEventWithoutFullRender(type) {
  return type === "status" || type === "activity" || type === "progress" || type === "delta";
}
function shouldShowActivityEntry(toolName) {
  return (toolName || "").trim() !== "run.config";
}
function shouldMergeActivityEntry(toolName, currentStatus, incomingStatus, currentPreview, incomingPreview) {
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
function adjustIndexAfterInsertion(index, insertIndex) {
  if (index === null) {
    return null;
  }
  return index >= insertIndex ? index + 1 : index;
}
function getAppendIndexAfterTurnMessages(messages, turnStartMessageId) {
  const anchorIndex = turnStartMessageId ? messages.findIndex((message) => message.id === turnStartMessageId) : -1;
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
function shouldRestoreComposerFocus(hadComposerFocus, shouldAutoStickToBottom) {
  return hadComposerFocus && shouldAutoStickToBottom;
}
function shouldRefreshSelectionSnapshot(input) {
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
function shouldHideStatusText(statusText) {
  return (/* @__PURE__ */ new Set([
    "",
    "Ready",
    "Connected",
    "Reply received",
    "Started a fresh session",
    "\u5DF2\u8FDE\u63A5",
    "\u5DF2\u6536\u5230\u56DE\u590D",
    "\u5DF2\u5F00\u59CB\u65B0\u5BF9\u8BDD"
  ])).has(statusText);
}

// src/bridge-helpers.ts
function normalizeText(text) {
  return typeof text === "string" ? text.trim() : "";
}
function buildTurnUserText(text, imageCount) {
  const normalized = normalizeText(text);
  if (normalized) {
    return normalized;
  }
  if (imageCount > 1) {
    return "\u8BF7\u5E2E\u6211\u770B\u770B\u8FD9\u51E0\u5F20\u56FE\u7247\u3002";
  }
  if (imageCount === 1) {
    return "\u8BF7\u5E2E\u6211\u770B\u770B\u8FD9\u5F20\u56FE\u7247\u3002";
  }
  return "";
}
function composeObsidianPrompt(input) {
  const liveBlocks = [];
  const { liveContext } = input;
  if (liveContext.noteTitle || liveContext.notePath) {
    liveBlocks.push(
      [
        "## Current open note",
        liveContext.noteTitle ? `Title: ${liveContext.noteTitle}` : "",
        liveContext.notePath ? `Path: ${liveContext.notePath}` : ""
      ].filter(Boolean).join("\n")
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
  const contextBlocks = input.contexts.map((context) => `## ${context.label}
${context.content}`).join("\n\n");
  return [
    "The following Obsidian context is attached for this turn.",
    ...liveBlocks,
    contextBlocks,
    "## User request",
    input.userText
  ].filter(Boolean).join("\n\n");
}

// src/main.ts
var VIEW_TYPE_HERMES_SIDEBAR = "hermes-sidebar-view";
var DEFAULT_HERMES_BINARY = "hermes";
var DEFAULT_PROVIDER = "xiaomi";
var DEFAULT_MODEL = "mimo-v2.5";
var DEFAULT_FALLBACK_PROVIDER = "deepseek";
var DEFAULT_FALLBACK_MODEL = "deepseek-v4-flash";
var DEFAULT_HERMES_PATH_PREFIX = "/Users/lijiahao/.hermes/hermes-agent/venv/bin:/Users/lijiahao/.local/bin:";
var DEFAULT_HERMES_ROOT = "/Users/lijiahao/.hermes/hermes-agent";
var DEFAULT_HERMES_BRIDGE = "hermes_bridge.py";
var DEFAULT_REASONING_EFFORT = "high";
var HERMES_MODEL_OPTIONS = [
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
];
var HERMES_REASONING_OPTIONS = [
  { label: "\u5173\u95ED", value: "none" },
  { label: "\u4F4E", value: "low" },
  { label: "\u4E2D", value: "medium" },
  { label: "\u9AD8", value: "high" },
  { label: "\u8D85\u5F3A", value: "xhigh" }
];
var DEFAULT_SETTINGS = {
  hermesBinary: DEFAULT_HERMES_BINARY,
  provider: DEFAULT_PROVIDER,
  model: DEFAULT_MODEL,
  reasoningEffort: DEFAULT_REASONING_EFFORT,
  fallbackProvider: DEFAULT_FALLBACK_PROVIDER,
  fallbackModel: DEFAULT_FALLBACK_MODEL,
  systemPrompt: "You are Hermes inside Obsidian. Be concise, context-aware, and helpful with note-writing tasks.",
  pathPrefix: DEFAULT_HERMES_PATH_PREFIX
};
var HermesSidebarPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.selectionSnapshot = "";
    this.refreshTimer = null;
    this.isPointerSelecting = false;
    this.lastActiveNotePath = "";
    this.lastActiveNoteTitle = "";
    this.chatSessions = [];
    this.activeSessionId = "";
  }
  async onload() {
    await this.loadSettings();
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
          new import_obsidian.Notice("No selected text found in the active note.");
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
        const markdownView = leaf?.view instanceof import_obsidian.MarkdownView ? leaf.view : null;
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
      if (shouldRefreshSelectionSnapshot({
        nextSelection: selection,
        currentSnapshot: this.selectionSnapshot,
        isPointerDown: this.isPointerSelecting,
        keepExistingWhenEmpty: this.isEventInsideHermesSidebar()
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
      if (shouldRefreshSelectionSnapshot({
        nextSelection: selection,
        currentSnapshot: this.selectionSnapshot,
        isPointerDown: false,
        keepExistingWhenEmpty: this.isEventInsideHermesSidebar()
      })) {
        this.selectionSnapshot = selection;
        this.scheduleRefreshSidebarViews();
      }
    });
  }
  async onunload() {
    await this.app.workspace.detachLeavesOfType(VIEW_TYPE_HERMES_SIDEBAR);
  }
  async loadSettings() {
    const rawData = await this.loadData();
    const persistedData = isPersistedDataShape(rawData) ? rawData : void 0;
    const legacySettings = isPlainObject(rawData) ? rawData : void 0;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, persistedData?.settings ?? legacySettings ?? {});
    this.chatSessions = restoreSessions(persistedData?.sessions);
    this.activeSessionId = pickNextActiveSessionId(this.chatSessions, persistedData?.activeSessionId) ?? this.chatSessions[0]?.id ?? "";
  }
  async saveSettings() {
    await this.savePluginState();
  }
  getActiveMarkdownView() {
    return this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView) ?? null;
  }
  getCurrentContextFile() {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      return activeFile;
    }
    const mostRecentLeaf = this.app.workspace.getMostRecentLeaf();
    if (mostRecentLeaf?.view instanceof import_obsidian.MarkdownView) {
      return mostRecentLeaf.view.file ?? null;
    }
    const markdownLeaf = this.app.workspace.getLeavesOfType("markdown")[0];
    if (markdownLeaf?.view instanceof import_obsidian.MarkdownView) {
      return markdownLeaf.view.file ?? null;
    }
    return null;
  }
  getCurrentSelectionText() {
    const view = this.getActiveMarkdownView();
    const editorSelection = view ? getEditorSelectionsText(view) : "";
    const browserSelection = window.getSelection();
    const browserText = browserSelection?.toString().trim();
    const mode = view?.getMode?.() ?? "";
    if (browserSelection && browserText && browserSelection.rangeCount > 0 && view) {
      const range = browserSelection.getRangeAt(0);
      const ancestor = range.commonAncestorContainer;
      const rootElement = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentElement : ancestor;
      if (rootElement && this.app.workspace.getLeavesOfType(VIEW_TYPE_HERMES_SIDEBAR).some((leaf) => {
        const sidebarView = leaf.view;
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
  isEventInsideHermesSidebar() {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) {
      return false;
    }
    return this.app.workspace.getLeavesOfType(VIEW_TYPE_HERMES_SIDEBAR).some((leaf) => {
      const sidebarView = leaf.view;
      return sidebarView.containerEl.contains(activeElement);
    });
  }
  getLiveContextInfo() {
    const file = this.getCurrentContextFile();
    return {
      noteTitle: (file?.basename ?? this.lastActiveNoteTitle) || void 0,
      notePath: (file?.path ?? this.lastActiveNotePath) || void 0,
      selectionText: this.selectionSnapshot.trim() || void 0
    };
  }
  clearSelectionSnapshot(collapseSelection = false) {
    if (collapseSelection) {
      this.collapseCurrentSelection();
    }
    this.selectionSnapshot = "";
    this.scheduleRefreshSidebarViews();
  }
  getSessions() {
    return [...this.chatSessions].sort(
      (left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt
    );
  }
  getActiveSession() {
    let session = this.chatSessions.find((entry) => entry.id === this.activeSessionId);
    if (!session) {
      session = createChatSession();
      this.chatSessions = [session, ...this.chatSessions];
      this.activeSessionId = session.id;
      void this.savePluginState();
    }
    return session;
  }
  createSession() {
    const session = createChatSession();
    this.chatSessions = [session, ...this.chatSessions];
    this.activeSessionId = session.id;
    void this.savePluginState();
    return session;
  }
  setActiveSession(sessionId) {
    if (!this.chatSessions.some((session) => session.id === sessionId)) {
      return false;
    }
    this.activeSessionId = sessionId;
    void this.savePluginState();
    return true;
  }
  deleteSession(sessionId) {
    const remaining = this.chatSessions.filter((session) => session.id !== sessionId);
    this.chatSessions = remaining.length > 0 ? remaining : [createChatSession()];
    this.activeSessionId = pickNextActiveSessionId(
      this.chatSessions,
      this.activeSessionId === sessionId ? void 0 : this.activeSessionId
    ) ?? this.chatSessions[0].id;
    void this.savePluginState();
  }
  saveSessionSnapshot(sessionId, input, touch = true) {
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
  async savePluginState() {
    const payload = {
      settings: this.settings,
      sessions: this.chatSessions.map((session) => ({
        ...session,
        messages: cloneMessages(session.messages)
      })),
      activeSessionId: this.activeSessionId
    };
    await this.saveData(payload);
  }
  captureActiveViewScrollSnapshot() {
    const markdownView = this.getActiveMarkdownView();
    if (!markdownView) {
      return null;
    }
    const editorScroll = markdownView.editor?.getScrollInfo?.();
    const elementScrolls = Array.from(
      markdownView.containerEl.querySelectorAll(".cm-scroller, .markdown-preview-view, .view-content")
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
  restoreActiveViewScrollSnapshot(snapshot) {
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
  collapseCurrentSelection() {
    const scrollSnapshot = this.captureActiveViewScrollSnapshot();
    const markdownView = this.getActiveMarkdownView();
    if (markdownView?.editor) {
      try {
        const cursor = markdownView.editor.getCursor("to");
        markdownView.editor.setSelection(cursor, cursor);
      } catch {
      }
    }
    window.getSelection()?.removeAllRanges();
    this.restoreActiveViewScrollSnapshot(scrollSnapshot);
  }
  scheduleRefreshSidebarViews() {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshSidebarViews();
    }, 60);
  }
  refreshSidebarViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HERMES_SIDEBAR)) {
      const view = leaf.view;
      if (view.isComposerFocused()) {
        continue;
      }
      view.requestRefresh();
    }
  }
  async activateView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_HERMES_SIDEBAR)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf("split", "vertical");
      await leaf.setViewState({
        type: VIEW_TYPE_HERMES_SIDEBAR,
        active: true
      });
    }
    this.app.workspace.revealLeaf(leaf);
    return leaf.view;
  }
};
var HermesSidebarView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.pendingContexts = [];
    this.pendingImages = [];
    this.queuedTurns = [];
    this.statusText = "";
    this.draftText = "";
    this.isSending = false;
    this.isDrainingQueue = false;
    this.activeStreamingMessageIndex = null;
    this.streamingRenderToken = 0;
    this.pendingStreamingRenderFrame = null;
    this.dismissedLiveNoteKey = "";
    this.messageCounter = 0;
    this.queueCounter = 0;
    this.isHistoryOpen = false;
    this.shouldAutoStickToBottom = true;
    this.pendingBottomScrollFrame = null;
    this.pendingScrollRestoreFrame = null;
    this.suppressNextMessagesScroll = false;
    this.activityEntries = [];
    this.activityCounter = 0;
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE_HERMES_SIDEBAR;
  }
  getDisplayText() {
    return "Hermes";
  }
  getIcon() {
    return "messages-square";
  }
  async onOpen() {
    this.containerEl.empty();
    this.containerEl.addClass("hermes-sidebar-view");
    this.render();
  }
  async onClose() {
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
  requestRefresh() {
    if (!this.liveContextEl) {
      this.render(false);
      return;
    }
    this.renderLiveContext();
  }
  isComposerFocused() {
    return !!this.inputEl && document.activeElement === this.inputEl;
  }
  attachContext(context) {
    this.pendingContexts.push(context);
    this.statusText = `\u5DF2\u9644\u52A0 ${context.label.toLowerCase()} \u4E0A\u4E0B\u6587`;
    this.render();
    new import_obsidian.Notice(`${context.label} attached to Hermes.`);
  }
  focusComposerWithoutScroll() {
    if (!this.inputEl) {
      return;
    }
    try {
      this.inputEl.focus({ preventScroll: true });
    } catch {
      this.inputEl.focus();
    }
  }
  render(allowInputReset = true) {
    if (!allowInputReset && this.inputEl) {
      this.draftText = this.inputEl.value;
    }
    this.streamingMessageRef = void 0;
    this.streamingRowEl = void 0;
    this.streamingBubbleEl = void 0;
    this.streamingBodyEl = void 0;
    this.activityMessageRef = void 0;
    this.activityRowEl = void 0;
    this.activityBubbleEl = void 0;
    this.activityTimelineEl = void 0;
    this.liveContextEl = void 0;
    this.activityEl = void 0;
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
      text: `${this.getModelLabel(this.plugin.settings.model)} \xB7 ${this.getReasoningLabel(this.plugin.settings.reasoningEffort)}`
    });
    const headerActions = header.createDiv({
      cls: "hermes-sidebar-header-actions"
    });
    const historyButton = headerActions.createEl("button", {
      cls: "hermes-sidebar-button",
      text: "\u5386\u53F2"
    });
    historyButton.toggleClass("is-active", this.isHistoryOpen);
    historyButton.addEventListener("click", () => {
      this.isHistoryOpen = !this.isHistoryOpen;
      this.render(false);
    });
    const resetButton = headerActions.createEl("button", {
      cls: "hermes-sidebar-button",
      text: "\u65B0\u5BF9\u8BDD"
    });
    resetButton.addEventListener("click", () => {
      if (this.isSending) {
        new import_obsidian.Notice("Stop the current reply before starting a new chat.");
        return;
      }
      this.stopActiveRun();
      this.pendingContexts = [];
      this.queuedTurns = [];
      this.activeStreamingMessageIndex = null;
      this.dismissedLiveNoteKey = "";
      this.plugin.clearSelectionSnapshot(true);
      this.plugin.createSession();
      this.statusText = "\u5DF2\u5F00\u59CB\u65B0\u5BF9\u8BDD";
      this.render();
    });
    root.toggleClass("hermes-sidebar-history-open", this.isHistoryOpen);
    const historyPanel = root.createDiv({ cls: "hermes-sidebar-history" });
    historyPanel.createDiv({
      cls: "hermes-sidebar-history-title",
      text: "\u6700\u8FD1\u5BF9\u8BDD"
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
          new import_obsidian.Notice("Wait for the current reply to finish before switching chats.");
          return;
        }
        this.pendingContexts = [];
        this.queuedTurns = [];
        this.activeStreamingMessageIndex = null;
        this.dismissedLiveNoteKey = "";
        this.plugin.setActiveSession(session.id);
        this.statusText = "\u5DF2\u5207\u6362\u5BF9\u8BDD";
        this.render();
      });
      const deleteButton = item.createEl("button", {
        cls: "hermes-sidebar-history-delete",
        text: "\u5220\u9664"
      });
      deleteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.isSending && session.id === activeSession.id) {
          new import_obsidian.Notice("Stop the current run before deleting this chat.");
          return;
        }
        this.plugin.deleteSession(session.id);
        this.statusText = "\u5DF2\u5220\u9664\u5BF9\u8BDD";
        this.render();
      });
    }
    this.liveContextEl = root.createDiv({ cls: "hermes-sidebar-live-context" });
    this.renderLiveContext();
    if (this.queuedTurns.length > 0) {
      const queueEl = root.createDiv({ cls: "hermes-sidebar-queue" });
      queueEl.createDiv({
        cls: "hermes-sidebar-queue-title",
        text: `\u961F\u5217 \xB7 ${this.queuedTurns.length}`
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
          this.statusText = this.queuedTurns.length > 0 ? `\u961F\u5217\u91CC\u8FD8\u6709 ${this.queuedTurns.length} \u6761` : "\u5DF2\u6E05\u7A7A\u53D1\u9001\u961F\u5217";
          this.render(false);
        });
      }
    }
    this.messagesEl = root.createDiv({ cls: "hermes-sidebar-messages" });
    if (activeSession.messages.length === 0) {
      this.messagesEl.createDiv({
        cls: "hermes-sidebar-empty-state",
        text: "\u9009\u62E9\u4E00\u6BB5\u6587\u5B57\uFF0C\u6216\u76F4\u63A5\u5411 Hermes \u63D0\u95EE\u3002"
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
    if (restoredScrollTop !== void 0) {
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
    const previousSelectionStart = preserveFocus ? this.inputEl?.selectionStart ?? null : null;
    const previousSelectionEnd = preserveFocus ? this.inputEl?.selectionEnd ?? null : null;
    const shell = composer.createDiv({ cls: "hermes-sidebar-composer-shell" });
    this.inputEl = shell.createEl("textarea", {
      cls: "hermes-sidebar-input"
    });
    this.inputEl.value = this.draftText;
    this.inputEl.placeholder = "\u95EE\u95EE Hermes\uFF1A\u53EF\u4EE5\u56F4\u7ED5\u5F53\u524D\u7B14\u8BB0\u3001\u9009\u533A\u6216\u56FE\u7247...";
    this.inputEl.addEventListener("input", () => {
      this.draftText = this.inputEl?.value ?? "";
    });
    this.inputEl.addEventListener("paste", (event) => {
      void this.handlePasteImages(event);
    });
    this.contextEl = shell.createDiv({ cls: "hermes-sidebar-context" });
    this.renderContextChips();
    const toolbar = shell.createDiv({ cls: "hermes-sidebar-composer-toolbar" });
    const controls = toolbar.createDiv({ cls: "hermes-sidebar-controls" });
    const attachButton = controls.createEl("button", {
      cls: "hermes-sidebar-attach-button",
      text: "\u56FE\u7247"
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
      text: "\u6A21\u578B"
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
      this.statusText = `\u5DF2\u5207\u6362\u5230 ${selected.label}`;
      this.render(false);
    });
    const reasoningControl = controls.createDiv({
      cls: "hermes-sidebar-control-group"
    });
    reasoningControl.createDiv({
      cls: "hermes-sidebar-control-label",
      text: "\u601D\u8003"
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
      this.statusText = `\u601D\u8003\u5F3A\u5EA6\u5DF2\u5207\u5230 ${this.getReasoningLabel(value)}`;
      this.render(false);
    });
    this.sendButtonEl = toolbar.createEl("button", {
      cls: "hermes-sidebar-send",
      text: this.isSending ? "\u6392\u961F" : "\u53D1\u9001"
    });
    this.sendButtonEl.addEventListener("click", () => void this.handleSend());
    this.inputEl.addEventListener("keydown", (event) => {
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
  renderLiveContext() {
    if (!this.liveContextEl) {
      return;
    }
    this.liveContextEl.empty();
    const liveContext = this.plugin.getLiveContextInfo();
    const liveNoteKey = this.getLiveNoteKey(liveContext);
    const isNoteDismissed = !!liveNoteKey && this.dismissedLiveNoteKey === liveNoteKey;
    const hasLiveContext = !!(liveContext.noteTitle && !isNoteDismissed || liveContext.selectionText);
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
          "aria-label": "\u672C\u8F6E\u4E0D\u9644\u52A0\u5F53\u524D\u6587\u7AE0"
        }
      });
      dismissNoteButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.dismissedLiveNoteKey = liveNoteKey;
        this.statusText = "\u672C\u8F6E\u5DF2\u53D6\u6D88\u9644\u52A0\u5F53\u524D\u6587\u7AE0";
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
      text: "\u6E05\u9664"
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
  refreshActivityStatus() {
    if (!this.activityEl) {
      return;
    }
    this.renderActivityStatus();
  }
  renderChatMessage(message, options = {}) {
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
      ].filter(Boolean).join(" ")
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
      avatar.setText("\u5609");
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
      ].filter(Boolean).join(" ")
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
  hasVisibleActivities(message) {
    return (message.activities ?? []).some(
      (entry) => isHermesActivityEntry(entry) && shouldShowActivityEntry(entry.toolName)
    );
  }
  renderMessageActivityTimeline(container, message) {
    const activities = (message.activities ?? []).filter(
      (entry) => isHermesActivityEntry(entry) && shouldShowActivityEntry(entry.toolName)
    );
    if (activities.length === 0 || message.role !== "assistant") {
      return void 0;
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
            text: "\u67E5\u770B\u601D\u8003\u5185\u5BB9"
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
  ensureStreamingMessageElements(target) {
    if (this.streamingMessageRef === target && this.streamingRowEl?.isConnected && this.streamingBubbleEl?.isConnected && this.streamingBodyEl?.isConnected) {
      return this.streamingBodyEl;
    }
    const existingRow = this.findRenderedMessageRow(target);
    if (existingRow) {
      const bubble = existingRow.querySelector(".hermes-sidebar-bubble");
      const body = bubble?.querySelector(".hermes-sidebar-message-body");
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
  queueStreamingMessageRender(target) {
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
  cancelPendingStreamingRender() {
    if (this.pendingStreamingRenderFrame === null) {
      return;
    }
    window.cancelAnimationFrame(this.pendingStreamingRenderFrame);
    this.pendingStreamingRenderFrame = null;
  }
  renderMessageAttachments(container, message) {
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
          "aria-label": `\u67E5\u770B\u56FE\u7247 ${image.name || ""}`.trim()
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
  renderActivityStatus() {
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
      text: statusText || "\u6D3B\u52A8\u8BB0\u5F55"
    });
    const toggle = header.createEl("button", {
      cls: "hermes-sidebar-activity-toggle",
      text: "\u8FC7\u7A0B",
      attr: { type: "button" }
    });
    toggle.disabled = this.activityEntries.length === 0;
    toggle.addEventListener("click", () => {
      this.revealInlineActivityTimeline();
    });
  }
  revealInlineActivityTimeline() {
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
  settleInlineActivityTimeline() {
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
  async renderMarkdownInto(container, content) {
    container.empty();
    await import_obsidian.MarkdownRenderer.render(this.app, content, container, "", this);
    this.scheduleMessagesToBottom();
  }
  async renderStreamingMarkdownInto(container, content) {
    const token = ++this.streamingRenderToken;
    const scratch = document.createElement("div");
    await import_obsidian.MarkdownRenderer.render(this.app, content, scratch, "", this);
    if (token !== this.streamingRenderToken) {
      return;
    }
    container.replaceChildren(...Array.from(scratch.childNodes));
    this.scheduleMessagesToBottom();
  }
  getHermesAvatarSrc() {
    if (this.hermesAvatarDataUrl) {
      return this.hermesAvatarDataUrl;
    }
    try {
      const avatarPath = resolvePluginAssetPath(this.app, this.plugin.manifest.dir ?? "", "hermes-avatar.png");
      const bytes = (0, import_node_fs.readFileSync)(avatarPath);
      this.hermesAvatarDataUrl = `data:image/png;base64,${bytes.toString("base64")}`;
      return this.hermesAvatarDataUrl;
    } catch {
      return "";
    }
  }
  renderContextChips() {
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
  removePendingImage(imageId) {
    const index = this.pendingImages.findIndex((image) => image.id === imageId);
    if (index === -1) {
      return;
    }
    const [removed] = this.pendingImages.splice(index, 1);
    cleanupAttachmentFile(removed.path);
    this.renderContextChips();
  }
  applyModelSelection(value) {
    const selected = HERMES_MODEL_OPTIONS.find((item) => item.value === value);
    if (!selected) {
      return;
    }
    this.plugin.settings.model = selected.value;
    this.plugin.settings.provider = selected.provider;
  }
  applyReasoningSelection(value) {
    const selected = HERMES_REASONING_OPTIONS.find((item) => item.value === value);
    this.plugin.settings.reasoningEffort = selected?.value ?? DEFAULT_REASONING_EFFORT;
  }
  syncComposerSettingsFromControls() {
    if (this.modelSelectEl) {
      this.applyModelSelection(this.modelSelectEl.value);
    }
    if (this.reasoningSelectEl) {
      this.applyReasoningSelection(this.reasoningSelectEl.value);
    }
  }
  getLiveNoteKey(liveContext = this.plugin.getLiveContextInfo()) {
    return (liveContext.notePath || liveContext.noteTitle || "").trim();
  }
  getActiveTurnLiveContext() {
    const liveContext = { ...this.plugin.getLiveContextInfo() };
    const liveNoteKey = this.getLiveNoteKey(liveContext);
    if (liveNoteKey && this.dismissedLiveNoteKey === liveNoteKey) {
      delete liveContext.noteTitle;
      delete liveContext.notePath;
    }
    return liveContext;
  }
  nextMessageId(prefix) {
    return `${prefix}-${Date.now()}-${++this.messageCounter}`;
  }
  getConversationHistory() {
    return this.plugin.getActiveSession().messages.filter((message) => !message.interim && message.kind !== "progress" && message.kind !== "activity").map((message) => ({
      role: message.role,
      content: message.content
    }));
  }
  appendInterimAssistantMessage(content) {
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
  appendTurnMessage(session, message) {
    const insertIndex = getAppendIndexAfterTurnMessages(session.messages, this.activeTurnUserMessageId);
    session.messages.splice(insertIndex, 0, message);
    this.activeStreamingMessageIndex = adjustIndexAfterInsertion(this.activeStreamingMessageIndex, insertIndex);
    return insertIndex;
  }
  ensureActivityMessage(entry) {
    const session = this.plugin.getActiveSession();
    const target = {
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
    this.activityRowEl = void 0;
    this.activityBubbleEl = void 0;
    this.activityTimelineEl = void 0;
    this.persistActiveSession(false);
    this.ensureActivityMessageElements(target);
    return target;
  }
  ensureActivityMessageElements(target) {
    if (this.activityMessageRef === target && this.activityRowEl?.isConnected && this.activityBubbleEl?.isConnected && this.activityTimelineEl?.isConnected) {
      return this.activityTimelineEl;
    }
    if (this.activityMessageRef === target && this.activityBubbleEl?.isConnected) {
      const existing = this.activityBubbleEl.querySelector(".hermes-sidebar-run-trace");
      if (existing) {
        this.activityTimelineEl = existing;
        return existing;
      }
      const rendered2 = this.renderMessageActivityTimeline(this.activityBubbleEl, target);
      if (rendered2) {
        this.activityTimelineEl = rendered2;
        return rendered2;
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
  findRenderedMessageRow(message) {
    if (!this.messagesEl || !message.id) {
      return null;
    }
    return Array.from(this.messagesEl.querySelectorAll(".hermes-sidebar-chat-row")).find(
      (row) => row.dataset.hermesMessageId === message.id
    ) ?? null;
  }
  bindActivityMessageElements(target, row) {
    const bubble = target.kind === "activity" ? row : row.querySelector(".hermes-sidebar-bubble") ?? void 0;
    if (!bubble) {
      return null;
    }
    let activity = bubble.querySelector(".hermes-sidebar-run-trace");
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
  pushActivityEntry(event) {
    const text = this.formatActivityText(event);
    if (!text) {
      return;
    }
    const toolName = event.toolName?.trim() || void 0;
    if (!shouldShowActivityEntry(toolName)) {
      return;
    }
    const preview = event.preview?.trim() || void 0;
    const status = event.status ?? (event.isError ? "error" : "info");
    if (toolName && toolName !== "thinking" && status === "running") {
      this.settleCurrentActivityIf((entry2) => entry2.toolName === "thinking" && entry2.status === "running");
    }
    const existingIndex = toolName ? this.activityEntries.findIndex(
      (entry2) => entry2.toolName === toolName && shouldMergeActivityEntry(toolName, entry2.status, status, entry2.preview, preview)
    ) : -1;
    const entry = {
      id: `activity-${Date.now()}-${++this.activityCounter}`,
      text,
      toolName,
      preview,
      status,
      duration: typeof event.duration === "number" ? event.duration : void 0,
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
  getLatestVisibleActivityText() {
    const entry = [...this.activityEntries].reverse().find((item) => item.toolName !== "run.config" && item.text.trim());
    return entry?.text.trim() ?? "";
  }
  getActivityMessageByEntryId(entryId) {
    return this.plugin.getActiveSession().messages.find(
      (message) => message.kind === "activity" && message.role === "assistant" && (message.activities ?? []).some((entry) => entry.id === entryId)
    );
  }
  getActiveActivityMessage() {
    if (this.activityMessageRef?.id === this.activeActivityMessageId) {
      return this.activityMessageRef;
    }
    return this.activeActivityMessageId ? this.plugin.getActiveSession().messages.find(
      (message) => message.id === this.activeActivityMessageId && message.role === "assistant" && message.kind === "activity"
    ) : void 0;
  }
  updateActivityMessageByEntryId(entryId, entry) {
    const message = this.getActivityMessageByEntryId(entryId);
    if (!message) {
      return;
    }
    message.activities = (message.activities ?? []).map((activity) => activity.id === entryId ? entry : activity);
    message.pending = this.isSending && entry.status === "running";
    this.refreshActivityMessage(message);
  }
  settleActivityMessage(message) {
    const activities = message.activities ?? [];
    for (const entry of activities) {
      if (entry.status === "running") {
        entry.status = "done";
      }
    }
    message.pending = false;
  }
  settleCurrentActivityIf(predicate) {
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
  refreshActivityMessage(target) {
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
  pushLocalActivity(input) {
    const text = input.text.trim();
    if (!text) {
      return;
    }
    const existingRunningIndex = input.toolName ? this.activityEntries.findIndex(
      (entry2) => entry2.toolName === input.toolName && shouldMergeActivityEntry(input.toolName, entry2.status, input.status ?? "info", entry2.preview, input.preview)
    ) : -1;
    const entry = {
      id: `activity-${Date.now()}-${++this.activityCounter}`,
      text,
      toolName: input.toolName,
      preview: input.preview?.trim() || void 0,
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
  setFallbackStatus(text) {
    if (!this.statusText || !this.activityEntries.length) {
      this.statusText = text;
    }
  }
  formatActivityText(event) {
    if (event.status === "info") {
      return event.text?.trim() || event.message?.trim() || "";
    }
    const toolName = event.toolName?.trim() || "";
    const preview = event.preview?.trim() || "";
    if (event.status === "running") {
      return toolName ? joinActivityText(formatToolStatusText(toolName, "running"), preview) : joinActivityText("\u6B63\u5728\u8C03\u7528\u5DE5\u5177", preview);
    }
    if (event.status === "done") {
      return toolName ? joinActivityText(formatToolStatusText(toolName, "done"), preview) : joinActivityText("\u5DE5\u5177\u5904\u7406\u5B8C\u4E86", preview);
    }
    if (event.status === "error" || event.isError) {
      return toolName ? joinActivityText(formatToolStatusText(toolName, "error"), preview) : joinActivityText("\u5DE5\u5177\u8C03\u7528\u5931\u8D25", preview);
    }
    return event.text?.trim() || event.message?.trim() || "";
  }
  ensureStreamingFinalMessage() {
    const session = this.plugin.getActiveSession();
    if (this.activeStreamingMessageIndex !== null) {
      const existing = session.messages[this.activeStreamingMessageIndex];
      if (existing && existing.kind === "final") {
        this.ensureStreamingMessageElements(existing);
        return existing;
      }
    }
    const message = {
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
  convertActiveStreamToProgress() {
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
    this.streamingMessageRef = void 0;
    this.streamingRowEl = void 0;
    this.streamingBubbleEl = void 0;
    this.streamingBodyEl = void 0;
  }
  finalizeActiveStream(finalText) {
    const session = this.plugin.getActiveSession();
    if (this.activeStreamingMessageIndex === null) {
      const message = {
        id: this.nextMessageId("assistant"),
        role: "assistant",
        kind: "final",
        content: finalText?.trim() || "(Hermes returned an empty response.)",
        pending: false
      };
      this.activeStreamingMessageIndex = this.appendTurnMessage(session, message);
      const target2 = session.messages[this.activeStreamingMessageIndex];
      this.ensureStreamingMessageElements(target2);
      if (this.streamingBodyEl?.isConnected) {
        void this.renderStreamingMarkdownInto(this.streamingBodyEl, target2.content);
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
  async handlePasteImages(event) {
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    await this.addPendingImages(files);
  }
  async handleFileInput(fileList) {
    const files = Array.from(fileList ?? []).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      return;
    }
    await this.addPendingImages(files);
  }
  async addPendingImages(files) {
    const attachments = await Promise.all(files.map((file) => createPendingImageAttachment(file)));
    this.pendingImages.push(...attachments);
    this.statusText = attachments.length > 1 ? `\u5DF2\u9644\u52A0 ${attachments.length} \u5F20\u56FE\u7247` : "\u5DF2\u9644\u52A0\u56FE\u7247";
    this.render(false);
  }
  async handleSend() {
    if (!this.inputEl) {
      return;
    }
    const text = this.inputEl.value.trim();
    const userText = buildTurnUserText(text, this.pendingImages.length);
    if (!userText) {
      new import_obsidian.Notice("Type a message or attach an image first.");
      return;
    }
    this.syncComposerSettingsFromControls();
    await this.plugin.saveSettings();
    const turn = {
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
    this.statusText = this.isSending ? `\u5DF2\u52A0\u5165\u961F\u5217\uFF08\u8FD8\u6709 ${this.queuedTurns.length} \u6761\u5F85\u5904\u7406\uFF09` : "Hermes \u5DF2\u6536\u5230\u8FD9\u6761\u6D88\u606F";
    this.render(false);
    this.focusComposerWithoutScroll();
    void this.processQueue();
  }
  async processQueue() {
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
  async executeTurn(turn) {
    const session = this.plugin.getActiveSession();
    const prompt = this.composePrompt(turn.userText, turn.contexts, turn.liveContext);
    const conversationHistory = this.getConversationHistory();
    const imageAttachments = turn.images.map((image) => ({
      type: "image",
      name: image.name,
      previewDataUrl: image.previewDataUrl
    }));
    const userMessage = {
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
    this.activityMessageRef = void 0;
    this.activeActivityMessageId = void 0;
    this.isSending = true;
    this.activityEntries = [];
    this.statusText = "";
    this.setFallbackStatus("Hermes \u5DF2\u6536\u5230\u8FD9\u6761\u6D88\u606F");
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
                this.statusText = `\u6B63\u5728\u5904\u7406\uFF1A${formatSelectionPreview(event.text, 72)}`;
                this.refreshActivityStatus();
              }
              return;
            }
            const target = this.ensureStreamingFinalMessage();
            target.content += event.text || "";
            target.pending = true;
            this.statusText = `\u6B63\u5728\u5199\u56DE\u590D\uFF1A\u5DF2\u8F93\u51FA ${target.content.length} chars`;
            this.queueStreamingMessageRender(target);
            this.refreshActivityStatus();
            return;
          }
          if (event.type === "segment_break") {
            this.convertActiveStreamToProgress();
            this.setFallbackStatus("Hermes \u6B63\u5728\u7EE7\u7EED\u5904\u7406");
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
            this.statusText = session.sessionId ? "\u5DF2\u8FDE\u63A5" : "\u5DF2\u6536\u5230\u56DE\u590D";
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
      this.statusText = session.sessionId ? "\u5DF2\u8FDE\u63A5" : "\u5DF2\u6536\u5230\u56DE\u590D";
      this.refreshActivityStatus();
    } catch (error) {
      if (isHermesAbortError(error)) {
        this.convertActiveStreamToProgress();
        this.appendInterimAssistantMessage("\u597D\uFF0C\u6211\u5148\u505C\u5728\u8FD9\u91CC\u3002");
        this.settleInlineActivityTimeline();
        this.activeStreamingMessageIndex = null;
        this.statusText = "\u5F53\u524D\u4EFB\u52A1\u5DF2\u505C\u6B62";
      } else {
        this.activeStreamingMessageIndex = null;
        const message = error instanceof Error ? error.message : String(error);
        this.settleInlineActivityTimeline();
        const errorMessage = {
          id: this.nextMessageId("assistant"),
          role: "assistant",
          kind: "final",
          content: `Hermes call failed.

${message}`
        };
        this.appendTurnMessage(session, errorMessage);
        this.persistActiveSession();
        this.renderChatMessage(errorMessage);
        this.statusText = "Hermes call failed";
        new import_obsidian.Notice("Hermes request failed. Check the sidebar for details.");
      }
      this.refreshActivityStatus();
    } finally {
      this.activeTurnUserMessageId = void 0;
      this.activeActivityMessageId = void 0;
      for (const image of turn.images) {
        cleanupAttachmentFile(image.path);
      }
      this.activeRunCancel = void 0;
      this.isSending = false;
      this.settleInlineActivityTimeline();
      this.refreshActivityStatus();
      this.scheduleMessagesToBottom();
    }
  }
  stopActiveRun() {
    if (!this.isSending || !this.activeRunCancel) {
      return;
    }
    this.statusText = "\u6B63\u5728\u505C\u6B62\u5F53\u524D\u4EFB\u52A1";
    this.activeRunCancel();
    this.refreshActivityStatus();
  }
  persistActiveSession(touch = true) {
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
  composePrompt(userText, contexts, liveContext) {
    return composeObsidianPrompt({ userText, contexts, liveContext });
  }
  buildStatusText() {
    const parts = [];
    const visibleActivity = this.getLatestVisibleActivityText();
    const primaryStatus = visibleActivity || this.statusText;
    if (!shouldHideStatusText(primaryStatus)) {
      parts.push(primaryStatus);
    }
    if (this.queuedTurns.length > 0) {
      parts.push(`\u961F\u5217 ${this.queuedTurns.length}`);
    }
    if (this.isSending) {
      parts.push("Esc \u505C\u6B62");
    }
    return parts.join(" \xB7 ");
  }
  getModelLabel(value) {
    return HERMES_MODEL_OPTIONS.find((option) => option.value === value)?.label ?? value;
  }
  getReasoningLabel(value) {
    return HERMES_REASONING_OPTIONS.find((option) => option.value === value)?.label ?? value;
  }
  scrollMessagesToBottom() {
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
  restoreMessagesScrollTop(targetScrollTop) {
    if (!this.messagesEl) {
      return;
    }
    if (this.pendingScrollRestoreFrame !== null) {
      window.cancelAnimationFrame(this.pendingScrollRestoreFrame);
      this.pendingScrollRestoreFrame = null;
    }
    this.suppressNextMessagesScroll = true;
    this.messagesEl.scrollTop = targetScrollTop;
    if (!shouldDeferScrollRestore({
      targetScrollTop,
      scrollTop: this.messagesEl.scrollTop,
      clientHeight: this.messagesEl.clientHeight,
      scrollHeight: this.messagesEl.scrollHeight
    })) {
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
  scheduleMessagesToBottom() {
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
  captureScrollIntent() {
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
};
var HermesImagePreviewModal = class extends import_obsidian.Modal {
  constructor(app, attachment) {
    super(app);
    this.attachment = attachment;
  }
  onOpen() {
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
  onClose() {
    this.contentEl.empty();
  }
};
var HermesSidebarSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Hermes Sidebar Settings" });
    new import_obsidian.Setting(containerEl).setName("Hermes binary").setDesc("Optional explicit Hermes binary path. If left as 'hermes', the PATH prefix below is used.").addText(
      (text) => text.setPlaceholder("hermes").setValue(this.plugin.settings.hermesBinary).onChange(async (value) => {
        this.plugin.settings.hermesBinary = value.trim() || DEFAULT_HERMES_BINARY;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Provider").setDesc("Primary Hermes provider for Obsidian chat.").addText(
      (text) => text.setValue(this.plugin.settings.provider).onChange(async (value) => {
        this.plugin.settings.provider = value.trim() || DEFAULT_PROVIDER;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Model").setDesc("Primary Hermes model for Obsidian chat.").addText(
      (text) => text.setValue(this.plugin.settings.model).onChange(async (value) => {
        this.plugin.settings.model = value.trim() || DEFAULT_MODEL;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Reasoning effort").setDesc("Default reasoning strength used by the Obsidian sidebar.").addText(
      (text) => text.setValue(this.plugin.settings.reasoningEffort).onChange(async (value) => {
        this.plugin.settings.reasoningEffort = value.trim() || DEFAULT_REASONING_EFFORT;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("PATH prefix").setDesc("Prepended to PATH so Obsidian can resolve the Hermes Python environment.").addTextArea(
      (text) => text.setValue(this.plugin.settings.pathPrefix).onChange(async (value) => {
        this.plugin.settings.pathPrefix = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("System prompt").setDesc("A short instruction injected before each turn.").addTextArea(
      (text) => text.setValue(this.plugin.settings.systemPrompt).onChange(async (value) => {
        this.plugin.settings.systemPrompt = value.trim();
        await this.plugin.saveSettings();
      })
    );
  }
};
function runHermesBridge(input) {
  const binaryDir = input.binary.includes("/") ? (0, import_node_path.dirname)(input.binary) : "";
  const pythonCommand = binaryDir ? (0, import_node_path.join)(binaryDir, "python") : "python";
  const prefixParts = input.pathPrefix.split(import_node_path.delimiter).map((part) => part.trim()).filter(Boolean);
  if (binaryDir) {
    prefixParts.unshift(binaryDir);
  }
  const currentParts = (process.env.PATH ?? "").split(import_node_path.delimiter).map((part) => part.trim()).filter(Boolean);
  const env = {
    ...process.env,
    PATH: [...prefixParts, ...currentParts].join(import_node_path.delimiter),
    HERMES_AGENT_ROOT: input.hermesRoot,
    PYTHONUNBUFFERED: "1"
  };
  let child = null;
  let canceled = false;
  const promise = new Promise((resolve2, reject) => {
    child = (0, import_node_child_process.spawn)(pythonCommand, [input.bridgeScript], {
      env,
      cwd: input.hermesRoot,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;
    let finalResult = null;
    const handleEvent = (event) => {
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
          handleEvent(JSON.parse(trimmed));
        } catch {
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
      resolve2(
        finalResult ?? {
          text: "",
          sessionId: input.sessionId,
          rawOutput: cleanOutputForDisplay(stderrBuffer)
        }
      );
    });
    const payload = {
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
function buildHermesSystemPrompt(basePrompt, runtime) {
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
  return trimmed ? `${trimmed}

${progressInstruction}` : progressInstruction;
}
function resolveBridgeScriptPath(app, manifestDir) {
  if (manifestDir && (0, import_node_path.isAbsolute)(manifestDir)) {
    return (0, import_node_path.resolve)((0, import_node_path.join)(manifestDir, DEFAULT_HERMES_BRIDGE));
  }
  const vaultBasePath = app.vault.adapter?.basePath;
  if (vaultBasePath && manifestDir) {
    return (0, import_node_path.resolve)(vaultBasePath, manifestDir, DEFAULT_HERMES_BRIDGE);
  }
  if (vaultBasePath) {
    return (0, import_node_path.resolve)(vaultBasePath, ".obsidian/plugins/hermes-sidebar", DEFAULT_HERMES_BRIDGE);
  }
  return (0, import_node_path.resolve)(".obsidian/plugins/hermes-sidebar", DEFAULT_HERMES_BRIDGE);
}
function resolvePluginAssetPath(app, manifestDir, assetName) {
  if (manifestDir && (0, import_node_path.isAbsolute)(manifestDir)) {
    return (0, import_node_path.resolve)((0, import_node_path.join)(manifestDir, assetName));
  }
  const vaultBasePath = app.vault.adapter?.basePath;
  if (vaultBasePath && manifestDir) {
    return (0, import_node_path.resolve)(vaultBasePath, manifestDir, assetName);
  }
  if (vaultBasePath) {
    return (0, import_node_path.resolve)(vaultBasePath, ".obsidian/plugins/hermes-sidebar", assetName);
  }
  return (0, import_node_path.resolve)(".obsidian/plugins/hermes-sidebar", assetName);
}
function cleanOutputForDisplay(output) {
  return output.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r\n/g, "\n").trim();
}
function isHermesAbortError(error) {
  return error instanceof Error && error.message === "__HERMES_ABORTED__";
}
function cloneMessages(messages) {
  return messages.map((message) => ({
    ...message,
    attachments: cloneMessageAttachments(message.attachments),
    activities: cloneActivityEntries(message.activities)
  }));
}
function cloneMessageAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return void 0;
  }
  const cloned = attachments.filter(isHermesMessageAttachment).map((attachment) => ({ ...attachment }));
  return cloned.length > 0 ? cloned : void 0;
}
function cloneActivityEntries(activities) {
  if (!Array.isArray(activities) || activities.length === 0) {
    return void 0;
  }
  const cloned = activities.filter(isHermesActivityEntry).map((activity) => ({ ...activity }));
  return cloned.length > 0 ? cloned : void 0;
}
function createChatSession(seed) {
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
function restoreSessions(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return [createChatSession()];
  }
  const restored = input.filter((session) => isPlainObject(session) && typeof session.id === "string").map(
    (session) => createChatSession({
      id: session.id,
      title: typeof session.title === "string" ? session.title : DEFAULT_SESSION_TITLE,
      createdAt: typeof session.createdAt === "number" ? session.createdAt : Date.now(),
      updatedAt: typeof session.updatedAt === "number" ? session.updatedAt : Date.now(),
      sessionId: typeof session.sessionId === "string" ? session.sessionId : void 0,
      messages: Array.isArray(session.messages) ? session.messages.filter(isHermesMessage) : []
    })
  );
  return restored.length > 0 ? restored : [createChatSession()];
}
function isPersistedDataShape(value) {
  if (!isPlainObject(value)) {
    return false;
  }
  if ("sessions" in value && value.sessions !== void 0 && !Array.isArray(value.sessions)) {
    return false;
  }
  if ("activeSessionId" in value && value.activeSessionId !== void 0 && typeof value.activeSessionId !== "string") {
    return false;
  }
  return true;
}
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function isHermesMessage(value) {
  if (!isPlainObject(value)) {
    return false;
  }
  if ("id" in value && value.id !== void 0 && typeof value.id !== "string") {
    return false;
  }
  if ("attachments" in value && value.attachments !== void 0 && !Array.isArray(value.attachments)) {
    return false;
  }
  if ("activities" in value && value.activities !== void 0 && !Array.isArray(value.activities)) {
    return false;
  }
  if ("interim" in value && value.interim !== void 0 && typeof value.interim !== "boolean") {
    return false;
  }
  return (value.role === "user" || value.role === "assistant" || value.role === "system") && (value.kind === "user" || value.kind === "progress" || value.kind === "activity" || value.kind === "final") && typeof value.content === "string";
}
function isHermesActivityEntry(value) {
  return isPlainObject(value) && typeof value.id === "string" && typeof value.text === "string" && (value.status === "running" || value.status === "done" || value.status === "error" || value.status === "info") && typeof value.createdAt === "number";
}
function isHermesMessageAttachment(value) {
  return isPlainObject(value) && value.type === "image" && typeof value.name === "string" && typeof value.previewDataUrl === "string";
}
function getEditorSelectionsText(view) {
  const editor = view.editor;
  const ranges = editor.listSelections().map((selection) => getEditorSelectionRangeText(view, selection.anchor, selection.head)).map((text) => text.trim()).filter(Boolean) ?? [];
  if (ranges.length > 1) {
    return ranges.join("\n\n---\n\n");
  }
  return ranges[0] ?? editor.getSelection();
}
function getEditorSelectionRangeText(view, anchor, head) {
  const [from, to] = compareEditorPositions(anchor, head) <= 0 ? [anchor, head] : [head, anchor];
  if (from.line === to.line && from.ch === to.ch) {
    return "";
  }
  return view.editor.getRange(from, to);
}
function compareEditorPositions(left, right) {
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  return left.ch - right.ch;
}
function summarizeSelectionLength(text) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "0 chars";
  }
  return `${compact.length} chars`;
}
function joinActivityText(label, preview, maxLength = 72) {
  const compactPreview = preview.replace(/\s+/g, " ").trim();
  if (!compactPreview) {
    return label;
  }
  return `${label}\uFF1A${formatSelectionPreview(compactPreview, maxLength)}`;
}
function formatActivityTitleForTimeline(entry, index) {
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
function formatActivityState(entry) {
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
function formatActivityMeta(entry) {
  const parts = [
    entry.text,
    typeof entry.duration === "number" && entry.status !== "done" ? `${entry.duration.toFixed(1)}s` : ""
  ].filter(Boolean);
  return parts.join(" \xB7 ");
}
function isDetailedStatusText(text) {
  const value = text.trim();
  if (!value) {
    return false;
  }
  return !(/* @__PURE__ */ new Set([
    "Hermes \u5DF2\u6536\u5230\u8FD9\u6761\u6D88\u606F",
    "\u6B63\u5728\u601D\u8003\u4E2D",
    "\u6B63\u5728\u8C03\u7528\u5DE5\u5177\u4E2D",
    "Hermes \u6B63\u5728\u5904\u7406",
    "Hermes \u6B63\u5728\u7EE7\u7EED\u5904\u7406",
    "Hermes \u6B63\u5728\u5199\u56DE\u590D"
  ])).has(value);
}
function formatToolDisplayName(toolName) {
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
function formatToolStatusText(toolName, status) {
  if (toolName === "skill_view") {
    return status === "running" ? "\u6B63\u5728\u8BFB\u53D6 skill" : status === "done" ? "\u5DF2\u8BFB\u53D6 skill" : "skill \u8BFB\u53D6\u5931\u8D25";
  }
  if (toolName === "skills_list") {
    return status === "running" ? "\u6B63\u5728\u5217\u51FA skills" : status === "done" ? "\u5DF2\u5217\u51FA skills" : "skills \u5217\u8868\u8BFB\u53D6\u5931\u8D25";
  }
  if (toolName === "skill_manage") {
    return status === "running" ? "\u6B63\u5728\u7BA1\u7406 skill" : status === "done" ? "\u5DF2\u7BA1\u7406 skill" : "skill \u7BA1\u7406\u5931\u8D25";
  }
  if (status === "running") {
    return `\u6B63\u5728\u8C03\u7528 ${toolName}`;
  }
  if (status === "done") {
    return `\u5DF2\u5B8C\u6210 ${toolName}`;
  }
  return `${toolName} \u8C03\u7528\u5931\u8D25`;
}
async function createPendingImageAttachment(file) {
  const extension = normalizeImageExtension(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  const attachmentDir = (0, import_node_path.join)((0, import_node_os.tmpdir)(), "obsidian-hermes-sidebar");
  (0, import_node_fs.mkdirSync)(attachmentDir, { recursive: true });
  const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const filePath = (0, import_node_path.join)(attachmentDir, `${id}${extension}`);
  (0, import_node_fs.writeFileSync)(filePath, buffer);
  return {
    id,
    name: file.name || (0, import_node_path.basename)(filePath),
    path: filePath,
    previewDataUrl: `data:${file.type || mimeTypeFromExtension(extension)};base64,${buffer.toString("base64")}`
  };
}
function cleanupAttachmentFile(path) {
  if (!path) {
    return;
  }
  try {
    (0, import_node_fs.unlinkSync)(path);
  } catch {
  }
}
function normalizeImageExtension(file) {
  const raw = (0, import_node_path.extname)(file.name || "").trim().toLowerCase();
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
function mimeTypeFromExtension(extension) {
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
var main_default = HermesSidebarPlugin;
