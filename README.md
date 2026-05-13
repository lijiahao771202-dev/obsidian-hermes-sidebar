# Hermes Sidebar for Obsidian

A desktop-only Obsidian plugin that opens a Hermes chat sidebar and can attach the current selection or current note as turn context.

## What works in this MVP

- Right sidebar Hermes chat view
- Reuses a single Hermes session with `--resume`
- Attach current selection
- Attach current note content
- Insert the last assistant reply into the current note
- Configure Hermes binary, provider, model, reasoning effort, PATH prefix, and system prompt

## Local build

```bash
npm install
npm run build
```

## Install into Obsidian

Copy these files into your vault plugin folder:

- `main.js`
- `manifest.json`
- `styles.css`
- `versions.json`

Suggested destination:

```text
<your-vault>/.obsidian/plugins/hermes-sidebar/
```

Then enable **Hermes Sidebar** in Obsidian Community Plugins.

## Notes

- This plugin is desktop only because it shells out to a local Hermes install.
- By default it expects Hermes to be available on PATH, with an added prefix for:
  - `/Users/lijiahao/.hermes/hermes-agent/venv/bin`
  - `/Users/lijiahao/.local/bin`
- The plugin strips Hermes reasoning box text and keeps the visible reply body.
