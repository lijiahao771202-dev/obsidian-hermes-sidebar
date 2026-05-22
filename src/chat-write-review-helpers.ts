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
		snapshots: normalizeChatWriteSnapshots(input.snapshots),
		status: "pending"
	};
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
	const result: ChatWriteSnapshot[] = [];
	const seen = new Set<string>();
	for (const snapshot of snapshots ?? []) {
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
	return result;
}

function relativizeReviewPathToVault(reviewPath: string, vaultRootPath?: string): string | null {
	const normalizedVaultRoot = normalizeReviewPath(vaultRootPath).replace(/\/+$/, "");
	if (!normalizedVaultRoot || !reviewPath.startsWith(`${normalizedVaultRoot}/`)) {
		return null;
	}
	return reviewPath.slice(normalizedVaultRoot.length + 1);
}
