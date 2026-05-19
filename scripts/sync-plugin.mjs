import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(repoRoot, "manifest.json"), "utf8"));
const pluginId = manifest.id;

const REQUIRED_FILES = [
	"main.js",
	"manifest.json",
	"styles.css",
	"versions.json",
	"hermes_bridge.py",
	"hermes-avatar.png"
];

function collectBuildInputs(directory) {
	if (!existsSync(directory)) {
		return [];
	}

	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const fullPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectBuildInputs(fullPath));
			continue;
		}

		if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
			continue;
		}

		files.push(fullPath);
	}

	return files;
}

function ensureBuiltPluginIsFresh() {
	const buildOutput = join(repoRoot, "main.js");
	const buildInputs = [
		join(repoRoot, "esbuild.config.mjs"),
		join(repoRoot, "tsconfig.json"),
		...collectBuildInputs(join(repoRoot, "src"))
	];

	const buildOutputMtime = existsSync(buildOutput) ? statSync(buildOutput).mtimeMs : 0;
	const latestInputMtime = Math.max(...buildInputs.map((filePath) => statSync(filePath).mtimeMs), 0);

	if (buildOutputMtime >= latestInputMtime) {
		return;
	}

	console.log("Detected newer source files than main.js. Running npm run build before sync...");
	const result = spawnSync("npm", ["run", "build"], {
		cwd: repoRoot,
		stdio: "inherit",
		shell: process.platform === "win32"
	});

	if (result.status !== 0) {
		throw new Error(`Build failed with exit code ${result.status ?? "unknown"}.`);
	}
}

function expandHome(path) {
	return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function findPluginDirs(baseDir, pluginIdToFind) {
	if (!existsSync(baseDir)) {
		return [];
	}
	const matches = [];
	for (const vaultName of readdirSync(baseDir, { withFileTypes: true })) {
		if (!vaultName.isDirectory()) {
			continue;
		}
		const pluginDir = join(baseDir, vaultName.name, ".obsidian", "plugins", pluginIdToFind);
		if (existsSync(pluginDir)) {
			matches.push(pluginDir);
		}
	}
	return matches;
}

function detectPluginDir() {
	const envPluginDir = process.env.OBSIDIAN_PLUGIN_DIR;
	if (envPluginDir) {
		return resolve(expandHome(envPluginDir));
	}

	const envVaultDir = process.env.OBSIDIAN_VAULT_DIR;
	if (envVaultDir) {
		return resolve(expandHome(envVaultDir), ".obsidian", "plugins", pluginId);
	}

	const commonRoots = [
		join(homedir(), "Library", "Mobile Documents", "iCloud~md~obsidian", "Documents"),
		join(homedir(), "Documents")
	];

	const matches = commonRoots.flatMap((root) => findPluginDirs(root, pluginId));
	if (matches.length === 1) {
		return matches[0];
	}
	if (matches.length > 1) {
		throw new Error(
			`Found multiple ${pluginId} plugin directories. Set OBSIDIAN_PLUGIN_DIR explicitly.\n${matches.join("\n")}`
		);
	}

	throw new Error(
		`Could not find an Obsidian plugin directory for ${pluginId}. Set OBSIDIAN_PLUGIN_DIR or OBSIDIAN_VAULT_DIR.`
	);
}

function syncPlugin() {
	ensureBuiltPluginIsFresh();

	const targetDir = detectPluginDir();
	mkdirSync(targetDir, { recursive: true });

	for (const relativePath of REQUIRED_FILES) {
		const sourcePath = join(repoRoot, relativePath);
		if (!existsSync(sourcePath)) {
			throw new Error(`Missing required file: ${sourcePath}`);
		}
		copyFileSync(sourcePath, join(targetDir, relativePath));
	}

	console.log(`Synced ${pluginId} to ${targetDir}`);
}

syncPlugin();
