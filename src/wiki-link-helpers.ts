interface MissingWikiLinkTargetInput {
	markdown: string;
	sourcePath: string;
	resolveExisting: (linkpath: string) => boolean;
	pickParentFolder: (sourcePath: string, newFilePath?: string) => string;
}

export interface MissingWikiLinkTarget {
	linkpath: string;
	filePath: string;
	title: string;
}

export interface WikiResolverFile {
	path: string;
	basename: string;
	aliases?: string[];
}

export interface ResolvedWikiLinkTarget {
	path: string;
	title: string;
	matchedBy: "path-exact" | "title-exact" | "alias-exact" | "title-prefix" | "alias-prefix";
}

interface ParsedWikiLinkTarget {
	linkpath: string;
	subpath: string;
	title: string;
	alias: string;
}

export interface RewriteWikiLinkInput {
	markdown: string;
	resolveReplacement: (target: { linkpath: string; subpath: string; title: string; alias: string }) => string | null;
}

export interface RewriteWikiLinkResult {
	markdown: string;
	rewrites: Array<{
		from: string;
		to: string;
	}>;
}

const CODE_FENCE_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`\n]*`/g;
const WIKI_LINK_PATTERN = /(!)?\[\[([^[\]]+)\]\]/g;
const ATTACHMENT_EXTENSIONS = new Set([
	".avif",
	".bmp",
	".canvas",
	".gif",
	".jpeg",
	".jpg",
	".m4a",
	".mdx",
	".mov",
	".mp3",
	".mp4",
	".pdf",
	".png",
	".svg",
	".wav",
	".webm",
	".webp"
]);

function stripCodeBlocks(markdown: string): string {
	return markdown.replace(CODE_FENCE_PATTERN, "").replace(INLINE_CODE_PATTERN, "");
}

function normalizeSlashes(value: string): string {
	return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

function normalizeComparableText(value: string): string {
	return value
		.normalize("NFKC")
		.trim()
		.replace(/\.md$/i, "")
		.replace(/\s+/g, " ")
		.toLowerCase();
}

function parseWikiLinkTarget(rawTarget: string): ParsedWikiLinkTarget | null {
	const trimmed = rawTarget.trim();
	if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("^")) {
		return null;
	}

	const aliasIndex = trimmed.indexOf("|");
	const targetWithSubpath = aliasIndex >= 0 ? trimmed.slice(0, aliasIndex) : trimmed;
	const alias = aliasIndex >= 0 ? trimmed.slice(aliasIndex + 1).trim() : "";
	const headingIndex = targetWithSubpath.search(/[#^]/);
	const linkpath = normalizeSlashes(headingIndex >= 0 ? targetWithSubpath.slice(0, headingIndex) : targetWithSubpath);
	const subpath = headingIndex >= 0 ? targetWithSubpath.slice(headingIndex).trim() : "";
	if (!linkpath) {
		return null;
	}

	const lastSegment = linkpath.split("/").pop() ?? linkpath;
	const title = lastSegment.replace(/\.md$/i, "").trim();
	if (!title) {
		return null;
	}

	return {
		linkpath,
		subpath,
		alias,
		title
	};
}

function looksLikeAttachment(linkpath: string): boolean {
	const lower = linkpath.toLowerCase();
	const extensionMatch = /\.[^./]+$/.exec(lower);
	if (!extensionMatch) {
		return false;
	}
	const extension = extensionMatch[0];
	return extension !== ".md" && ATTACHMENT_EXTENSIONS.has(extension);
}

function buildMissingTargetPath(
	linkpath: string,
	sourcePath: string,
	pickParentFolder: (sourcePath: string, newFilePath?: string) => string
): string {
	if (linkpath.toLowerCase().endsWith(".md")) {
		return normalizeSlashes(linkpath);
	}
	if (linkpath.includes("/")) {
		return normalizeSlashes(`${linkpath}.md`);
	}
	const parentFolder = normalizeSlashes(pickParentFolder(sourcePath, `${linkpath}.md`) || "");
	return normalizeSlashes(parentFolder ? `${parentFolder}/${linkpath}.md` : `${linkpath}.md`);
}

function findUniqueMatch(
	files: WikiResolverFile[],
	predicate: (file: WikiResolverFile) => boolean
): WikiResolverFile | null {
	const matches = files.filter(predicate);
	return matches.length === 1 ? matches[0] : null;
}

function getComparablePath(value: string): string {
	return normalizeComparableText(normalizeSlashes(value));
}

function getComparableTitle(value: string): string {
	const normalized = normalizeSlashes(value);
	const lastSegment = normalized.split("/").pop() ?? normalized;
	return normalizeComparableText(lastSegment);
}

function getComparableAliases(file: WikiResolverFile): string[] {
	return (file.aliases ?? [])
		.map((alias) => normalizeComparableText(alias))
		.filter(Boolean);
}

function buildResolvedTarget(file: WikiResolverFile, matchedBy: ResolvedWikiLinkTarget["matchedBy"]): ResolvedWikiLinkTarget {
	return {
		path: normalizeSlashes(file.path),
		title: file.basename.trim(),
		matchedBy
	};
}

function shouldTryLooseTitleFallback(linkpath: string): boolean {
	return !normalizeSlashes(linkpath).includes("/");
}

export function resolveExistingWikiLinkTarget(input: {
	linkpath: string;
	files: WikiResolverFile[];
}): ResolvedWikiLinkTarget | null {
	const normalizedLinkpath = normalizeSlashes(String(input.linkpath || ""));
	if (!normalizedLinkpath) {
		return null;
	}

	const comparablePath = getComparablePath(normalizedLinkpath);
	const comparableTitle = getComparableTitle(normalizedLinkpath);
	const strictPathMatch = findUniqueMatch(input.files, (file) => {
		const filePath = normalizeSlashes(file.path);
		return comparablePath === getComparablePath(filePath) || comparablePath === getComparablePath(filePath.replace(/\.md$/i, ""));
	});
	if (strictPathMatch) {
		return buildResolvedTarget(strictPathMatch, "path-exact");
	}

	if (!shouldTryLooseTitleFallback(normalizedLinkpath)) {
		return null;
	}

	const exactTitleMatch = findUniqueMatch(input.files, (file) => getComparableTitle(file.basename) === comparableTitle);
	if (exactTitleMatch) {
		return buildResolvedTarget(exactTitleMatch, "title-exact");
	}

	const exactAliasMatch = findUniqueMatch(input.files, (file) => getComparableAliases(file).includes(comparableTitle));
	if (exactAliasMatch) {
		return buildResolvedTarget(exactAliasMatch, "alias-exact");
	}

	const prefixTitleMatch = findUniqueMatch(input.files, (file) => {
		const fileTitle = getComparableTitle(file.basename);
		return fileTitle.length > comparableTitle.length && fileTitle.startsWith(comparableTitle);
	});
	if (prefixTitleMatch) {
		return buildResolvedTarget(prefixTitleMatch, "title-prefix");
	}

	const prefixAliasMatch = findUniqueMatch(input.files, (file) =>
		getComparableAliases(file).some((alias) => alias.length > comparableTitle.length && alias.startsWith(comparableTitle))
	);
	if (prefixAliasMatch) {
		return buildResolvedTarget(prefixAliasMatch, "alias-prefix");
	}

	return null;
}

function collectProtectedRanges(markdown: string): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	for (const pattern of [CODE_FENCE_PATTERN, INLINE_CODE_PATTERN]) {
		pattern.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(markdown)) !== null) {
			ranges.push({
				start: match.index,
				end: match.index + match[0].length
			});
		}
	}
	ranges.sort((left, right) => left.start - right.start);
	return ranges;
}

function isInsideProtectedRange(index: number, ranges: Array<{ start: number; end: number }>): boolean {
	return ranges.some((range) => index >= range.start && index < range.end);
}

function buildReplacementWikiTarget(parsed: ParsedWikiLinkTarget, replacementLinkpath: string): string {
	const normalizedReplacement = normalizeSlashes(replacementLinkpath).replace(/\.md$/i, "");
	const targetWithSubpath = `${normalizedReplacement}${parsed.subpath}`;
	const needsAlias = normalizeComparableText(normalizedReplacement) !== normalizeComparableText(parsed.linkpath);
	const alias = parsed.alias || (needsAlias ? parsed.title : "");
	return `[[${targetWithSubpath}${alias ? `|${alias}` : ""}]]`;
}

export function rewriteWikiLinksToResolvedTargets(input: RewriteWikiLinkInput): RewriteWikiLinkResult {
	const protectedRanges = collectProtectedRanges(String(input.markdown || ""));
	const rewrites: RewriteWikiLinkResult["rewrites"] = [];
	const replacements: Array<{ start: number; end: number; value: string }> = [];

	for (const match of String(input.markdown || "").matchAll(WIKI_LINK_PATTERN)) {
		if (match[1] || typeof match.index !== "number" || isInsideProtectedRange(match.index, protectedRanges)) {
			continue;
		}
		const parsed = parseWikiLinkTarget(match[2] || "");
		if (!parsed || looksLikeAttachment(parsed.linkpath)) {
			continue;
		}
		const replacementLinkpath = input.resolveReplacement({
			linkpath: parsed.linkpath,
			subpath: parsed.subpath,
			title: parsed.title,
			alias: parsed.alias
		});
		if (!replacementLinkpath) {
			continue;
		}
		const replacement = buildReplacementWikiTarget(parsed, replacementLinkpath);
		if (replacement === match[0]) {
			continue;
		}
		replacements.push({
			start: match.index,
			end: match.index + match[0].length,
			value: replacement
		});
		rewrites.push({
			from: match[0],
			to: replacement
		});
	}

	if (replacements.length === 0) {
		return {
			markdown: String(input.markdown || ""),
			rewrites: []
		};
	}

	let cursor = 0;
	let markdown = "";
	for (const replacement of replacements) {
		markdown += String(input.markdown || "").slice(cursor, replacement.start);
		markdown += replacement.value;
		cursor = replacement.end;
	}
	markdown += String(input.markdown || "").slice(cursor);

	return {
		markdown,
		rewrites
	};
}

export function collectMissingWikiLinkTargets(input: MissingWikiLinkTargetInput): MissingWikiLinkTarget[] {
	const sanitized = stripCodeBlocks(String(input.markdown || ""));
	const targets: MissingWikiLinkTarget[] = [];
	const seenPaths = new Set<string>();

	for (const match of sanitized.matchAll(WIKI_LINK_PATTERN)) {
		if (match[1]) {
			continue;
		}
		const parsed = parseWikiLinkTarget(match[2] || "");
		if (!parsed) {
			continue;
		}
		if (looksLikeAttachment(parsed.linkpath)) {
			continue;
		}
		if (input.resolveExisting(parsed.linkpath)) {
			continue;
		}
		const filePath = buildMissingTargetPath(parsed.linkpath, input.sourcePath, input.pickParentFolder);
		if (!filePath || seenPaths.has(filePath)) {
			continue;
		}
		seenPaths.add(filePath);
		targets.push({
			linkpath: parsed.linkpath,
			filePath,
			title: parsed.title
		});
	}

	return targets;
}
