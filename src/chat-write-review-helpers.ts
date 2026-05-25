export interface ChatWriteReviewRequestLike {
	filePath?: string;
	diff?: string;
}

export interface ChatWriteSnapshot {
	path: string;
	content: string | null;
}

export interface ChatWriteAppliedReviewInput extends ChatWriteReviewRequestLike {
	requestId?: string;
	toolName?: string;
	title?: string;
	meta?: string;
	snapshots?: ChatWriteSnapshot[];
}

export interface ChatWriteAppliedReview {
	requestId: string;
	title?: string;
	meta?: string;
	filePath?: string;
	diff: string;
	snapshots: ChatWriteSnapshot[];
	status: "pending" | "accepted" | "reverted" | "error";
}

export interface ChatWriteReviewDeletion {
	fromLine: number;
	toLine: number;
}

export interface ChatWriteReviewAddition {
	afterLine: number;
	lines: string[];
}

export interface ChatWriteReviewInlinePreview {
	filePath: string;
	firstLine: number;
	deletions: ChatWriteReviewDeletion[];
	additions: ChatWriteReviewAddition[];
}

export interface ChatWriteReviewVisibleAddition {
	afterLine: number;
	lines: string[];
	visibleLines: string[];
	activeLineIndex: number | null;
	isActive: boolean;
	isComplete: boolean;
}

export interface ChatWriteReviewStreamFrame {
	additions: ChatWriteReviewVisibleAddition[];
	activeAdditionIndex: number | null;
	activeLineIndex: number | null;
	activeDocumentLine: number | null;
	visibleCharacters: number;
	totalCharacters: number;
	isComplete: boolean;
}

export interface ChatWriteReviewDocumentFrame {
	text: string;
	activeOffset: number;
	visibleCharacters: number;
	totalCharacters: number;
	isComplete: boolean;
}

export interface ChatWriteReviewRenderedPreview {
	text: string;
	isPartial: boolean;
}

export interface ChatWriteReviewFileSummary {
	path: string;
	oldPath?: string;
	newPath?: string;
	kind: "created" | "deleted" | "modified";
	additions: string[];
	removals: string[];
}

export interface ChatWriteReviewFileLabel {
	title: string;
	detail?: string;
}

export interface ChatWriteReviewLineDisplay {
	title: string;
	detail?: string;
}

export interface ChatWriteReviewDiffFile extends ChatWriteReviewFileSummary {
	diff: string;
}

export interface ChatWriteReviewOverview {
	fileCount: number;
	additions: number;
	removals: number;
	visibleFiles: ChatWriteReviewFileSummary[];
	hiddenFiles: ChatWriteReviewFileSummary[];
}

export interface ChatWriteReviewDiffSection {
	type: "add" | "remove";
	text: string;
}

export function buildChatWriteAppliedReview(input: ChatWriteAppliedReviewInput): ChatWriteAppliedReview | null {
	const requestId = input.requestId?.trim();
	const diff = input.diff?.trim() ?? "";
	if (!requestId || !diff) {
		return null;
	}
	return {
		requestId,
		title: input.title?.trim() || undefined,
		meta: input.meta?.trim() || undefined,
		filePath: normalizeReviewPath(input.filePath) || input.filePath?.trim() || undefined,
		diff,
		snapshots: mergeChatWriteReviewSnapshots(input.snapshots),
		status: "pending"
	};
}

export function mergeChatWriteReviewSnapshots(
	...groups: Array<ChatWriteSnapshot[] | undefined>
): ChatWriteSnapshot[] {
	const result: ChatWriteSnapshot[] = [];
	const seen = new Set<string>();
	for (const group of groups) {
		for (const snapshot of group ?? []) {
			const path = normalizeReviewPath(snapshot.path);
			if (!path || seen.has(path)) {
				continue;
			}
			seen.add(path);
			result.push({
				path,
				content: typeof snapshot.content === "string" ? snapshot.content : null
			});
		}
	}
	return result;
}

export function buildChatWriteReviewInlinePreview(
	review: ChatWriteReviewRequestLike
): ChatWriteReviewInlinePreview | null {
	const filePath = normalizeReviewPath(review.filePath);
	const diff = review.diff?.trim() ?? "";
	if (!filePath || !filePath.toLowerCase().endsWith(".md") || !diff || filePath.includes(",")) {
		return null;
	}

	const deletions: ChatWriteReviewDeletion[] = [];
	const additions: ChatWriteReviewAddition[] = [];
	let oldLine = 0;
	let firstLine: number | null = null;
	let pendingAddition: ChatWriteReviewAddition | null = null;
	let pendingDeletion: ChatWriteReviewDeletion | null = null;
	let sawHunk = false;

	const flushAddition = () => {
		if (pendingAddition && pendingAddition.lines.length > 0) {
			additions.push(pendingAddition);
		}
		pendingAddition = null;
	};
	const flushDeletion = () => {
		if (pendingDeletion) {
			deletions.push(pendingDeletion);
		}
		pendingDeletion = null;
	};

	for (const line of diff.split("\n")) {
		const hunk = /^@@\s+-(\d+)(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/.exec(line);
		if (hunk) {
			flushAddition();
			flushDeletion();
			sawHunk = true;
			oldLine = Math.max(0, Number(hunk[1]) - 1);
			firstLine ??= oldLine;
			continue;
		}

		if (!sawHunk || line.startsWith("---") || line.startsWith("+++")) {
			continue;
		}

		if (line.startsWith("+")) {
			flushDeletion();
			const afterLine = Math.max(-1, oldLine - 1);
			if (!pendingAddition || pendingAddition.afterLine !== afterLine) {
				flushAddition();
				pendingAddition = { afterLine, lines: [] };
			}
			pendingAddition.lines.push(line.slice(1));
			continue;
		}

		if (line.startsWith("-")) {
			flushAddition();
			if (pendingDeletion && pendingDeletion.toLine === oldLine - 1) {
				pendingDeletion.toLine = oldLine;
			} else {
				flushDeletion();
				pendingDeletion = { fromLine: oldLine, toLine: oldLine };
			}
			oldLine += 1;
			continue;
		}

		flushAddition();
		flushDeletion();
		if (line.startsWith(" ")) {
			oldLine += 1;
		}
	}

	flushAddition();
	flushDeletion();

	if (!sawHunk || (deletions.length === 0 && additions.length === 0)) {
		return null;
	}

	return {
		filePath,
		firstLine: firstLine ?? 0,
		deletions,
		additions
	};
}

export function summarizeChatWriteReviewFiles(review: ChatWriteReviewRequestLike): ChatWriteReviewFileSummary[] {
	return collectChatWriteReviewDiffFiles(review).map(({ diff: _diff, ...file }) => file);
}

export function splitChatWriteReviewDiffFiles(review: ChatWriteReviewRequestLike): ChatWriteReviewDiffFile[] {
	return collectChatWriteReviewDiffFiles(review);
}

export function buildChatWriteReviewOverview(
	review: ChatWriteReviewRequestLike,
	visibleFileLimit = 3
): ChatWriteReviewOverview {
	const files = summarizeChatWriteReviewFiles(review);
	const safeLimit = Math.max(1, visibleFileLimit);
	return {
		fileCount: files.length,
		additions: files.reduce((total, file) => total + file.additions.length, 0),
		removals: files.reduce((total, file) => total + file.removals.length, 0),
		visibleFiles: files.slice(0, safeLimit),
		hiddenFiles: files.slice(safeLimit)
	};
}

export function formatChatWriteReviewFileLabel(path: string): ChatWriteReviewFileLabel {
	const normalizedPath = normalizeReviewPath(path).replace(/\/+$/, "");
	if (!normalizedPath) {
		return { title: "未命名文章" };
	}

	const segments = normalizedPath.split("/").filter(Boolean);
	const filename = segments[segments.length - 1] ?? normalizedPath;
	const title = filename.replace(/\.md$/i, "") || filename || "未命名文章";
	if (segments.length <= 1) {
		return { title };
	}

	const tailCount = Math.min(3, segments.length);
	const tailPath = segments.slice(-tailCount).join("/");
	const detail = segments.length > tailCount ? `.../${tailPath}` : tailPath;
	return { title, detail: detail !== title ? detail : undefined };
}

export function formatChatWriteReviewLineDisplay(path: string): ChatWriteReviewLineDisplay {
	const label = formatChatWriteReviewFileLabel(path);
	return {
		title: label.title,
		detail: label.detail
	};
}

export function extractChatWriteReviewDiffSections(diff: string): ChatWriteReviewDiffSection[] {
	return extractAppliedInlineReviewSections(diff);
}

export function resolveChatWriteReviewTargetPath(
	reviewFilePath: string | undefined,
	vaultFilePaths: string[],
	vaultRootPath?: string
): string | null {
	const normalizedReviewPath = normalizeReviewPath(reviewFilePath);
	if (!normalizedReviewPath) {
		return null;
	}

	if (vaultFilePaths.includes(normalizedReviewPath)) {
		return normalizedReviewPath;
	}

	const normalizedVaultRoot = normalizeReviewPath(vaultRootPath).replace(/\/+$/, "");
	if (normalizedVaultRoot && normalizedReviewPath.startsWith(`${normalizedVaultRoot}/`)) {
		const vaultRelativePath = normalizedReviewPath.slice(normalizedVaultRoot.length + 1);
		if (vaultFilePaths.includes(vaultRelativePath)) {
			return vaultRelativePath;
		}
	}

	const matches = vaultFilePaths
		.filter((path) => path.toLowerCase().endsWith(".md"))
		.filter((path) => path.includes("/"))
		.filter((path) => normalizedReviewPath.endsWith(`/${path}`));
	if (matches.length !== 1) {
		return null;
	}
	return matches[0];
}

export function listChatWriteReviewMarkdownTargets(
	review: ChatWriteReviewRequestLike,
	vaultFilePaths: string[],
	vaultRootPath?: string
): string[] {
	const candidates = [review.filePath, ...parseDiffTargetPaths(review.diff)];
	const resolvedTargets: string[] = [];
	const seen = new Set<string>();

	for (const candidate of candidates) {
		const normalized = normalizeReviewPath(candidate);
		if (!normalized || normalized.includes(",") || !normalized.toLowerCase().endsWith(".md") || seen.has(normalized)) {
			continue;
		}
		seen.add(normalized);
		const resolved = resolveChatWriteReviewTargetPath(normalized, vaultFilePaths, vaultRootPath);
		resolvedTargets.push(resolved ?? relativizeReviewPathToVault(normalized, vaultRootPath) ?? normalized);
	}

	return resolvedTargets.filter((path, index, source) => source.indexOf(path) === index);
}

export function shouldAutoRevealWriteReviewTarget(
	reviewFilePath: string | undefined,
	resolvedTargetPath: string | null
): boolean {
	const normalizedReviewPath = normalizeReviewPath(reviewFilePath);
	return normalizedReviewPath.toLowerCase().endsWith(".md") && !resolvedTargetPath;
}

export function buildChatWriteReviewAdditionMarkdown(addition: ChatWriteReviewAddition): string {
	return addition.lines.join("\n");
}

export function buildChatWriteReviewRenderedMarkdownPreview(
	preview: ChatWriteReviewInlinePreview,
	visibleCharacters?: number
): ChatWriteReviewRenderedPreview {
	const additions = typeof visibleCharacters === "number" ? buildChatWriteReviewStreamFrame(preview, visibleCharacters).additions : null;
	const lines = (additions ?? preview.additions)
		.flatMap((addition) => ("visibleLines" in addition ? addition.visibleLines : addition.lines))
		.filter((line, index, source) => !(line === "" && source[index - 1] === "" && source[index + 1] === ""));
	const text = lines.join("\n").trim();
	return {
		text,
		isPartial: typeof visibleCharacters === "number" && visibleCharacters < getChatWriteReviewTotalAddedCharacters(preview)
	};
}

export function getChatWriteReviewTotalAddedCharacters(preview: ChatWriteReviewInlinePreview): number {
	return preview.additions.reduce((total, addition) => total + buildChatWriteReviewAdditionMarkdown(addition).length, 0);
}

export function advanceChatWriteReviewVisibleCharacters(
	preview: ChatWriteReviewInlinePreview,
	currentVisibleCharacters: number,
	stepCharacters: number
): number {
	const totalCharacters = getChatWriteReviewTotalAddedCharacters(preview);
	if (totalCharacters <= 0) {
		return 0;
	}
	const safeCurrent = Math.max(0, currentVisibleCharacters);
	const safeStep = Math.max(1, stepCharacters);
	return Math.min(totalCharacters, safeCurrent + safeStep);
}

export function buildChatWriteReviewStreamFrame(
	preview: ChatWriteReviewInlinePreview,
	visibleCharacters: number
): ChatWriteReviewStreamFrame {
	const totalCharacters = getChatWriteReviewTotalAddedCharacters(preview);
	const clampedVisibleCharacters = Math.max(0, Math.min(totalCharacters, visibleCharacters));
	const additions: ChatWriteReviewVisibleAddition[] = [];
	let remainingCharacters = clampedVisibleCharacters;
	let activeAdditionIndex: number | null = null;
	let activeLineIndex: number | null = null;
	let activeDocumentLine: number | null = null;

	preview.additions.forEach((addition, additionIndex) => {
		const additionText = buildChatWriteReviewAdditionMarkdown(addition);
		const visibleText = additionText.slice(0, remainingCharacters);
		const isComplete = remainingCharacters >= additionText.length;
		const visibleLines = visibleText.length > 0 ? visibleText.split("\n") : [];
		const nextAddition: ChatWriteReviewVisibleAddition = {
			afterLine: addition.afterLine,
			lines: addition.lines,
			visibleLines,
			activeLineIndex: null,
			isActive: false,
			isComplete
		};

		if (!isComplete && visibleText.length > 0 && activeAdditionIndex === null) {
			nextAddition.isActive = true;
			nextAddition.activeLineIndex = visibleLines.length - 1;
			activeAdditionIndex = additionIndex;
			activeLineIndex = nextAddition.activeLineIndex;
			activeDocumentLine = addition.afterLine + 1 + nextAddition.activeLineIndex;
		}

		additions.push(nextAddition);
		remainingCharacters = Math.max(0, remainingCharacters - additionText.length);
	});

	const isComplete = clampedVisibleCharacters >= totalCharacters;
	if (!isComplete && activeAdditionIndex === null && preview.additions.length > 0) {
		activeAdditionIndex = 0;
		activeLineIndex = 0;
		activeDocumentLine = preview.additions[0].afterLine + 1;
		additions[0].isActive = true;
		additions[0].activeLineIndex = 0;
	}

	return {
		additions,
		activeAdditionIndex,
		activeLineIndex,
		activeDocumentLine,
		visibleCharacters: clampedVisibleCharacters,
		totalCharacters,
		isComplete
	};
}

export function buildChatWriteReviewDocumentFrame(
	preview: ChatWriteReviewInlinePreview,
	originalText: string,
	visibleCharacters: number
): ChatWriteReviewDocumentFrame {
	const streamFrame = buildChatWriteReviewStreamFrame(preview, visibleCharacters);
	const originalLines = originalText.split("\n");
	const additionsByAfterLine = new Map<number, ChatWriteReviewVisibleAddition[]>();
	for (const addition of streamFrame.additions) {
		const existing = additionsByAfterLine.get(addition.afterLine) ?? [];
		existing.push(addition);
		additionsByAfterLine.set(addition.afterLine, existing);
	}
	const deletedLines = new Set<number>();
	for (const deletion of preview.deletions) {
		for (let lineIndex = deletion.fromLine; lineIndex <= deletion.toLine; lineIndex += 1) {
			deletedLines.add(lineIndex);
		}
	}

	const outputLines: string[] = [];
	let activeOutputLine = 0;
	const pushAdditions = (afterLine: number) => {
		for (const addition of additionsByAfterLine.get(afterLine) ?? []) {
			const lineStart = outputLines.length;
			outputLines.push(...addition.visibleLines);
			if (addition.isActive && addition.visibleLines.length > 0) {
				activeOutputLine = lineStart + Math.max(0, addition.activeLineIndex ?? addition.visibleLines.length - 1);
			}
		}
	};

	pushAdditions(-1);
	for (let lineIndex = 0; lineIndex < originalLines.length; lineIndex += 1) {
		if (!deletedLines.has(lineIndex)) {
			outputLines.push(originalLines[lineIndex]);
		}
		pushAdditions(lineIndex);
	}

	const text = outputLines.join("\n");
	const safeActiveLine = Math.max(0, Math.min(outputLines.length - 1, activeOutputLine));
	const activeOffset =
		outputLines.length === 0
			? 0
			: outputLines.slice(0, safeActiveLine).join("\n").length +
				(safeActiveLine > 0 ? 1 : 0) +
				(outputLines[safeActiveLine]?.length ?? 0);
	return {
		text,
		activeOffset: Math.max(0, Math.min(text.length, activeOffset)),
		visibleCharacters: streamFrame.visibleCharacters,
		totalCharacters: streamFrame.totalCharacters,
		isComplete: streamFrame.isComplete
	};
}

function normalizeReviewPath(path?: string): string {
	return (path ?? "").trim().replace(/\\/g, "/");
}

function extractAppliedInlineReviewSections(diff: string): Array<{ type: "add" | "remove"; text: string }> {
	const sections: Array<{ type: "add" | "remove"; text: string }> = [];
	let currentType: "add" | "remove" | null = null;
	let currentLines: string[] = [];
	const flush = () => {
		if (!currentType) {
			return;
		}
		sections.push({ type: currentType, text: currentLines.join("\n") });
		currentType = null;
		currentLines = [];
	};
	const append = (type: "add" | "remove", text: string) => {
		if (currentType !== type) {
			flush();
			currentType = type;
		}
		currentLines.push(text);
	};

	for (const line of diff.split("\n")) {
		if (!line || line.startsWith("@@") || line.startsWith("diff --git") || line.startsWith("index ")) {
			flush();
			continue;
		}
		if (line.startsWith("+++") || line.startsWith("---")) {
			flush();
			continue;
		}
		if (line.startsWith("+")) {
			append("add", line.slice(1));
			continue;
		}
		if (line.startsWith("-")) {
			append("remove", line.slice(1));
			continue;
		}
		flush();
	}
	flush();
	return sections.filter((section) => section.text.length > 0);
}

function collectChatWriteReviewDiffFiles(review: ChatWriteReviewRequestLike): ChatWriteReviewDiffFile[] {
	const diff = review.diff?.trim() ?? "";
	if (!diff) {
		return [];
	}

	const files: ChatWriteReviewDiffFile[] = [];
	let current: ChatWriteReviewDiffFile & { diffLines: string[] } | null = null;

	const normalizeDiffPath = (path: string): string => {
		const trimmed = normalizeReviewPath(path);
		if (!trimmed || trimmed === "/dev/null") {
			return "";
		}
		return trimmed.replace(/^[ab]\//, "");
	};
	const ensureCurrent = (): ChatWriteReviewDiffFile & { diffLines: string[] } => {
		if (!current) {
			current = {
				path: normalizeReviewPath(review.filePath) || "未命名写入",
				kind: "modified",
				additions: [],
				removals: [],
				diff: "",
				diffLines: []
			};
		}
		return current;
	};
	const finish = () => {
		if (!current) {
			return;
		}
		const oldPath = current.oldPath ?? "";
		const newPath = current.newPath ?? "";
		current.path = newPath || oldPath || current.path;
		current.kind = oldPath && !newPath ? "deleted" : !oldPath && newPath ? "created" : "modified";
		current.diff = current.diffLines.join("\n").trim();
		const output: ChatWriteReviewDiffFile = {
			path: current.path,
			kind: current.kind,
			additions: [...current.additions],
			removals: [...current.removals],
			diff: current.diff
		};
		if (current.oldPath) {
			output.oldPath = current.oldPath;
		}
		if (current.newPath) {
			output.newPath = current.newPath;
		}
		files.push(output);
		current = null;
	};

	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git ")) {
			finish();
			current = {
				path: normalizeReviewPath(review.filePath) || "未命名写入",
				kind: "modified",
				additions: [],
				removals: [],
				diff: line,
				diffLines: [line]
			};
			continue;
		}
		if (
			line.startsWith("--- ") &&
			current &&
			Object.prototype.hasOwnProperty.call(current, "oldPath") &&
			Object.prototype.hasOwnProperty.call(current, "newPath")
		) {
			finish();
		}
		const next = ensureCurrent();
		next.diffLines.push(line);
		if (line.startsWith("--- ")) {
			next.oldPath = normalizeDiffPath(line.slice(4));
			continue;
		}
		if (line.startsWith("+++ ")) {
			next.newPath = normalizeDiffPath(line.slice(4));
			continue;
		}
		if (!line || line.startsWith("@@") || line.startsWith("index ")) {
			continue;
		}
		if (line.startsWith("+")) {
			next.additions.push(line.slice(1));
			continue;
		}
		if (line.startsWith("-")) {
			next.removals.push(line.slice(1));
		}
	}
	finish();

	if (files.length > 0) {
		return mergeChatWriteReviewDiffFilesByPath(files);
	}

	const fallbackSections = extractAppliedInlineReviewSections(diff);
	return [
		{
			path: normalizeReviewPath(review.filePath) || "未命名写入",
			kind: "modified",
			additions: fallbackSections.filter((section) => section.type === "add").flatMap((section) => section.text.split("\n")),
			removals: fallbackSections.filter((section) => section.type === "remove").flatMap((section) => section.text.split("\n")),
			diff
		}
	];
}

function mergeChatWriteReviewDiffFilesByPath(files: ChatWriteReviewDiffFile[]): ChatWriteReviewDiffFile[] {
	const merged: ChatWriteReviewDiffFile[] = [];
	const indexByPath = new Map<string, number>();

	for (const file of files) {
		const existingIndex = indexByPath.get(file.path);
		if (existingIndex === undefined) {
			merged.push({ ...file });
			indexByPath.set(file.path, merged.length - 1);
			continue;
		}

		const existing = merged[existingIndex];
		const existingStartedMissing = !Object.prototype.hasOwnProperty.call(existing, "oldPath");
		const nextEndsMissing = file.kind === "deleted";
		const mergedOldPath = existingStartedMissing ? undefined : existing.oldPath;
		const mergedNewPath = nextEndsMissing
			? undefined
			: Object.prototype.hasOwnProperty.call(file, "newPath")
				? file.newPath
				: existing.newPath;
		const mergedKind = deriveMergedChatWriteReviewFileKind(mergedOldPath, mergedNewPath, file.kind);
		const nextPath = mergedNewPath || mergedOldPath || file.path || existing.path;
		const next: ChatWriteReviewDiffFile = {
			path: nextPath,
			kind: mergedKind,
			additions: [...existing.additions, ...file.additions],
			removals: [...existing.removals, ...file.removals],
			diff: [existing.diff, file.diff].filter(Boolean).join("\n\n")
		};
		if (mergedOldPath) {
			next.oldPath = mergedOldPath;
		}
		if (mergedNewPath) {
			next.newPath = mergedNewPath;
		}
		merged[existingIndex] = next;
	}

	return merged;
}

function deriveMergedChatWriteReviewFileKind(
	oldPath: string | undefined,
	newPath: string | undefined,
	fallback: ChatWriteReviewDiffFile["kind"]
): ChatWriteReviewDiffFile["kind"] {
	if (oldPath && !newPath) {
		return "deleted";
	}
	if (!oldPath && newPath) {
		return "created";
	}
	if (oldPath || newPath) {
		return "modified";
	}
	return fallback;
}

function parseDiffTargetPaths(diff?: string): string[] {
	const targets: string[] = [];
	const seen = new Set<string>();
	for (const line of String(diff ?? "").split("\n")) {
		const match = /^\+\+\+\s+(?:b\/)?(.+)$/.exec(line.trim());
		if (!match) {
			continue;
		}
		const candidate = normalizeReviewPath(match[1]);
		if (!candidate || candidate === "/dev/null" || seen.has(candidate)) {
			continue;
		}
		seen.add(candidate);
		targets.push(candidate);
	}
	return targets;
}

function normalizeChatWriteSnapshots(snapshots?: ChatWriteSnapshot[]): ChatWriteSnapshot[] {
	return mergeChatWriteReviewSnapshots(snapshots);
}

function relativizeReviewPathToVault(reviewPath: string, vaultRootPath?: string): string | null {
	const normalizedVaultRoot = normalizeReviewPath(vaultRootPath).replace(/\/+$/, "");
	if (!normalizedVaultRoot || !reviewPath.startsWith(`${normalizedVaultRoot}/`)) {
		return null;
	}
	return reviewPath.slice(normalizedVaultRoot.length + 1);
}
