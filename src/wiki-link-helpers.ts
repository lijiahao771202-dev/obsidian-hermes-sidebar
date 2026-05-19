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

function parseWikiLinkTarget(rawTarget: string): { linkpath: string; title: string } | null {
	const trimmed = rawTarget.trim();
	if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("^")) {
		return null;
	}

	const aliasIndex = trimmed.indexOf("|");
	const targetWithSubpath = aliasIndex >= 0 ? trimmed.slice(0, aliasIndex) : trimmed;
	const headingIndex = targetWithSubpath.search(/[#^]/);
	const linkpath = normalizeSlashes(headingIndex >= 0 ? targetWithSubpath.slice(0, headingIndex) : targetWithSubpath);
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
