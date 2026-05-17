import {
	App,
	Editor,
	EditorPosition,
	EditorSuggest,
	EditorSuggestContext,
	EditorSuggestTriggerInfo,
	MarkdownView,
	Notice,
	Plugin,
	TFile,
	editorEditorField
} from "obsidian";
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
	showTooltip,
	type Tooltip
} from "@codemirror/view";
import {
	INLINE_EDIT_ACTIONS,
	InlineEditAction,
	InlineEditActionMode,
	InlineEditDraftState,
	buildInlineEditPrompt,
	comparePositions,
	filterInlineEditActions,
	findInlineEditSourceRange,
	getInlineEditDraftOriginalText,
	getInlineEditToolbarActions,
	getInlineEditAction,
	getParagraphRangeAtCursor,
	isContinuousSelection,
	parseSlashTrigger,
	resolveSelectionSourceRange,
	buildSelectionContextWindow,
	selectVaultNoteTitlesForWikiPrompt,
	transitionInlineDraft
} from "./inline-edit-helpers";

export interface InlineEditRuntimeSettings {
	provider: string;
	model: string;
	reasoningEffort: string;
	systemPrompt: string;
}

export interface InlineEditRunInput {
	prompt: string;
	systemPrompt: string;
	provider: string;
	model: string;
	reasoningEffort: string;
}

export interface InlineEditRunResult {
	text: string;
}

export interface InlineEditManagerOptions {
	plugin: Plugin;
	app: App;
	getSettings: () => InlineEditRuntimeSettings;
	run: (input: InlineEditRunInput) => { promise: Promise<InlineEditRunResult>; cancel: () => void };
}

interface InlineEditSelectionContext {
	editor: Editor;
	markdownView: MarkdownView;
	file: TFile;
	mode: "source" | "preview";
	rect: { left: number; top: number; right: number; bottom: number };
	from: EditorPosition;
	to: EditorPosition;
	fromOffset: number;
	toOffset: number;
	text: string;
	noteText: string;
	noteContext: string;
}

interface InlineEditRequestContext {
	action: InlineEditAction;
	editor: Editor;
	markdownView: MarkdownView;
	file: TFile;
	from: EditorPosition;
	to: EditorPosition;
	fromOffset: number;
	toOffset: number;
	targetText: string;
	noteText: string;
	noteContext: string;
	noteTitle: string;
	mode: InlineEditActionMode;
	sourceText?: string;
	customInstruction?: string;
	followUp?: string;
	currentProposal?: string;
}

interface InlineEditDraftPayload {
	draft: InlineEditDraftState | null;
	anchor: number;
	onAccept: () => void;
	onCancel: () => void;
	onRetry: () => void;
	onFollowUp: (text: string) => void;
}

const setInlineEditDraftEffect = StateEffect.define<InlineEditDraftPayload | null>();

const inlineEditDraftField = StateField.define<InlineEditDraftPayload | null>({
	create: () => null,
	update(value, transaction) {
		let next = value;
		for (const effect of transaction.effects) {
			if (effect.is(setInlineEditDraftEffect)) {
				next = effect.value;
			}
		}
		if (next?.draft && transaction.docChanged) {
			const from = transaction.changes.mapPos(next.draft.fromOffset, -1);
			const to = transaction.changes.mapPos(next.draft.toOffset, 1);
			next = {
				...next,
				anchor: transaction.changes.mapPos(next.anchor, 1),
				draft: {
					...next.draft,
					fromOffset: from,
					toOffset: to
				}
			};
		}
		return next;
	},
	provide: (field) =>
		showTooltip.from(field, (value) => (value?.draft?.status === "generating" ? buildInlineEditTooltip(value) : null))
});

const inlineEditDecorationPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = buildInlineEditDecorations(view);
		}

		update(update: ViewUpdate): void {
			if (update.docChanged || update.viewportChanged || update.transactions.some((transaction) => transaction.effects.length > 0)) {
				this.decorations = buildInlineEditDecorations(update.view);
			}
		}
	},
	{
		decorations: (value) => value.decorations
	}
);

export function createInlineEditExtension(): Extension {
	return [inlineEditDraftField, inlineEditDecorationPlugin];
}

export class InlineEditManager {
	private options: InlineEditManagerOptions;
	private slashSuggest: HermesInlineSlashSuggest;
	private currentView: EditorView | null = null;
	private currentContext: InlineEditRequestContext | null = null;
	private currentDraft: InlineEditDraftState | null = null;
	private currentCancel: (() => void) | null = null;
	private requestCounter = 0;
	private selectionToolbarEl: HTMLDivElement | null = null;
	private selectionToolbarTimer: number | null = null;
	private lastMultiSelectionNoticeAt = 0;

	constructor(options: InlineEditManagerOptions) {
		this.options = options;
		this.slashSuggest = new HermesInlineSlashSuggest(options.app, this);
		options.plugin.registerEditorSuggest(this.slashSuggest);
		options.plugin.registerEditorExtension(createInlineEditExtension());
		options.plugin.registerDomEvent(document, "selectionchange", () => this.scheduleSelectionToolbar());
		options.plugin.registerDomEvent(document, "keyup", () => this.scheduleSelectionToolbar());
		options.plugin.registerDomEvent(document, "pointerup", () => this.scheduleSelectionToolbar());
		options.plugin.registerDomEvent(window, "scroll", () => this.scheduleSelectionToolbar(), true);
		options.plugin.registerDomEvent(window, "resize", () => this.scheduleSelectionToolbar());
		options.plugin.registerDomEvent(document, "keydown", (event) => {
			if (event.key === "Escape") {
				this.cancelDraft();
				this.hideSelectionToolbar();
			}
		});
		options.plugin.registerEvent(
			options.app.workspace.on("active-leaf-change", () => {
				this.cancelDraft();
				this.hideSelectionToolbar();
			})
		);
		options.plugin.registerEvent(
			options.app.workspace.on("file-open", () => {
				this.cancelDraft();
				this.hideSelectionToolbar();
			})
		);
		options.plugin.registerEvent(
			options.app.workspace.on("editor-change", (editor, info) => {
				this.syncCurrentDraftFromView();
				if (this.currentDraft && this.currentContext?.editor === editor && !this.isOriginalTextStillPresent(editor)) {
					this.cancelDraft("原文已被修改，请重新生成。");
				}
				if (!(info instanceof MarkdownView)) {
					this.hideSelectionToolbar();
				}
				this.scheduleSelectionToolbar();
			})
		);
	}

	destroy(): void {
		this.cancelDraft();
		this.hideSelectionToolbar();
		if (this.selectionToolbarTimer !== null) {
			window.clearTimeout(this.selectionToolbarTimer);
			this.selectionToolbarTimer = null;
		}
	}

	getSlashSuggestions(query: string): InlineEditAction[] {
		return filterInlineEditActions(query);
	}

	async runSlashAction(action: InlineEditAction, context: EditorSuggestContext): Promise<void> {
		context.editor.replaceRange("", context.start, context.end, "+hermes-inline-slash");
		const markdownView = this.options.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView || markdownView.editor !== context.editor || !context.file) {
			new Notice("Hermes inline edit 只能在当前 Markdown 编辑器里使用。");
			return;
		}
		const cursor = context.start;
		const requestContext = this.buildRequestContextFromCursor(action, context.editor, markdownView, context.file, cursor);
		await this.startRequest(requestContext);
	}

	async runSelectionAction(actionId: string): Promise<void> {
		const action = getInlineEditAction(actionId);
		const selectionContext = this.getSelectionContext();
		if (!action || !selectionContext) {
			return;
		}
		this.hideSelectionToolbar();
		const requestContext = this.buildRequestContextFromSelection(action, selectionContext);
		if (action.id === "custom") {
			const customInstruction = await this.promptForCustomInstruction();
			if (!customInstruction) {
				return;
			}
			requestContext.customInstruction = customInstruction;
		}
		await this.startRequest(requestContext);
	}

	private scheduleSelectionToolbar(): void {
		if (this.selectionToolbarTimer !== null) {
			window.clearTimeout(this.selectionToolbarTimer);
		}
		this.selectionToolbarTimer = window.setTimeout(() => {
			this.selectionToolbarTimer = null;
			this.renderSelectionToolbar();
		}, 80);
	}

	private renderSelectionToolbar(): void {
		if (this.currentDraft) {
			this.hideSelectionToolbar();
			return;
		}
		const context = this.getSelectionContext();
		if (!context) {
			this.hideSelectionToolbar();
			return;
		}

		if (!this.selectionToolbarEl) {
			this.selectionToolbarEl = document.body.createDiv({ cls: "hermes-inline-toolbar" });
			for (const action of getInlineEditToolbarActions(INLINE_EDIT_ACTIONS)) {
				const button = this.selectionToolbarEl.createEl("button", {
					cls: "hermes-inline-toolbar-button",
					text: action.shortLabel,
					attr: { type: "button", title: action.description }
				});
				button.addEventListener("mousedown", (event) => event.preventDefault());
				button.addEventListener("click", () => void this.runSelectionAction(action.id));
			}
		}

		const rect = context.rect;
		if (!rect) {
			this.hideSelectionToolbar();
			return;
		}
		const toolbarWidth = this.selectionToolbarEl.offsetWidth || 420;
		const left = Math.min(window.innerWidth - toolbarWidth - 12, Math.max(12, rect.left - 48));
		this.selectionToolbarEl.style.left = `${Math.max(12, left)}px`;
		this.selectionToolbarEl.style.top = `${Math.max(12, rect.top - 52)}px`;
		this.selectionToolbarEl.addClass("is-visible");
	}

	private hideSelectionToolbar(): void {
		this.selectionToolbarEl?.remove();
		this.selectionToolbarEl = null;
	}

	private getSelectionContext(): InlineEditSelectionContext | null {
		const markdownView = this.options.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView || !markdownView.file) {
			return null;
		}
		const mode = markdownView.getMode() === "preview" ? "preview" : "source";
		const editor = markdownView.editor;
		const noteText = markdownView.getViewData?.() ?? editor.getValue();

		if (mode === "source") {
			const selections = editor.listSelections();
			if (selections.length === 1 && isContinuousSelection(selections)) {
				const selection = selections[0];
				const [from, to] =
					comparePositions(selection.anchor, selection.head) <= 0
						? [selection.anchor, selection.head]
						: [selection.head, selection.anchor];
				const text = editor.getRange(from, to);
				if (!text.trim()) {
					return null;
				}
				const view = this.findEditorView(markdownView);
				const fromOffset = editor.posToOffset(from);
				const toOffset = editor.posToOffset(to);
				const rect = view?.coordsAtPos(toOffset, 1) ?? view?.coordsAtPos(fromOffset, -1);
				if (!rect || !view) {
					return null;
				}
				const noteContext = buildSelectionContextWindow({
					noteText,
					fromOffset,
					toOffset,
					selectedText: text,
					mode,
					windowLines: 6,
					maxCharacters: 1800
				});
				return {
					editor,
					markdownView,
					file: markdownView.file,
					mode,
					rect: {
						left: rect.left,
						top: rect.top,
						right: rect.right,
						bottom: rect.bottom
					},
					from,
					to,
					fromOffset,
					toOffset,
					text,
					noteText,
					noteContext
				};
			}

			if (selections.length > 1) {
				this.noticeMultipleSelections();
				return null;
			}

			const domSelection = window.getSelection();
			if (domSelection && !domSelection.isCollapsed && domSelection.rangeCount === 1) {
				const view = this.findEditorView(markdownView);
				if (!view || !this.selectionBelongsToContainer(domSelection, view.dom)) {
					return null;
				}
				const selectedText = domSelection.toString().trim();
				if (!selectedText) {
					return null;
				}
				const cursorOffset = editor.posToOffset(editor.getCursor());
				const sourceRange = findInlineEditSourceRange(noteText, selectedText, cursorOffset);
				if (!sourceRange) {
					return null;
				}
				const from = editor.offsetToPos(sourceRange.fromOffset);
				const to = editor.offsetToPos(sourceRange.toOffset);
				const rect = domSelection.getRangeAt(0).getBoundingClientRect();
				const noteContext = buildSelectionContextWindow({
					noteText,
					fromOffset: sourceRange.fromOffset,
					toOffset: sourceRange.toOffset,
					selectedText: sourceRange.targetText,
					mode,
					windowLines: 6,
					maxCharacters: 1800
				});
				return {
					editor,
					markdownView,
					file: markdownView.file,
					mode,
					rect: {
						left: rect.left,
						top: rect.top,
						right: rect.right,
						bottom: rect.bottom
					},
					from,
					to,
					fromOffset: sourceRange.fromOffset,
					toOffset: sourceRange.toOffset,
					text: sourceRange.targetText,
					noteText,
					noteContext
				};
			}

			return null;
		}

		const domSelection = window.getSelection();
		if (!domSelection || domSelection.isCollapsed || domSelection.rangeCount !== 1) {
			return null;
		}
		const previewContainer = markdownView.previewMode?.containerEl ?? markdownView.containerEl;
		if (!this.selectionBelongsToContainer(domSelection, previewContainer)) {
			return null;
		}

		const selectedText = domSelection.toString().trim();
		if (!selectedText) {
			return null;
		}
		const preferredOffset = editor.posToOffset(editor.getCursor());
		const sourceRange = resolveSelectionSourceRange(noteText, selectedText, preferredOffset, "preview");
		if (!sourceRange) {
			new Notice("阅读模式选区暂时无法映射到源码，请切换到源码模式后再试。");
			return null;
		}
		const from = editor.offsetToPos(sourceRange.fromOffset);
		const to = editor.offsetToPos(sourceRange.toOffset);
		const rect = domSelection.getRangeAt(0).getBoundingClientRect();
		const noteContext = buildSelectionContextWindow({
			noteText,
			fromOffset: sourceRange.fromOffset,
			toOffset: sourceRange.toOffset,
			selectedText: sourceRange.targetText,
			mode,
			windowLines: 6,
			maxCharacters: 1800
		});

		return {
			editor,
			markdownView,
			file: markdownView.file,
			mode,
			rect: {
				left: rect.left,
				top: rect.top,
				right: rect.right,
				bottom: rect.bottom
			},
			from,
			to,
			fromOffset: sourceRange.fromOffset,
			toOffset: sourceRange.toOffset,
			text: sourceRange.targetText,
			noteText,
			noteContext
		};
	}

	private buildRequestContextFromSelection(
		action: InlineEditAction,
		context: InlineEditSelectionContext
	): InlineEditRequestContext {
		const from = action.mode === "replace" ? context.from : context.to;
		const to = action.mode === "replace" ? context.to : context.to;
		return {
			action,
			editor: context.editor,
			markdownView: context.markdownView,
			file: context.file,
			from,
			to,
			fromOffset: context.editor.posToOffset(from),
			toOffset: context.editor.posToOffset(to),
			targetText: context.text,
			sourceText: context.editor.getRange(from, to),
			noteText: context.noteText,
			noteContext: context.noteContext,
			noteTitle: context.file.basename,
			mode: action.mode
		};
	}

	private buildRequestContextFromCursor(
		action: InlineEditAction,
		editor: Editor,
		markdownView: MarkdownView,
		file: TFile,
		cursor: EditorPosition
	): InlineEditRequestContext {
		const noteText = editor.getValue();
		const lines = noteText.split("\n");
		const paragraph = action.mode === "note" ? null : getParagraphRangeAtCursor(lines, cursor);
		const mode = action.mode === "replace" ? "replace" : action.mode;
		const from = action.mode === "insert" || action.mode === "note" ? cursor : paragraph?.from ?? cursor;
		const to = action.mode === "insert" || action.mode === "note" ? cursor : paragraph?.to ?? cursor;
		return {
			action,
			editor,
			markdownView,
			file,
			from,
			to,
			fromOffset: editor.posToOffset(from),
			toOffset: editor.posToOffset(to),
			targetText: action.mode === "note" ? noteText : paragraph?.text ?? "",
			sourceText: action.mode === "note" ? noteText : paragraph?.text ?? "",
			noteText,
			noteContext: buildSelectionContextWindow({
				noteText,
				fromOffset: editor.posToOffset(from),
				toOffset: editor.posToOffset(to),
				mode: "source",
				windowLines: 6,
				maxCharacters: 1800
			}),
			noteTitle: file.basename,
			mode
		};
	}

	private async startRequest(context: InlineEditRequestContext): Promise<void> {
		this.cancelDraft();
		const view = this.findEditorView(context.markdownView);
		if (!view) {
			new Notice("没有找到当前编辑器视图。");
			return;
		}
		const requestId = ++this.requestCounter;
		const draft: InlineEditDraftState = {
			actionId: context.action.id,
			filePath: context.file.path,
			fromOffset: context.fromOffset,
			toOffset: context.toOffset,
			originalText: getInlineEditDraftOriginalText({
				targetText: context.targetText,
				sourceText: context.sourceText
			}),
			proposedText: "",
			status: "generating",
			requestId
		};
		this.currentView = view;
		this.currentContext = context;
		this.currentDraft = draft;
		this.pushDraftToView();

		const settings = this.options.getSettings();
		const vaultNoteTitles = context.action.id === "wiki-link" ? this.getVaultNoteTitlesForWiki(context) : undefined;
		const prompt = buildInlineEditPrompt({
			action: context.action,
			targetText: context.action.mode === "note" ? "" : context.targetText,
			sourceText: context.sourceText,
			noteText: context.action.mode === "note" ? context.noteText : undefined,
			noteContext: context.noteContext,
			noteTitle: context.noteTitle,
			vaultNoteTitles,
			customInstruction: context.customInstruction,
			followUp: context.followUp,
			currentProposal: context.currentProposal
		});
		const run = this.options.run({
			prompt,
			systemPrompt: buildInlineSystemPrompt(settings.systemPrompt),
			provider: settings.provider,
			model: settings.model,
			reasoningEffort: settings.reasoningEffort
		});
		this.currentCancel = run.cancel;

		try {
			const result = await run.promise;
			if (!this.currentDraft || this.currentDraft.requestId !== requestId) {
				return;
			}
			const next = transitionInlineDraft(this.currentDraft, "ready", {
				requestId,
				proposedText: cleanInlineProposal(result.text)
			}).state;
			this.currentDraft = next;
			this.pushDraftToView();
		} catch (error) {
			if (!this.currentDraft || this.currentDraft.requestId !== requestId) {
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			const next = transitionInlineDraft(this.currentDraft, "error", { requestId, message }).state;
			this.currentDraft = next;
			this.pushDraftToView();
			new Notice(`Hermes inline edit 失败：${message}`);
		} finally {
			if (this.currentDraft?.requestId === requestId) {
				this.currentCancel = null;
			}
		}
	}

	private acceptDraft(): void {
		if (!this.currentDraft || !this.currentContext) {
			return;
		}
		const proposed = this.currentDraft.proposedText.trim();
		if (!proposed) {
			new Notice("没有可接受的 AI 结果。");
			return;
		}
		if (!this.isOriginalTextStillPresent(this.currentContext.editor)) {
			this.cancelDraft("原文已变化，已取消这次预览。");
			return;
		}
		const editor = this.currentContext.editor;
		const from = editor.offsetToPos(this.currentDraft.fromOffset);
		const to = editor.offsetToPos(this.currentDraft.toOffset);
		this.clearDraft();
		editor.replaceRange(proposed, from, to, "+hermes-inline-accept");
	}

	private cancelDraft(message?: string): void {
		if (this.currentCancel) {
			this.currentCancel();
			this.currentCancel = null;
		}
		this.clearDraft();
		if (message) {
			new Notice(message);
		}
	}

	private retryDraft(): void {
		if (!this.currentContext) {
			return;
		}
		void this.startRequest({ ...this.currentContext, currentProposal: this.currentDraft?.proposedText });
	}

	private followUpDraft(text: string): void {
		if (!this.currentContext || !text.trim()) {
			return;
		}
		void this.startRequest({
			...this.currentContext,
			followUp: text.trim(),
			currentProposal: this.currentDraft?.proposedText
		});
	}

	private clearDraft(): void {
		this.currentDraft = null;
		this.currentContext = null;
		this.currentCancel = null;
		this.pushDraftToView();
		this.currentView = null;
	}

	private pushDraftToView(): void {
		if (!this.currentView) {
			return;
		}
		const draft = this.currentDraft;
		this.currentView.dispatch({
			effects: setInlineEditDraftEffect.of(
				draft
					? {
							draft,
							anchor: draft.toOffset,
							onAccept: () => this.acceptDraft(),
							onCancel: () => this.cancelDraft(),
							onRetry: () => this.retryDraft(),
							onFollowUp: (text: string) => this.followUpDraft(text)
						}
					: null
			)
		});
	}

	private findEditorView(markdownView: MarkdownView): EditorView | null {
		try {
			const editorWithCm = markdownView.editor as Editor & {
				cm?: { state?: { field?: (field: typeof editorEditorField, require?: boolean) => unknown } };
			};
			const state = editorWithCm.cm?.state;
			const view = state?.field ? state.field(editorEditorField, false) : null;
			if (view instanceof EditorView) {
				return view;
			}
		} catch {
			// Fallback below.
		}
		const editorEl = markdownView.containerEl.querySelector(".cm-editor");
		return editorEl instanceof HTMLElement ? EditorView.findFromDOM(editorEl) : null;
	}

	private selectionBelongsToContainer(selection: Selection, container: HTMLElement): boolean {
		const anchor = selection.anchorNode;
		const focus = selection.focusNode;
		return Boolean(anchor && focus && container.contains(anchor) && container.contains(focus));
	}

	private getVaultNoteTitlesForWiki(context: InlineEditRequestContext): string[] {
		const titles = this.options.app.vault
			.getMarkdownFiles()
			.filter((file) => file.path !== context.file.path)
			.map((file) => file.basename);
		return selectVaultNoteTitlesForWikiPrompt({
			titles,
			targetText: `${context.targetText}\n${context.sourceText ?? ""}`,
			noteTitle: context.noteTitle,
			limit: 100
		});
	}

	private async promptForCustomInstruction(): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new InlineEditCustomPromptModal(this.options.app, resolve);
			modal.open();
		});
	}

	private syncCurrentDraftFromView(): void {
		if (!this.currentView || !this.currentDraft) {
			return;
		}
		const payload = this.currentView.state.field(inlineEditDraftField, false);
		if (payload?.draft?.requestId === this.currentDraft.requestId) {
			this.currentDraft = payload.draft;
		}
	}

	private isOriginalTextStillPresent(editor: Editor): boolean {
		if (!this.currentDraft || this.currentContext?.mode === "insert" || this.currentContext?.mode === "note") {
			return true;
		}
		const from = editor.offsetToPos(this.currentDraft.fromOffset);
		const to = editor.offsetToPos(this.currentDraft.toOffset);
		return editor.getRange(from, to) === this.currentDraft.originalText;
	}

	private noticeMultipleSelections(): void {
		const now = Date.now();
		if (now - this.lastMultiSelectionNoticeAt < 2400) {
			return;
		}
		this.lastMultiSelectionNoticeAt = now;
		new Notice("请选择一段连续文本。");
	}
}

class HermesInlineSlashSuggest extends EditorSuggest<InlineEditAction> {
	private manager: InlineEditManager;

	constructor(app: App, manager: InlineEditManager) {
		super(app);
		this.manager = manager;
		this.limit = 9;
	}

	onTrigger(cursor: EditorPosition, editor: Editor, file: TFile | null): EditorSuggestTriggerInfo | null {
		if (!file) {
			return null;
		}
		const trigger = parseSlashTrigger(editor.getLine(cursor.line), cursor.ch);
		if (!trigger) {
			return null;
		}
		return {
			start: { line: cursor.line, ch: trigger.fromCh },
			end: cursor,
			query: trigger.query
		};
	}

	getSuggestions(context: EditorSuggestContext): InlineEditAction[] {
		return this.manager.getSlashSuggestions(context.query);
	}

	renderSuggestion(value: InlineEditAction, el: HTMLElement): void {
		el.addClass("hermes-inline-suggest-item");
		el.createDiv({ cls: "hermes-inline-suggest-title", text: value.label });
		el.createDiv({ cls: "hermes-inline-suggest-desc", text: value.description });
	}

	selectSuggestion(value: InlineEditAction): void {
		if (!this.context) {
			return;
		}
		void this.manager.runSlashAction(value, this.context);
	}
}

class InlineEditCustomPromptModal {
	private resolve: (value: string | null) => void;
	private didResolve = false;
	private panelEl: HTMLDivElement | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private previouslyFocusedEl: HTMLElement | null = null;
	private outsideClickHandler = (event: PointerEvent): void => {
		if (!this.panelEl || !(event.target instanceof Node) || this.panelEl.contains(event.target)) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		this.dismiss(null);
	};
	private keydownHandler = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			this.dismiss(null);
			return;
		}
		if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			this.dismiss(this.inputEl?.value.trim() || null);
		}
	};

	constructor(_app: App, resolve: (value: string | null) => void) {
		this.resolve = resolve;
	}

	open(): void {
		if (this.panelEl) {
			return;
		}
		this.previouslyFocusedEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;

		const dialog = document.body.createDiv({ cls: "hermes-inline-custom-modal" });
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-modal", "false");
		dialog.setAttribute("aria-label", "自定义提问");

		const header = dialog.createDiv({ cls: "hermes-inline-custom-header" });
		const titleWrap = header.createDiv({ cls: "hermes-inline-custom-title-wrap" });
		titleWrap.createEl("h2", { text: "自定义提问" });
		titleWrap.createDiv({
			cls: "hermes-inline-custom-hint",
			text: "用一句话告诉 Hermes 你想怎么改。"
		});
		const closeButton = header.createEl("button", {
			cls: "hermes-inline-custom-close",
			text: "×",
			attr: { type: "button", "aria-label": "关闭" }
		});

		const input = dialog.createEl("textarea", {
			cls: "hermes-inline-custom-input",
			attr: {
				rows: "5",
				placeholder: "比如：整理成更有力量的 Markdown；把表格改成更清楚的行动清单；语气更冷静一点..."
			}
		});

		const actions = dialog.createDiv({ cls: "hermes-inline-custom-actions" });
		const cancel = actions.createEl("button", { text: "取消", attr: { type: "button" } });
		const submit = actions.createEl("button", {
			cls: "mod-cta",
			text: "生成预览",
			attr: { type: "button" }
		});

		this.panelEl = dialog;
		this.inputEl = input;

		closeButton.addEventListener("click", () => this.dismiss(null));
		cancel.addEventListener("click", () => this.dismiss(null));
		submit.addEventListener("click", () => this.dismiss(input.value.trim() || null));
		document.addEventListener("pointerdown", this.outsideClickHandler, true);
		document.addEventListener("keydown", this.keydownHandler, true);
		window.setTimeout(() => {
			input.focus({ preventScroll: true });
			input.select();
		}, 0);
	}

	private dismiss(value: string | null): void {
		this.finish(value);
		this.teardown();
	}

	private teardown(): void {
		document.removeEventListener("pointerdown", this.outsideClickHandler, true);
		document.removeEventListener("keydown", this.keydownHandler, true);
		this.panelEl?.remove();
		this.panelEl = null;
		this.inputEl = null;
		this.previouslyFocusedEl?.focus({ preventScroll: true });
		this.previouslyFocusedEl = null;
	}

	private finish(value: string | null): void {
		if (this.didResolve) {
			return;
		}
		this.didResolve = true;
		this.resolve(value);
	}
}

class InlineProposalWidget extends WidgetType {
	private payload: InlineEditDraftPayload;

	constructor(payload: InlineEditDraftPayload) {
		super();
		this.payload = payload;
	}

	eq(other: WidgetType): boolean {
		return other instanceof InlineProposalWidget && other.payload.draft === this.payload.draft;
	}

	toDOM(): HTMLElement {
		const draft = this.payload.draft;
		const root = document.createElement("span");
		root.className = `hermes-inline-proposal is-${draft?.status ?? "idle"}`;
		if (!draft) {
			return root;
		}

		if (draft.status === "generating") {
			root.createSpan({ cls: "hermes-inline-loading", text: "Hermes 正在生成..." });
			return root;
		}

		if (draft.status === "error") {
			root.createSpan({ cls: "hermes-inline-error", text: "生成失败" });
			appendInlineControls(root, this.payload, true);
			return root;
		}

		root.createSpan({ cls: "hermes-inline-new-text", text: draft.proposedText || "(空结果)" });
		appendInlineControls(root, this.payload, false);
		return root;
	}
}

function buildInlineEditDecorations(view: EditorView): DecorationSet {
	const payload = view.state.field(inlineEditDraftField, false);
	if (!payload?.draft) {
		return Decoration.none;
	}

	const ranges = [];
	const draft = payload.draft;
	if (draft.status !== "generating" && draft.originalText && draft.fromOffset !== draft.toOffset) {
		ranges.push(
			Decoration.mark({
				class: "hermes-inline-original"
			}).range(draft.fromOffset, draft.toOffset)
		);
	}
	ranges.push(
		Decoration.widget({
			widget: new InlineProposalWidget(payload),
			side: 1
		}).range(payload.anchor)
	);
	return Decoration.set(ranges, true);
}

function buildInlineEditTooltip(payload: InlineEditDraftPayload): Tooltip {
	return {
		pos: payload.anchor,
		above: true,
		clip: false,
		create() {
			const dom = document.createElement("div");
			dom.className = `hermes-inline-tooltip is-${payload.draft?.status ?? "idle"}`;
			if (payload.draft?.status === "generating") {
				dom.createSpan({ cls: "hermes-inline-tooltip-status", text: "生成中" });
				return { dom };
			}
			if (payload.draft?.status === "error") {
				dom.createSpan({ cls: "hermes-inline-tooltip-status", text: "生成失败" });
			}
			appendInlineControls(dom, payload, payload.draft?.status === "error");
			return { dom };
		}
	};
}

function appendInlineControls(root: HTMLElement, payload: InlineEditDraftPayload, errorOnly: boolean): void {
	const controls = root.createSpan({ cls: "hermes-inline-controls" });
	if (!errorOnly) {
		const accept = controls.createEl("button", {
			cls: "hermes-inline-control is-accept",
			text: "接受",
			attr: { type: "button" }
		});
		accept.addEventListener("mousedown", (event) => event.preventDefault());
		accept.addEventListener("click", payload.onAccept);
	}

	const cancel = controls.createEl("button", {
		cls: "hermes-inline-control",
		text: "撤销",
		attr: { type: "button" }
	});
	cancel.addEventListener("mousedown", (event) => event.preventDefault());
	cancel.addEventListener("click", payload.onCancel);

	const retry = controls.createEl("button", {
		cls: "hermes-inline-control",
		text: "重试",
		attr: { type: "button" }
	});
	retry.addEventListener("mousedown", (event) => event.preventDefault());
	retry.addEventListener("click", payload.onRetry);

	if (!errorOnly) {
		const follow = controls.createEl("form", { cls: "hermes-inline-followup" });
		const input = follow.createEl("input", {
			type: "text",
			placeholder: "追问：再短一点...",
			cls: "hermes-inline-followup-input"
		});
		const submit = follow.createEl("button", {
			cls: "hermes-inline-control is-followup",
			text: "追问",
			attr: { type: "submit" }
		});
		submit.addEventListener("mousedown", (event) => event.preventDefault());
		follow.addEventListener("submit", (event) => {
			event.preventDefault();
			payload.onFollowUp(input.value);
		});
	}
}

function buildInlineSystemPrompt(basePrompt: string): string {
	return [
		basePrompt.trim(),
		"You are Hermes inline edit inside Obsidian. Return only the replacement or insertion Markdown. No explanations, no code fences, no chat preface."
	]
		.filter(Boolean)
		.join("\n\n");
}

function cleanInlineProposal(text: string): string {
	return text
		.replace(/^```(?:markdown|md)?\s*/i, "")
		.replace(/```\s*$/i, "")
		.trim();
}
