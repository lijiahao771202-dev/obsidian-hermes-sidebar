export interface ChatWriteReviewRequestLike {
	filePath?: string;
	diff?: string;
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

export function resolveChatWriteReviewTargetPath(reviewFilePath: string | undefined, vaultFilePaths: string[]): string | null {
	const normalizedReviewPath = normalizeReviewPath(reviewFilePath);
	if (!normalizedReviewPath) {
		return null;
	}

	if (vaultFilePaths.includes(normalizedReviewPath)) {
		return normalizedReviewPath;
	}

	const matches = vaultFilePaths
		.filter((path) => path.toLowerCase().endsWith(".md") && path.includes("/"))
		.filter((path) => normalizedReviewPath.endsWith(`/${path}`));
	if (matches.length !== 1) {
		return null;
	}
	return matches[0];
}

function normalizeReviewPath(path?: string): string {
	return (path ?? "").trim().replace(/\\/g, "/");
}
