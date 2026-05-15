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
	getInlineEditAction,
	getParagraphRangeAtCursor,
	isContinuousSelection,
	parseSlashTrigger,
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
	view: EditorView;
	editor: Editor;
	markdownView: MarkdownView;
	file: TFile;
	from: EditorPosition;
	to: EditorPosition;
	fromOffset: number;
	toOffset: number;
	text: string;
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
	noteTitle: string;
	mode: InlineEditActionMode;
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
		options.plugin.registerDomEvent(document, "pointerup", () => this.scheduleSelectionToolbar());
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
			for (const action of INLINE_EDIT_ACTIONS) {
				const button = this.selectionToolbarEl.createEl("button", {
					cls: "hermes-inline-toolbar-button",
					text: action.shortLabel,
					attr: { type: "button", title: action.description }
				});
				button.addEventListener("mousedown", (event) => event.preventDefault());
				button.addEventListener("click", () => void this.runSelectionAction(action.id));
			}
		}

		const rect = context.view.coordsAtPos(context.toOffset, 1) ?? context.view.coordsAtPos(context.fromOffset, -1);
		if (!rect) {
			this.hideSelectionToolbar();
			return;
		}
		this.selectionToolbarEl.style.left = `${Math.max(12, rect.left - 48)}px`;
		this.selectionToolbarEl.style.top = `${Math.max(12, rect.top - 52)}px`;
		this.selectionToolbarEl.addClass("is-visible");
	}

	private hideSelectionToolbar(): void {
		this.selectionToolbarEl?.remove();
		this.selectionToolbarEl = null;
	}

	private getSelectionContext(): InlineEditSelectionContext | null {
		const markdownView = this.options.app.workspace.getActiveViewOfType(MarkdownView);
		if (!markdownView || markdownView.getMode() !== "source" || !markdownView.file) {
			return null;
		}
		const editor = markdownView.editor;
		const selections = editor.listSelections();
		if (selections.length !== 1) {
			if (selections.length > 1) {
				this.noticeMultipleSelections();
			}
			return null;
		}
		if (!isContinuousSelection(selections)) {
			return null;
		}
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
		if (!view) {
			return null;
		}
		return {
			view,
			editor,
			markdownView,
			file: markdownView.file,
			from,
			to,
			fromOffset: editor.posToOffset(from),
			toOffset: editor.posToOffset(to),
			text
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
			noteText: context.editor.getValue(),
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
			noteText,
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
			originalText: context.targetText,
			proposedText: "",
			status: "generating",
			requestId
		};
		this.currentView = view;
		this.currentContext = context;
		this.currentDraft = draft;
		this.pushDraftToView();

		const settings = this.options.getSettings();
		const prompt = buildInlineEditPrompt({
			action: context.action,
			targetText: context.action.mode === "note" ? "" : context.targetText,
			noteText: context.action.mode === "note" ? context.noteText : undefined,
			noteTitle: context.noteTitle,
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
