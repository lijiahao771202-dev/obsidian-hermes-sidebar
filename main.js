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
var import_obsidian2 = require("obsidian");
var import_state2 = require("@codemirror/state");
var import_view2 = require("@codemirror/view");
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = require("node:path");

// src/session-helpers.ts
var DEFAULT_SESSION_TITLE = "\u65B0\u5BF9\u8BDD";
function getActivityChainTailVisibleCount(messages) {
  const filtered = messages.filter(
    (message) => (message.activities ?? []).some((entry) => {
      if (!entry) {
        return false;
      }
      return shouldShowActivityEntry(entry.toolName);
    })
  );
  if (filtered.length <= 1) {
    return 1;
  }
  const latestVisibleMessage = filtered[filtered.length - 1];
  const visibleEntries = (latestVisibleMessage.activities ?? []).filter((entry) => {
    if (!entry) {
      return false;
    }
    return shouldShowActivityEntry(entry.toolName);
  });
  const latestVisibleEntry = visibleEntries.length > 0 ? visibleEntries[visibleEntries.length - 1] : null;
  return latestVisibleEntry?.toolName === "thinking" || latestVisibleEntry?.toolName === "write_trace" ? 2 : 1;
}
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
function isComposerSendShortcut(input) {
  if (input.key !== "Enter" || input.altKey) {
    return false;
  }
  return !!(input.shiftKey || input.metaKey || input.ctrlKey);
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
function applySessionSnapshot(session, input, touch, now) {
  session.title = input.title?.trim() || session.title || DEFAULT_SESSION_TITLE;
  session.sessionId = input.sessionId;
  session.messages = input.messages;
  if (touch) {
    session.updatedAt = now;
  }
  return session;
}
function formatBridgeConnectionStatus(sessionId, usage) {
  const sessionLabel = sessionId ? `\u5DF2\u8FDE\u63A5 ${formatSelectionPreview(sessionId, 24)}` : "\u5DF2\u6536\u5230\u56DE\u590D";
  if (!usage || typeof usage.cacheHitRate !== "number") {
    return sessionLabel;
  }
  const calls = typeof usage.apiCalls === "number" && usage.apiCalls > 0 ? ` \xB7 ${usage.apiCalls} calls` : "";
  return `${sessionLabel} \xB7 cache ${usage.cacheHitRate}%${calls}`;
}
function getContextModeDescription(mode) {
  switch (mode) {
    case "selection":
      return "\u9009\u533A\u4F18\u5148";
    case "note":
      return "\u5F53\u524D\u7B14\u8BB0";
    case "manual":
      return "\u624B\u52A8";
    case "auto":
    default:
      return "\u81EA\u52A8";
  }
}
function pickLiveContextForMode(liveContext, mode) {
  const titleContext = {
    noteTitle: liveContext.noteTitle,
    notePath: liveContext.notePath
  };
  if (mode === "manual") {
    return {};
  }
  if (mode === "note") {
    return removeEmptyLiveContext(titleContext);
  }
  if (mode === "selection" || mode === "auto" && liveContext.selectionText) {
    return removeEmptyLiveContext({
      ...titleContext,
      selectionText: liveContext.selectionText,
      noteContext: liveContext.noteContext
    });
  }
  return removeEmptyLiveContext(titleContext);
}
function buildContextHealthItems(input) {
  const sessionValue = input.sessionId ? formatSelectionPreview(input.sessionId, 32) : "\u672A\u8FDE\u63A5";
  const cacheValue = input.usage && typeof input.usage.cacheHitRate === "number" ? `${input.usage.cacheHitRate}%${input.usage.apiCalls ? ` \xB7 ${input.usage.apiCalls} calls` : ""}` : "\u7B49\u5F85\u4E0B\u4E00\u6B21\u56DE\u590D";
  const contextParts = [
    input.liveContext.noteTitle,
    input.liveContext.selectionText ? `\u9009\u533A ${input.liveContext.selectionText.trim().length} \u5B57` : "",
    input.liveContext.noteContext ? `\u9644\u8FD1\u4E0A\u4E0B\u6587 ${input.liveContext.noteContext.trim().length} \u5B57` : ""
  ].filter(Boolean);
  const pendingParts = [
    input.pendingContextCount > 0 ? `${input.pendingContextCount} \u6BB5\u4E0A\u4E0B\u6587` : "",
    input.pendingImageCount > 0 ? `${input.pendingImageCount} \u5F20\u56FE\u7247` : "",
    input.queueCount > 0 ? `${input.queueCount} \u6761\u6392\u961F` : ""
  ].filter(Boolean);
  return [
    { label: "Session", value: sessionValue },
    { label: "Cache", value: cacheValue },
    { label: "Context", value: contextParts.join(" \xB7 ") || "\u65E0\u5B9E\u65F6\u4E0A\u4E0B\u6587" },
    { label: "Pending", value: pendingParts.join(" \xB7 ") || "\u65E0\u5F85\u53D1\u9001\u9644\u4EF6" }
  ];
}
function removeEmptyLiveContext(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => typeof value === "string" && value.trim())
  );
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
  return type === "status" || type === "activity" || type === "write_trace" || type === "progress" || type === "delta";
}
function shouldShowActivityEntry(toolName) {
  return (toolName || "").trim() !== "run.config";
}
function formatActivityTimelineSummary(totalCount, hiddenCount) {
  if (totalCount <= 0) {
    return "";
  }
  if (hiddenCount > 0 && hiddenCount < totalCount) {
    return `\u8FC7\u7A0B \xB7 ${totalCount} \u6761 \xB7 \u5DF2\u6298\u53E0 ${hiddenCount} \u6761`;
  }
  return `\u8FC7\u7A0B \xB7 ${totalCount} \u6761`;
}
function getVisibleActivityTimelineEntries(entries, expanded = false, tailVisibleCount = 1, includeCollapsedTail = true) {
  const filtered = entries.filter((entry) => shouldShowActivityEntry(entry.toolName));
  if (filtered.length === 0) {
    return { visibleEntries: [], hiddenCount: 0, totalCount: 0 };
  }
  if (expanded || includeCollapsedTail && filtered.length <= tailVisibleCount) {
    return { visibleEntries: filtered, hiddenCount: 0, totalCount: filtered.length };
  }
  const visibleIndexes = /* @__PURE__ */ new Set();
  if (includeCollapsedTail) {
    const latestIndex = Math.max(0, filtered.length - tailVisibleCount);
    for (let index = latestIndex; index < filtered.length; index += 1) {
      visibleIndexes.add(index);
    }
  }
  const visibleEntries = filtered.filter((_, index) => visibleIndexes.has(index));
  return {
    visibleEntries,
    hiddenCount: filtered.length - visibleEntries.length,
    totalCount: filtered.length
  };
}
function getVisibleActivityMessages(messages, expanded = false, tailVisibleCount = 1, includeCollapsedTail = true) {
  const filtered = messages.filter(
    (message) => (message.activities ?? []).some((entry) => entry && shouldShowActivityEntry(entry.toolName))
  );
  if (filtered.length === 0) {
    return { visibleMessages: [], hiddenCount: 0, totalCount: 0 };
  }
  if (expanded || includeCollapsedTail && filtered.length <= tailVisibleCount) {
    return { visibleMessages: filtered, hiddenCount: 0, totalCount: filtered.length };
  }
  const visibleIndexes = /* @__PURE__ */ new Set();
  if (includeCollapsedTail) {
    const latestIndex = Math.max(0, filtered.length - tailVisibleCount);
    for (let index = latestIndex; index < filtered.length; index += 1) {
      visibleIndexes.add(index);
    }
  }
  const visibleMessages = filtered.filter((_, index) => visibleIndexes.has(index));
  return {
    visibleMessages,
    hiddenCount: filtered.length - visibleMessages.length,
    totalCount: filtered.length
  };
}
function shouldMergeActivityEntry(toolName, currentStatus, incomingStatus, currentPreview, incomingPreview) {
  if (!toolName) {
    return false;
  }
  if (toolName === "thinking") {
    return currentStatus === "running" && incomingStatus === "running";
  }
  if (toolName === "write_trace") {
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

// src/bridge-helpers.ts
var OBSIDIAN_CONTEXT_PREAMBLE = [
  "Use the following Obsidian context only for this turn.",
  "Stable schema:",
  "- Current open note gives the active note title and vault path when available.",
  "- User highlighted selection is exact selected text; prioritize it over nearby context.",
  "- Current note context is a nearby window from the open note.",
  "- Manual attachments are explicit note or selection attachments added by the user.",
  "Answer the user request at the end. Do not invent vault files, note titles, or wiki links."
].join("\n");
var OBSIDIAN_CONTEXT_CLAMP_MAX_CHARACTERS = 2400;
var OBSIDIAN_CONTEXT_CLAMP_HEAD_CHARACTERS = 1400;
var OBSIDIAN_CONTEXT_CLAMP_TAIL_CHARACTERS = 800;
var OBSIDIAN_WRITE_GUIDANCE = [
  "Obsidian \u5199\u5165\u534F\u8BAE\uFF1A",
  "- \u5F53\u7528\u6237\u8981\u6C42\u4FEE\u6539\u3001\u91CD\u5199\u3001\u6DA6\u8272\u3001\u4F18\u5316\u3001\u8FFD\u52A0\u3001\u5220\u9664\uFF0C\u6216\u66F4\u6539\u5F53\u524D\u6253\u5F00\u7B14\u8BB0\u3001\u7528\u6237\u9AD8\u4EAE\u9009\u533A\u3001\u5F53\u524D\u7B14\u8BB0\u4E0A\u4E0B\u6587\u3001\u4EFB\u610F vault \u6587\u4EF6\u65F6\uFF0C\u5FC5\u987B\u7528\u6587\u4EF6\u5DE5\u5177\uFF08`patch` \u6216 `write_file`\uFF09\u771F\u6B63\u5199\u5165\u3002",
  "- \u7528\u6237\u8BF4\u201C\u8FD9\u7BC7\u201D\u201C\u5F53\u524D\u7B14\u8BB0\u201D\u201C\u9009\u4E2D\u7684\u6587\u5B57\u201D\u201C\u539F\u6587\u201D\u201C\u6539\u4E00\u4E0B\u201D\u201C\u4F18\u5316\u4E00\u4E0B\u201D\u201C\u6DA6\u8272\u201D\u7B49\uFF0C\u9ED8\u8BA4\u6307 Obsidian \u4E0A\u4E0B\u6587\u91CC\u7684 Current open note \u6216\u9009\u533A\uFF1B\u4F7F\u7528\u5176\u4E2D\u7684\u51C6\u786E\u8DEF\u5F84\u3002",
  "- \u4F18\u5148\u4F7F\u7528 `patch` \u505A\u5C40\u90E8\u7CBE\u51C6\u7F16\u8F91\uFF1B\u53EA\u6709\u6574\u7BC7\u91CD\u5199\u3001\u65B0\u5EFA\u6587\u4EF6\u3001\u6216\u5927\u6BB5\u7ED3\u6784\u91CD\u6392\u65F6\u624D\u4F7F\u7528 `write_file`\u3002",
  "- \u5199\u5165\u524D\u53D1\u9001\u4E00\u53E5\u7B80\u77ED\u8FDB\u5C55\uFF0C\u8BA9\u7528\u6237\u77E5\u9053\u4F60\u6B63\u5728\u5904\u7406\u54EA\u4E00\u90E8\u5206\uFF1B\u4E0D\u8981\u8F93\u51FA\u5DE5\u5177\u65E5\u5FD7\u3001\u5185\u90E8\u94FE\u8DEF\u6216\u9690\u85CF\u63A8\u7406\u3002",
  "- \u7528\u6237\u8981\u6C42\u6587\u4EF6\u7F16\u8F91\u65F6\uFF0C\u4E0D\u8981\u5728\u6700\u7EC8\u56DE\u7B54\u91CC\u7C98\u8D34\u5B8C\u6574\u91CD\u5199\u5185\u5BB9\uFF0C\u9664\u975E\u7528\u6237\u660E\u786E\u8981\u6C42\u3002",
  "- \u5199\u5165\u5B8C\u6210\u540E\uFF0C\u6700\u7EC8\u56DE\u7B54\u4FDD\u6301\u7B80\u77ED\uFF1A\u8BF4\u660E\u6539\u4E86\u4EC0\u4E48\u3001\u662F\u5426\u5DF2\u5E94\u7528\u3001\u6709\u6CA1\u6709\u9700\u8981\u7528\u6237\u786E\u8BA4\u7684\u98CE\u9669\u3002",
  "",
  "Obsidian \u5199\u4F5C\u89C4\u8303\uFF1A",
  "- Markdown \u5FC5\u987B\u80FD\u5728 Obsidian \u4E2D\u76F4\u63A5\u9605\u8BFB\u548C\u6E32\u67D3\uFF1B\u6807\u9898\u5C42\u7EA7\u6E05\u6670\uFF0C\u5217\u8868\u4E0D\u8981\u8FC7\u6DF1\uFF0C\u8868\u683C\u53EA\u5728\u786E\u5B9E\u63D0\u5347\u53EF\u8BFB\u6027\u65F6\u4F7F\u7528\u3002",
  "- Callout \u7528\u4E8E\u63D0\u9192\u3001\u603B\u7ED3\u3001\u8B66\u544A\u3001\u5F85\u529E\u6216\u5173\u952E\u89C2\u70B9\uFF0C\u4E0D\u8981\u6EE5\u7528\u3002",
  "- \u4E0D\u8981\u5F3A\u884C\u4F7F\u7528 Mermaid\u3002\u666E\u901A Markdown\u3001\u5217\u8868\u3001\u8868\u683C\u3001callout \u6216\u6B63\u6587\u8868\u8FBE\u66F4\u597D\u65F6\uFF0C\u5C31\u7528\u8FD9\u4E9B\u65B9\u5F0F\u3002",
  "- \u5982\u679C\u4EFB\u52A1\u6D89\u53CA Mermaid \u56FE\u8868\uFF0C\u8D77\u8349\u524D\u4F18\u5148\u67E5\u770B Obsidian/Mermaid \u76F8\u5173 skill\uFF0C\u4F8B\u5982 `obsidian-cli`\u3001`obsidian-markdown`\u3001`mermaid-visualizer`\u3002",
  "- \u5F53\u4F60\u786E\u5B9E\u9009\u62E9 Mermaid \u65F6\uFF0C\u56FE\u8868\u8981\u4FDD\u5B88\u3001\u7B80\u6D01\uFF0C\u5E76\u4E14\u80FD\u901A\u8FC7 Obsidian Mermaid \u8BED\u6CD5\u89E3\u6790\uFF1B\u4E0D\u786E\u5B9A\u80FD\u89E3\u6790\u65F6\u5C31\u7B80\u5316\u3002",
  "",
  "Wiki \u94FE\u63A5\u89C4\u8303\uFF1A",
  "- Wiki \u94FE\u63A5\u5E94\u8BE5\u6307\u5411\u53EF\u957F\u671F\u6C89\u6DC0\u7684\u6982\u5FF5\u3001\u4EBA\u7269\u3001\u9879\u76EE\u3001\u7406\u8BBA\u3001\u65B9\u6CD5\u6216\u4E3B\u9898\uFF0C\u4E0D\u8981\u94FE\u63A5\u666E\u901A\u8BCD\u3001\u6CDB\u8BCD\u3001\u4E00\u6B21\u6027\u8868\u8FBE\u3002",
  "- \u4E0D\u8981\u8FC7\u5EA6\u94FE\u63A5\u3002\u6BCF\u6BB5\u4F18\u5148\u94FE\u63A5 1-3 \u4E2A\u771F\u6B63\u6709\u4EF7\u503C\u7684\u6838\u5FC3\u6982\u5FF5\uFF1B\u540C\u4E00\u6982\u5FF5\u9996\u6B21\u51FA\u73B0\u94FE\u63A5\u5373\u53EF\u3002",
  "- \u53EA\u6709\u76EE\u6807\u7B14\u8BB0\u5DF2\u5B58\u5728\uFF0C\u6216\u4F60\u4F1A\u5728\u540C\u4E00\u6B21\u4EFB\u52A1\u4E2D\u521B\u5EFA\u5B83\uFF0C\u624D\u6DFB\u52A0\u65B0\u7684 `[[wiki]]`\u3002",
  "- \u5982\u679C\u5F15\u5165\u5168\u65B0\u7684 wiki \u94FE\u63A5\u6982\u5FF5\uFF0C\u5FC5\u987B\u5728\u540C\u4E00\u6B21\u5199\u5165\u6D41\u7A0B\u4E2D\u521B\u5EFA\u5BF9\u5E94 Markdown \u7B14\u8BB0\uFF0C\u8BA9\u5B83\u6210\u4E3A\u53EF\u7EE7\u7EED\u751F\u957F\u7684\u77E5\u8BC6\u79CD\u5B50\uFF0C\u800C\u4E0D\u662F\u7A7A\u58F3\u3002",
  "- \u9047\u5230\u53EF\u80FD\u91CD\u590D\u6216\u8FD1\u4E49\u7684\u6982\u5FF5\uFF0C\u4F18\u5148\u590D\u7528\u5DF2\u6709\u7B14\u8BB0\uFF1B\u4E0D\u8981\u5236\u9020\u540C\u4E49\u91CD\u590D\u7B14\u8BB0\u3002",
  "- \u4E0D\u8981\u7559\u4E0B\u6307\u5411\u672A\u521B\u5EFA\u7B14\u8BB0\u7684\u60AC\u7A7A wiki \u94FE\u63A5\u3002",
  "",
  "Skill \u4F7F\u7528\uFF1A",
  "- \u6D89\u53CA Obsidian \u6587\u4EF6\u3001Markdown\u3001Wiki\u3001\u5C5E\u6027\u3001callout\u3001embed\u3001Canvas\u3001Bases \u65F6\uFF0C\u4F18\u5148\u67E5\u770B\u76F8\u5173 Obsidian skill\uFF0C\u4E0D\u8981\u51ED\u8BB0\u5FC6\u786C\u5199\u590D\u6742\u8BED\u6CD5\u3002",
  "- \u6D89\u53CA Mermaid \u56FE\u8868\u65F6\uFF0C\u4F18\u5148\u67E5\u770B Mermaid/Obsidian \u56FE\u8868\u76F8\u5173 skill\u3002"
].join("\n");
function normalizeText(text) {
  return typeof text === "string" ? text.trim() : "";
}
function looksLikeInternalReasoningText(text) {
  const value = normalizeText(text);
  if (!value) {
    return false;
  }
  const lower = value.toLowerCase();
  const markers = [
    "\u5FC5\u987B\u7528 file \u5DE5\u5177",
    "\u6CA1\u6709 file toolset",
    "\u8BA9\u6211\u770B\u770B\u5B50\u4EE3\u7406",
    "\u6211\u53EF\u4EE5\u7ED9\u5B50\u4EE3\u7406",
    "\u8BA9\u6211\u5148\u76F4\u63A5\u5904\u7406",
    "\u8BA9\u6211\u91CD\u65B0\u626B\u63CF",
    "chain-of-thought",
    "hidden reasoning"
  ];
  if (markers.some((marker) => lower.includes(marker.toLowerCase()))) {
    return true;
  }
  const planningLines = value.split(/\n+/).filter((line) => line.trim());
  const firstPersonPlanningCount = planningLines.filter(
    (line) => /(^|[，。；\s])(我先|我再|我会|让我|接下来|先|然后|同时)/.test(line)
  ).length;
  const toolReferenceCount = planningLines.filter(
    (line) => /(tool|工具|toolset|read_file|write_file|execute_code|terminal|file)/i.test(line)
  ).length;
  return planningLines.length >= 3 && firstPersonPlanningCount >= 2 && toolReferenceCount >= 1;
}
function buildHermesInterimGuidance(runtime) {
  const runtimeProvider = normalizeText(runtime?.provider) || "unknown";
  const runtimeModel = normalizeText(runtime?.model) || "unknown";
  const runtimeReasoning = normalizeText(runtime?.reasoningEffort) || "default";
  return [
    `Current runtime: provider=${runtimeProvider}, model=${runtimeModel}, reasoning_effort=${runtimeReasoning}.`,
    "\u5982\u679C\u7528\u6237\u8BE2\u95EE\u5F53\u524D\u6A21\u578B\u6216\u63A8\u7406\u5F3A\u5EA6\uFF0C\u53EA\u80FD\u6839\u636E\u8FD9\u884C\u8FD0\u884C\u65F6\u4FE1\u606F\u56DE\u7B54\uFF1B\u4E0D\u8981\u731C\u6D4B\u9690\u85CF\u5185\u90E8\u72B6\u6001\uFF0C\u4E5F\u4E0D\u8981\u627F\u8BFA provider \u4E00\u5B9A\u4E25\u683C\u6267\u884C\u8BE5\u6863\u4F4D\u3002",
    "\u591A\u6B65\u9AA4\u3001\u5DE5\u5177\u8C03\u7528\u6216\u8F83\u957F\u4EFB\u52A1\u4E2D\uFF0C\u5728\u6700\u7EC8\u56DE\u7B54\u524D\u4E3B\u52A8\u53D1\u9001 1-3 \u6761\u81EA\u7136\u4E2D\u6587\u8FDB\u5C55\u6D88\u606F\u3002",
    "\u9002\u5408\u53D1\u9001\u8FDB\u5C55\u7684\u65F6\u673A\uFF1A\u8BFB\u5B8C\u5173\u952E\u4E0A\u4E0B\u6587\u3001\u5F00\u59CB\u5199\u5165\u3001\u8BA1\u5212\u660E\u663E\u53D8\u5316\u3001\u53D1\u73B0\u98CE\u9669\u3002",
    "\u975E\u5E38\u77ED\u7684\u4EFB\u52A1\u53EF\u4EE5\u8DF3\u8FC7\u8FDB\u5C55\uFF0C\u907F\u514D\u6253\u6270\u3002",
    "\u8FDB\u5C55\u6D88\u606F\u8981\u77ED\u3001\u5177\u4F53\u3001\u50CF\u771F\u4EBA\u534F\u4F5C\u4E2D\u7684\u540C\u6B65\uFF1B\u4E0D\u8981\u6CC4\u9732\u601D\u7EF4\u94FE\u3001\u539F\u59CB\u5DE5\u5177\u65E5\u5FD7\u3001\u5185\u90E8\u8FFD\u8E2A\u6587\u672C\u6216\u9690\u85CF\u63A8\u7406\u3002",
    "\u6700\u7EC8\u56DE\u7B54\u8981\u548C\u4E2D\u9014\u8FDB\u5C55\u5206\u5F00\u3002"
  ].join(" ");
}
function buildHermesObsidianWriteGuidance() {
  return OBSIDIAN_WRITE_GUIDANCE;
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
  if (liveContext.noteContext) {
    liveBlocks.push(
      [
        "## Current note context",
        "The following text is a nearby context window from the open note. Use it together with the highlighted selection.",
        "```text",
        clampCacheFriendlyContext(liveContext.noteContext),
        "```"
      ].join("\n")
    );
  }
  if (input.contexts.length === 0 && liveBlocks.length === 0) {
    return input.userText;
  }
  const contextBlocks = input.contexts.map((context) => {
    const label = normalizeText(context.label) || "Manual attachment";
    const content = clampCacheFriendlyContext(context.content);
    return content ? `## ${label}
${content}` : "";
  }).filter(Boolean).join("\n\n");
  return [
    OBSIDIAN_CONTEXT_PREAMBLE,
    "## Dynamic Obsidian context",
    ...liveBlocks,
    contextBlocks,
    "## User request",
    input.userText
  ].filter(Boolean).join("\n\n");
}
function buildReplayUserContent(input) {
  const sections = [];
  const userText = normalizeText(input.userText);
  if (userText) {
    sections.push(`User request:
${userText}`);
  }
  const { liveContext } = input;
  if (liveContext.noteTitle || liveContext.notePath) {
    sections.push(
      [
        "Current open note:",
        liveContext.noteTitle ? `- Title: ${liveContext.noteTitle}` : "",
        liveContext.notePath ? `- Path: ${liveContext.notePath}` : ""
      ].filter(Boolean).join("\n")
    );
  }
  if (liveContext.selectionText) {
    sections.push(
      [
        "Highlighted selection attached:",
        liveContext.selectionText.trim()
      ].join("\n")
    );
  }
  if (liveContext.noteContext) {
    sections.push(
      [
        "Nearby note context attached:",
        clampCacheFriendlyContext(liveContext.noteContext)
      ].join("\n")
    );
  }
  for (const context of input.contexts) {
    const label = normalizeText(context.label) || "\u9644\u52A0\u4E0A\u4E0B\u6587";
    const content = normalizeText(context.content);
    if (!content) {
      continue;
    }
    sections.push(`Manual attachment - ${label}:
${clampCacheFriendlyContext(content)}`);
  }
  const imageNames = (input.imageNames ?? []).map((name) => normalizeText(name)).filter(Boolean);
  if (imageNames.length > 0) {
    sections.push(`Attached images: ${imageNames.join(", ")}`);
  }
  return sections.filter(Boolean).join("\n\n");
}
function clampCacheFriendlyContext(text) {
  const value = normalizeText(text);
  if (value.length <= OBSIDIAN_CONTEXT_CLAMP_MAX_CHARACTERS) {
    return value;
  }
  const head = value.slice(0, OBSIDIAN_CONTEXT_CLAMP_HEAD_CHARACTERS).trimEnd();
  const tail = value.slice(value.length - OBSIDIAN_CONTEXT_CLAMP_TAIL_CHARACTERS).trimStart();
  const omitted = Math.max(0, value.length - OBSIDIAN_CONTEXT_CLAMP_HEAD_CHARACTERS - OBSIDIAN_CONTEXT_CLAMP_TAIL_CHARACTERS);
  return [head, `[omitted ${omitted} chars for cache-friendly context clamp]`, tail].join("\n\n");
}
function buildReplayAssistantContent(input) {
  const sections = [];
  const finalText = normalizeText(input.finalText);
  if (finalText) {
    sections.push(finalText);
  }
  const recap = summarizeReplayActivities(input.activities);
  if (recap.length > 0) {
    sections.push(["Work recap:", ...recap.map((item) => `- ${item}`)].join("\n"));
  }
  return sections.filter(Boolean).join("\n\n");
}
function summarizeReplayActivities(activities) {
  if (!Array.isArray(activities) || activities.length === 0) {
    return [];
  }
  const ignoredTools = /* @__PURE__ */ new Set(["thinking", "writer", "run.config"]);
  const seen = /* @__PURE__ */ new Set();
  const output = [];
  for (const activity of activities) {
    const toolName = normalizeText(activity.toolName ?? void 0);
    const preview = normalizeText(activity.preview ?? void 0);
    const status = normalizeText(activity.status ?? void 0).toLowerCase();
    if (!toolName || ignoredTools.has(toolName) || !preview) {
      continue;
    }
    if (status === "running") {
      continue;
    }
    const line = `${toolName}: ${preview}`;
    if (seen.has(line)) {
      continue;
    }
    seen.add(line);
    output.push(line);
    if (output.length >= 4) {
      break;
    }
  }
  return output;
}

// src/chat-write-review-helpers.ts
function buildChatWriteReviewInlinePreview(review) {
  const filePath = normalizeReviewPath(review.filePath);
  const diff = review.diff?.trim() ?? "";
  if (!filePath || !filePath.toLowerCase().endsWith(".md") || !diff || filePath.includes(",")) {
    return null;
  }
  const deletions = [];
  const additions = [];
  let oldLine = 0;
  let firstLine = null;
  let pendingAddition = null;
  let pendingDeletion = null;
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
      firstLine ?? (firstLine = oldLine);
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
  if (!sawHunk || deletions.length === 0 && additions.length === 0) {
    return null;
  }
  return {
    filePath,
    firstLine: firstLine ?? 0,
    deletions,
    additions
  };
}
function resolveChatWriteReviewTargetPath(reviewFilePath, vaultFilePaths, vaultRootPath) {
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
  const matches = vaultFilePaths.filter((path) => path.toLowerCase().endsWith(".md")).filter((path) => path.includes("/")).filter((path) => normalizedReviewPath.endsWith(`/${path}`));
  if (matches.length !== 1) {
    return null;
  }
  return matches[0];
}
function listChatWriteReviewMarkdownTargets(review, vaultFilePaths, vaultRootPath) {
  const candidates = [review.filePath, ...parseDiffTargetPaths(review.diff)];
  const resolvedTargets = [];
  const seen = /* @__PURE__ */ new Set();
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
function shouldAutoRevealWriteReviewTarget(reviewFilePath, resolvedTargetPath) {
  const normalizedReviewPath = normalizeReviewPath(reviewFilePath);
  return normalizedReviewPath.toLowerCase().endsWith(".md") && !resolvedTargetPath;
}
function buildChatWriteReviewAdditionMarkdown(addition) {
  return addition.lines.join("\n");
}
function buildChatWriteReviewRenderedMarkdownPreview(preview, visibleCharacters) {
  const additions = typeof visibleCharacters === "number" ? buildChatWriteReviewStreamFrame(preview, visibleCharacters).additions : null;
  const lines = (additions ?? preview.additions).flatMap((addition) => "visibleLines" in addition ? addition.visibleLines : addition.lines).filter((line, index, source) => !(line === "" && source[index - 1] === "" && source[index + 1] === ""));
  const text = lines.join("\n").trim();
  return {
    text,
    isPartial: typeof visibleCharacters === "number" && visibleCharacters < getChatWriteReviewTotalAddedCharacters(preview)
  };
}
function getChatWriteReviewTotalAddedCharacters(preview) {
  return preview.additions.reduce((total, addition) => total + buildChatWriteReviewAdditionMarkdown(addition).length, 0);
}
function advanceChatWriteReviewVisibleCharacters(preview, currentVisibleCharacters, stepCharacters) {
  const totalCharacters = getChatWriteReviewTotalAddedCharacters(preview);
  if (totalCharacters <= 0) {
    return 0;
  }
  const safeCurrent = Math.max(0, currentVisibleCharacters);
  const safeStep = Math.max(1, stepCharacters);
  return Math.min(totalCharacters, safeCurrent + safeStep);
}
function buildChatWriteReviewStreamFrame(preview, visibleCharacters) {
  const totalCharacters = getChatWriteReviewTotalAddedCharacters(preview);
  const clampedVisibleCharacters = Math.max(0, Math.min(totalCharacters, visibleCharacters));
  const additions = [];
  let remainingCharacters = clampedVisibleCharacters;
  let activeAdditionIndex = null;
  let activeLineIndex = null;
  let activeDocumentLine = null;
  preview.additions.forEach((addition, additionIndex) => {
    const additionText = buildChatWriteReviewAdditionMarkdown(addition);
    const visibleText = additionText.slice(0, remainingCharacters);
    const isComplete2 = remainingCharacters >= additionText.length;
    const visibleLines = visibleText.length > 0 ? visibleText.split("\n") : [];
    const nextAddition = {
      afterLine: addition.afterLine,
      lines: addition.lines,
      visibleLines,
      activeLineIndex: null,
      isActive: false,
      isComplete: isComplete2
    };
    if (!isComplete2 && visibleText.length > 0 && activeAdditionIndex === null) {
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
function buildChatWriteReviewDocumentFrame(preview, originalText, visibleCharacters) {
  const streamFrame = buildChatWriteReviewStreamFrame(preview, visibleCharacters);
  const originalLines = originalText.split("\n");
  const additionsByAfterLine = /* @__PURE__ */ new Map();
  for (const addition of streamFrame.additions) {
    const existing = additionsByAfterLine.get(addition.afterLine) ?? [];
    existing.push(addition);
    additionsByAfterLine.set(addition.afterLine, existing);
  }
  const deletedLines = /* @__PURE__ */ new Set();
  for (const deletion of preview.deletions) {
    for (let lineIndex = deletion.fromLine; lineIndex <= deletion.toLine; lineIndex += 1) {
      deletedLines.add(lineIndex);
    }
  }
  const outputLines = [];
  let activeOutputLine = 0;
  const pushAdditions = (afterLine) => {
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
  const activeOffset = outputLines.length === 0 ? 0 : outputLines.slice(0, safeActiveLine).join("\n").length + (safeActiveLine > 0 ? 1 : 0) + (outputLines[safeActiveLine]?.length ?? 0);
  return {
    text,
    activeOffset: Math.max(0, Math.min(text.length, activeOffset)),
    visibleCharacters: streamFrame.visibleCharacters,
    totalCharacters: streamFrame.totalCharacters,
    isComplete: streamFrame.isComplete
  };
}
function normalizeReviewPath(path) {
  return (path ?? "").trim().replace(/\\/g, "/");
}
function parseDiffTargetPaths(diff) {
  const targets = [];
  const seen = /* @__PURE__ */ new Set();
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
function relativizeReviewPathToVault(reviewPath, vaultRootPath) {
  const normalizedVaultRoot = normalizeReviewPath(vaultRootPath).replace(/\/+$/, "");
  if (!normalizedVaultRoot || !reviewPath.startsWith(`${normalizedVaultRoot}/`)) {
    return null;
  }
  return reviewPath.slice(normalizedVaultRoot.length + 1);
}

// src/inline-edit-helpers.ts
var INLINE_EDIT_ACTIONS = [
  {
    id: "polish",
    label: "\u6DA6\u8272",
    shortLabel: "\u6DA6\u8272",
    description: "\u4FDD\u6301\u539F\u610F\uFF0C\u8BA9\u6587\u5B57\u66F4\u81EA\u7136\u9AD8\u7EA7\u3002",
    mode: "replace",
    keywords: ["\u6DA6\u8272", "polish", "rewrite", "\u6539\u5199"]
  },
  {
    id: "format",
    label: "\u683C\u5F0F\u4F18\u5316",
    shortLabel: "\u683C\u5F0F",
    description: "\u6574\u7406\u6210\u66F4\u597D\u770B\u7684 Obsidian Markdown\u3002",
    mode: "replace",
    keywords: ["\u683C\u5F0F", "markdown", "\u6392\u7248", "\u7F8E\u5316", "\u597D\u770B"]
  },
  {
    id: "html",
    label: "HTML",
    shortLabel: "HTML",
    description: "\u8F6C\u6210 Obsidian \u53EF\u76F4\u63A5\u4F7F\u7528\u7684 HTML\u3002",
    mode: "replace",
    keywords: ["html", "html\u5316", "\u6807\u7B7E", "\u5BCC\u6587\u672C"]
  },
  {
    id: "clarify",
    label: "\u6539\u6E05\u695A",
    shortLabel: "\u6E05\u695A",
    description: "\u6D88\u9664\u542B\u6DF7\u8868\u8FBE\uFF0C\u8BA9\u903B\u8F91\u66F4\u76F4\u767D\u3002",
    mode: "replace",
    keywords: ["\u6E05\u695A", "clarify", "\u903B\u8F91", "\u8868\u8FBE"]
  },
  {
    id: "shorten",
    label: "\u6539\u77ED",
    shortLabel: "\u6539\u77ED",
    description: "\u538B\u7F29\u5197\u4F59\uFF0C\u4FDD\u7559\u91CD\u70B9\u3002",
    mode: "replace",
    keywords: ["\u77ED", "short", "\u7CBE\u7B80", "\u538B\u7F29"]
  },
  {
    id: "translate",
    label: "\u7FFB\u8BD1",
    shortLabel: "\u7FFB\u8BD1",
    description: "\u5728\u4E2D\u82F1\u6587\u4E4B\u95F4\u81EA\u7136\u7FFB\u8BD1\u3002",
    mode: "replace",
    keywords: ["\u7FFB\u8BD1", "translate", "english", "\u4E2D\u6587"]
  },
  {
    id: "wiki-link",
    label: "\u52A0\u5165 Wiki \u94FE\u63A5",
    shortLabel: "Wiki",
    description: "\u53EA\u94FE\u63A5\u77E5\u8BC6\u5E93\u91CC\u771F\u5B9E\u5B58\u5728\u7684\u7B14\u8BB0\u3002",
    mode: "replace",
    keywords: ["wiki", "\u94FE\u63A5", "\u53CC\u94FE", "link"]
  },
  {
    id: "custom",
    label: "\u81EA\u5B9A\u4E49\u63D0\u95EE",
    shortLabel: "\u81EA\u5B9A\u4E49",
    description: "\u76F4\u63A5\u5199\u4F60\u7684\u8981\u6C42\uFF0C\u8BA9 Hermes \u6309\u8981\u6C42\u4FEE\u6539\u3002",
    mode: "replace",
    keywords: ["\u81EA\u5B9A\u4E49", "custom", "\u63D0\u95EE", "\u8981\u6C42"]
  },
  {
    id: "continue",
    label: "\u7EED\u5199",
    shortLabel: "\u7EED\u5199",
    description: "\u6CBF\u7740\u5F53\u524D\u8BED\u6C14\u7EE7\u7EED\u5199\u4E0B\u53BB\u3002",
    mode: "insert",
    keywords: ["\u7EED\u5199", "continue", "\u63A5\u7740\u5199"]
  },
  {
    id: "summarize",
    label: "\u603B\u7ED3",
    shortLabel: "\u603B\u7ED3",
    description: "\u63D0\u70BC\u6210\u53EF\u76F4\u63A5\u653E\u5165\u7B14\u8BB0\u7684\u6458\u8981\u3002",
    mode: "insert",
    keywords: ["\u603B\u7ED3", "summary", "\u6458\u8981"]
  },
  {
    id: "outline",
    label: "\u751F\u6210\u5927\u7EB2",
    shortLabel: "\u5927\u7EB2",
    description: "\u6839\u636E\u5F53\u524D\u7B14\u8BB0\u751F\u6210\u7ED3\u6784\u5316\u5927\u7EB2\u3002",
    mode: "note",
    keywords: ["\u5927\u7EB2", "outline", "\u7ED3\u6784"]
  },
  {
    id: "title",
    label: "\u63D0\u70BC\u6807\u9898",
    shortLabel: "\u6807\u9898",
    description: "\u751F\u6210\u51E0\u4E2A\u53EF\u63D2\u5165\u7684\u6807\u9898\u5019\u9009\u3002",
    mode: "note",
    keywords: ["\u6807\u9898", "title", "\u547D\u540D"]
  }
];
function getInlineEditAction(actionId) {
  return INLINE_EDIT_ACTIONS.find((action) => action.id === actionId);
}
function getInlineEditToolbarActions(actions = INLINE_EDIT_ACTIONS) {
  const toolbarIds = /* @__PURE__ */ new Set(["polish", "format", "html", "shorten", "wiki-link", "custom"]);
  return actions.filter((action) => toolbarIds.has(action.id));
}
function parseSlashTrigger(line, cursorCh) {
  const beforeCursor = line.slice(0, cursorCh);
  const match = beforeCursor.match(/(?:^|\s)\/([\p{L}\p{N}\p{Script=Han}_-]*)$/u);
  if (!match || match.index === void 0) {
    return null;
  }
  const prefix = beforeCursor.slice(0, match.index + match[0].lastIndexOf("/"));
  if (prefix.endsWith("http:/") || prefix.endsWith("https:/")) {
    return null;
  }
  return {
    query: match[1] ?? "",
    fromCh: match.index + match[0].lastIndexOf("/")
  };
}
function filterInlineEditActions(query, actions = INLINE_EDIT_ACTIONS) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return actions;
  }
  return actions.filter(
    (action) => [action.label, action.shortLabel, action.description, ...action.keywords].join(" ").toLowerCase().includes(normalized)
  );
}
function selectVaultNoteTitlesForWikiPrompt(input) {
  const normalizedTarget = normalizeForSearch(input.targetText);
  const normalizedNoteTitle = normalizeForSearch(input.noteTitle ?? "");
  const scored = input.titles.map((title, index) => {
    const normalizedTitle = normalizeForSearch(title);
    let score = 0;
    if (normalizedTitle && normalizedTarget.includes(normalizedTitle)) {
      score += 1e3;
    }
    if (normalizedTitle && normalizedNoteTitle.includes(normalizedTitle)) {
      score += 400;
    }
    for (const char of Array.from(normalizedTitle)) {
      if (normalizedTarget.includes(char)) {
        score += 1;
      }
    }
    return { title, index, score };
  }).sort((left, right) => right.score - left.score || left.index - right.index);
  return scored.slice(0, input.limit ?? 80).map((item) => item.title);
}
function findInlineEditSourceRange(noteText, selectedText, preferredOffset = 0) {
  const targetText = normalizeSelectedText(selectedText);
  if (!targetText) {
    return null;
  }
  const exactOffset = findClosestIndex(noteText, targetText, preferredOffset);
  if (exactOffset !== -1) {
    const exactTableRange = expandTableRange(noteText, exactOffset, exactOffset + targetText.length);
    if (exactTableRange) {
      return {
        fromOffset: exactTableRange.fromOffset,
        toOffset: exactTableRange.toOffset,
        sourceText: noteText.slice(exactTableRange.fromOffset, exactTableRange.toOffset),
        targetText,
        kind: "table-rows"
      };
    }
    return {
      fromOffset: exactOffset,
      toOffset: exactOffset + targetText.length,
      sourceText: noteText.slice(exactOffset, exactOffset + targetText.length),
      targetText,
      kind: "exact"
    };
  }
  const chunks = targetText.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!chunks.length) {
    return null;
  }
  let searchOffset = Math.max(0, Math.min(preferredOffset, noteText.length));
  let firstMatch = -1;
  let lastMatchEnd = -1;
  for (const chunk of chunks) {
    let match = noteText.indexOf(chunk, searchOffset);
    if (match === -1 && searchOffset > 0) {
      match = noteText.indexOf(chunk);
    }
    if (match === -1) {
      return null;
    }
    if (firstMatch === -1) {
      firstMatch = match;
    }
    lastMatchEnd = match + chunk.length;
    searchOffset = lastMatchEnd;
  }
  const fromOffset = findLineStart(noteText, firstMatch);
  const toOffset = findLineEnd(noteText, lastMatchEnd);
  const tableRange = expandTableRange(noteText, fromOffset, toOffset);
  if (tableRange) {
    return {
      fromOffset: tableRange.fromOffset,
      toOffset: tableRange.toOffset,
      sourceText: noteText.slice(tableRange.fromOffset, tableRange.toOffset),
      targetText,
      kind: "table-rows"
    };
  }
  return {
    fromOffset,
    toOffset,
    sourceText: noteText.slice(fromOffset, toOffset),
    targetText,
    kind: "line-span"
  };
}
function getInlineEditDraftOriginalText(input) {
  if (input.sourceText && input.sourceText !== input.targetText) {
    return input.sourceText;
  }
  return input.targetText;
}
function isContinuousSelection(selections) {
  return selections.length === 1 && comparePositions(selections[0].anchor, selections[0].head) !== 0;
}
function getParagraphRangeAtCursor(lines, cursor) {
  const boundedLine = Math.min(Math.max(cursor.line, 0), Math.max(lines.length - 1, 0));
  let startLine = boundedLine;
  let endLine = boundedLine;
  while (startLine > 0 && lines[startLine - 1]?.trim()) {
    startLine -= 1;
  }
  while (endLine < lines.length - 1 && lines[endLine + 1]?.trim()) {
    endLine += 1;
  }
  const text = lines.slice(startLine, endLine + 1).join("\n");
  return {
    from: { line: startLine, ch: 0 },
    to: { line: endLine, ch: lines[endLine]?.length ?? 0 },
    text
  };
}
function buildInlineEditPrompt(input) {
  const instruction = getActionInstruction(input.action);
  const targetLabel = input.action.mode === "note" ? "\u5F53\u524D\u7B14\u8BB0" : "\u76EE\u6807\u6587\u672C";
  const wikiTitles = input.action.id === "wiki-link" ? formatWikiTitleList(input.vaultNoteTitles ?? []) : "";
  const tableInstruction = input.sourceText && isMarkdownTableSource(input.sourceText) ? "\u8FD9\u662F Markdown \u8868\u683C\u6E90\u7801\u8303\u56F4\u3002\u8FD4\u56DE\u53EF\u4EE5\u76F4\u63A5\u66FF\u6362\u8BE5\u8303\u56F4\u7684 Markdown \u8868\u683C\u6E90\u7801\uFF1B\u4FDD\u6301\u8868\u683C\u7ED3\u6784\u6709\u6548\uFF0C\u5305\u542B\u5FC5\u8981\u7684\u8868\u5934\u548C\u5206\u9694\u884C\uFF0C\u4E0D\u8981\u8F93\u51FA\u89E3\u91CA\u3002" : "";
  const parts = [
    input.action.id === "html" ? "\u4F60\u662F Obsidian \u91CC\u7684 Hermes inline edit\u3002\u53EA\u8FD4\u56DE\u53EF\u4EE5\u76F4\u63A5\u5199\u5165\u7B14\u8BB0\u7684 HTML \u6B63\u6587\u3002" : "\u4F60\u662F Obsidian \u91CC\u7684 Hermes inline edit\u3002\u53EA\u8FD4\u56DE\u53EF\u4EE5\u76F4\u63A5\u5199\u5165\u7B14\u8BB0\u7684 Markdown \u6B63\u6587\u3002",
    "\u4E0D\u8981\u5BD2\u6684\uFF0C\u4E0D\u8981\u89E3\u91CA\uFF0C\u4E0D\u8981\u5305\u88F9\u4EE3\u7801\u5757\uFF0C\u4E0D\u8981\u6DFB\u52A0\u201C\u4EE5\u4E0B\u662F\u201D\u7B49\u524D\u7F00\u3002",
    instruction,
    tableInstruction,
    wikiTitles ? `## \u53EF\u7528 Wiki \u7B14\u8BB0\u6807\u9898
${wikiTitles}` : "",
    input.noteTitle ? `\u7B14\u8BB0\u6807\u9898\uFF1A${input.noteTitle}` : "",
    input.noteContext ? `## \u5F53\u524D\u7B14\u8BB0\u4E0A\u4E0B\u6587
${input.noteContext}` : "",
    input.noteText ? `## \u5F53\u524D\u7B14\u8BB0
${input.noteText}` : "",
    input.sourceText && input.sourceText !== input.targetText ? `## \u539F\u59CB Markdown \u6E90\u7801\u8303\u56F4
${input.sourceText}` : "",
    `## ${targetLabel}
${input.targetText || "(\u5149\u6807\u4F4D\u7F6E\uFF0C\u65E0\u9009\u533A)"}`,
    input.customInstruction ? `## \u7528\u6237\u81EA\u5B9A\u4E49\u8981\u6C42
${input.customInstruction}` : "",
    input.currentProposal ? `## \u5F53\u524D\u5019\u9009\u7A3F
${input.currentProposal}` : "",
    input.followUp ? `## \u8FFD\u95EE\u8981\u6C42
${input.followUp}` : ""
  ].filter(Boolean);
  return parts.join("\n\n");
}
function resolveSelectionSourceRange(noteText, selectedText, preferredOffset = 0, mode = "source") {
  const exactRange = findInlineEditSourceRange(noteText, selectedText, preferredOffset);
  if (mode === "source") {
    return exactRange;
  }
  if (exactRange) {
    const expandedRange = expandPreviewSourceRange(noteText, exactRange.fromOffset, exactRange.toOffset);
    const tableRange = expandTableRange(noteText, expandedRange.fromOffset, expandedRange.toOffset);
    if (tableRange) {
      return {
        fromOffset: tableRange.fromOffset,
        toOffset: tableRange.toOffset,
        sourceText: noteText.slice(tableRange.fromOffset, tableRange.toOffset),
        targetText: normalizeSelectedText(selectedText),
        kind: "table-rows"
      };
    }
    return {
      fromOffset: expandedRange.fromOffset,
      toOffset: expandedRange.toOffset,
      sourceText: noteText.slice(expandedRange.fromOffset, expandedRange.toOffset),
      targetText: normalizeSelectedText(selectedText),
      kind: exactRange.kind
    };
  }
  return findPreviewSelectionSourceRange(noteText, selectedText, preferredOffset);
}
function buildSelectionContextWindow(input) {
  const noteText = input.noteText.trim();
  if (!noteText) {
    return "";
  }
  const resolvedRange = typeof input.fromOffset === "number" && typeof input.toOffset === "number" ? {
    fromOffset: input.fromOffset,
    toOffset: input.toOffset
  } : input.selectedText ? resolveSelectionSourceRange(
    noteText,
    input.selectedText,
    input.preferredOffset ?? 0,
    input.mode ?? "source"
  ) : null;
  if (!resolvedRange) {
    return trimContextSnippet(noteText, input.maxCharacters ?? 1800);
  }
  return extractContextWindow(noteText, resolvedRange.fromOffset, resolvedRange.toOffset, {
    windowLines: input.windowLines ?? 6,
    maxCharacters: input.maxCharacters ?? 1800
  });
}
function transitionInlineDraft(draft, event, payload = {}) {
  if (event === "cancel") {
    return { state: null, reason: payload.message };
  }
  if (payload.requestId !== void 0 && payload.requestId !== draft.requestId) {
    return { state: draft, reason: "stale-request" };
  }
  if (event === "error") {
    return {
      state: { ...draft, status: "error" },
      reason: payload.message
    };
  }
  return {
    state: {
      ...draft,
      status: "ready",
      proposedText: payload.proposedText ?? draft.proposedText
    }
  };
}
function comparePositions(left, right) {
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  return left.ch - right.ch;
}
function getActionInstruction(action) {
  switch (action.id) {
    case "polish":
      return "\u4EFB\u52A1\uFF1A\u6DA6\u8272\u76EE\u6807\u6587\u672C\uFF0C\u4FDD\u6301\u539F\u610F\u548C\u4FE1\u606F\u5BC6\u5EA6\uFF0C\u8BA9\u8868\u8FBE\u66F4\u81EA\u7136\u3001\u6709\u8D28\u611F\u3002";
    case "format":
      return "\u4EFB\u52A1\uFF1A\u53EA\u6574\u7406\u76EE\u6807\u6587\u672C\u7684\u683C\u5F0F\u548C\u7ED3\u6784\uFF0C\u4FDD\u7559\u539F\u610F\uFF0C\u4E0D\u8981\u6539\u5185\u5BB9\uFF0C\u5C3D\u91CF\u4E0D\u6539\u8BED\u4E49\u3002\u4F18\u5148\u4FEE\u590D Markdown \u6392\u7248\u3001\u6807\u9898\u3001\u5217\u8868\u3001\u8868\u683C\u3001callout \u548C Mermaid \u8BED\u6CD5\uFF0C\u8BA9\u5B83\u66F4\u9002\u5408 Obsidian \u9605\u8BFB\u3002";
    case "html":
      return "\u4EFB\u52A1\uFF1A\u628A\u76EE\u6807\u6587\u672C\u8F6C\u6210 Obsidian \u53EF\u76F4\u63A5\u4F7F\u7528\u7684\u7EAF HTML\u3002\u53EA\u8F93\u51FA HTML \u6807\u7B7E\u548C\u6587\u672C\uFF0C\u4E0D\u8981\u6DF7\u5165 Markdown\uFF0C\u4E0D\u8981\u89E3\u91CA\u3002";
    case "clarify":
      return "\u4EFB\u52A1\uFF1A\u628A\u76EE\u6807\u6587\u672C\u6539\u5F97\u66F4\u6E05\u695A\uFF0C\u8865\u8DB3\u5FC5\u8981\u8FDE\u63A5\u8BCD\uFF0C\u53BB\u6389\u542B\u6DF7\u548C\u7ED5\u5F2F\u3002";
    case "shorten":
      return "\u4EFB\u52A1\uFF1A\u538B\u7F29\u76EE\u6807\u6587\u672C\uFF0C\u5220\u6389\u91CD\u590D\u548C\u7A7A\u8BDD\uFF0C\u4F46\u4FDD\u7559\u6838\u5FC3\u610F\u601D\u3002";
    case "translate":
      return "\u4EFB\u52A1\uFF1A\u7FFB\u8BD1\u76EE\u6807\u6587\u672C\u3002\u4E2D\u6587\u7FFB\u6210\u81EA\u7136\u82F1\u6587\uFF0C\u82F1\u6587\u7FFB\u6210\u81EA\u7136\u4E2D\u6587\u3002";
    case "wiki-link":
      return "\u4EFB\u52A1\uFF1A\u5728\u76EE\u6807\u6587\u672C\u4E2D\u81EA\u7136\u7A7F\u63D2 Obsidian Wiki \u94FE\u63A5\u3002\u53EA\u80FD\u4F7F\u7528\u4E0B\u65B9\u771F\u5B9E\u5B58\u5728\u7684\u7B14\u8BB0\u6807\u9898\uFF0C\u683C\u5F0F\u5FC5\u987B\u662F [[\u771F\u5B9E\u7B14\u8BB0\u6807\u9898]]\uFF1B\u4E0D\u8981\u521B\u9020\u5217\u8868\u5916\u7684\u65B0\u94FE\u63A5\u3002\u6CA1\u6709\u5408\u9002\u7B14\u8BB0\u65F6\u4E0D\u8981\u6DFB\u52A0 Wiki \u94FE\u63A5\u3002";
    case "custom":
      return "\u4EFB\u52A1\uFF1A\u4E25\u683C\u6309\u7528\u6237\u81EA\u5B9A\u4E49\u8981\u6C42\u5904\u7406\u76EE\u6807\u6587\u672C\uFF1B\u8F93\u51FA\u5FC5\u987B\u662F\u53EF\u76F4\u63A5\u5199\u5165\u7B14\u8BB0\u7684 Markdown \u6B63\u6587\u3002";
    case "continue":
      return "\u4EFB\u52A1\uFF1A\u6CBF\u7740\u76EE\u6807\u6587\u672C\u6216\u5149\u6807\u524D\u4E0A\u4E0B\u6587\u7EED\u5199\u4E00\u5C0F\u6BB5\uFF0C\u8BED\u6C14\u548C\u7ED3\u6784\u4FDD\u6301\u4E00\u81F4\u3002";
    case "summarize":
      return "\u4EFB\u52A1\uFF1A\u628A\u76EE\u6807\u6587\u672C\u6216\u5F53\u524D\u6BB5\u843D\u603B\u7ED3\u6210\u9002\u5408\u63D2\u5165\u7B14\u8BB0\u7684 Markdown \u6458\u8981\u3002";
    case "outline":
      return "\u4EFB\u52A1\uFF1A\u6839\u636E\u5F53\u524D\u7B14\u8BB0\u751F\u6210\u7ED3\u6784\u5316 Markdown \u5927\u7EB2\uFF0C\u53EA\u8F93\u51FA\u5927\u7EB2\u6B63\u6587\u3002";
    case "title":
      return "\u4EFB\u52A1\uFF1A\u6839\u636E\u5F53\u524D\u7B14\u8BB0\u63D0\u70BC 5 \u4E2A\u6807\u9898\u5019\u9009\uFF0C\u7528 Markdown \u5217\u8868\u8F93\u51FA\uFF0C\u4E0D\u8981\u91CD\u547D\u540D\u6587\u4EF6\u3002";
    default:
      return `\u4EFB\u52A1\uFF1A${action.description}`;
  }
}
function normalizeForSearch(value) {
  return value.toLowerCase().replace(/\s+/g, "");
}
function normalizeSelectedText(value) {
  return value.replace(/\u00a0/g, " ").replace(/\r\n?/g, "\n").trim();
}
function findClosestIndex(source, target, preferredOffset) {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let index = source.indexOf(target);
  while (index !== -1) {
    const distance = Math.abs(index - preferredOffset);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
    index = source.indexOf(target, index + target.length);
  }
  return best;
}
function findLineStart(source, offset) {
  const lineStart = source.lastIndexOf("\n", Math.max(0, offset - 1));
  return lineStart === -1 ? 0 : lineStart + 1;
}
function findLineEnd(source, offset) {
  const lineEnd = source.indexOf("\n", offset);
  return lineEnd === -1 ? source.length : lineEnd;
}
function formatWikiTitleList(titles) {
  if (titles.length === 0) {
    return "- \u6CA1\u6709\u53EF\u7528\u6807\u9898\u3002\u6B64\u65F6\u4E0D\u8981\u6DFB\u52A0\u4EFB\u4F55 Wiki \u94FE\u63A5\u3002";
  }
  return titles.map((title) => `- [[${title}]]`).join("\n");
}
function isMarkdownTableSource(value) {
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.some(isLikelyMarkdownTableLine);
}
function expandTableRange(source, fromOffset, toOffset) {
  const lines = source.split("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const startLine = getLineIndexForOffset(starts, fromOffset);
  const endLine = getLineIndexForOffset(starts, Math.max(fromOffset, toOffset - 1));
  const selectedLines = lines.slice(startLine, endLine + 1);
  if (!selectedLines.some(isLikelyMarkdownTableLine)) {
    return null;
  }
  let tableStart = startLine;
  let tableEnd = endLine;
  while (tableStart > 0 && isLikelyMarkdownTableLine(lines[tableStart - 1])) {
    tableStart -= 1;
  }
  while (tableEnd < lines.length - 1 && isLikelyMarkdownTableLine(lines[tableEnd + 1])) {
    tableEnd += 1;
  }
  const rangeStart = starts[tableStart] ?? fromOffset;
  const lastLineStart = starts[tableEnd] ?? toOffset;
  return {
    fromOffset: rangeStart,
    toOffset: lastLineStart + (lines[tableEnd]?.length ?? 0)
  };
}
function getLineIndexForOffset(starts, offset) {
  let line = 0;
  for (let index = 0; index < starts.length; index += 1) {
    if (starts[index] <= offset) {
      line = index;
    } else {
      break;
    }
  }
  return line;
}
function isLikelyMarkdownTableLine(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return false;
  }
  const cells = trimmed.split("|").map((cell) => cell.trim());
  return cells.filter(Boolean).length >= 2;
}
function findPreviewSelectionSourceRange(noteText, selectedText, preferredOffset = 0) {
  const targetText = normalizeSelectionSearchText(selectedText);
  const displayText = normalizeSelectedText(selectedText);
  if (!targetText) {
    return null;
  }
  const rendered = buildRenderedSelectionIndex(noteText);
  const renderedIndex = findClosestRenderedIndex(rendered.text, targetText, preferredOffset, rendered.sourceOffsets);
  if (renderedIndex === null) {
    return null;
  }
  const fromOffset = rendered.sourceOffsets[renderedIndex] ?? 0;
  const toRenderedIndex = renderedIndex + targetText.length - 1;
  const toOffset = (rendered.sourceOffsets[toRenderedIndex] ?? fromOffset) + 1;
  const expandedRange = expandPreviewSourceRange(noteText, fromOffset, toOffset);
  const tableRange = expandTableRange(noteText, expandedRange.fromOffset, expandedRange.toOffset);
  if (tableRange) {
    return {
      fromOffset: tableRange.fromOffset,
      toOffset: tableRange.toOffset,
      sourceText: noteText.slice(tableRange.fromOffset, tableRange.toOffset),
      targetText: displayText,
      kind: "table-rows"
    };
  }
  return {
    fromOffset: expandedRange.fromOffset,
    toOffset: expandedRange.toOffset,
    sourceText: noteText.slice(expandedRange.fromOffset, expandedRange.toOffset),
    targetText: displayText,
    kind: "line-span"
  };
}
function expandPreviewSourceRange(noteText, fromOffset, toOffset) {
  const currentLineStart = findLineStart(noteText, fromOffset);
  const currentLineEnd = findLineEnd(noteText, toOffset);
  const lineText = noteText.slice(currentLineStart, currentLineEnd);
  const localFrom = Math.max(0, fromOffset - currentLineStart);
  const localTo = Math.max(0, toOffset - currentLineStart);
  const wikiStart = lineText.lastIndexOf("[[", localFrom);
  const wikiEnd = lineText.indexOf("]]", localTo);
  if (wikiStart !== -1 && wikiEnd !== -1 && wikiStart < localFrom) {
    return {
      fromOffset: currentLineStart + wikiStart,
      toOffset: currentLineStart + wikiEnd + 2
    };
  }
  const linkStart = lineText.lastIndexOf("[", localFrom);
  const linkMarker = lineText.indexOf("](", localTo);
  const linkEnd = linkMarker === -1 ? -1 : lineText.indexOf(")", linkMarker + 2);
  if (linkStart !== -1 && linkMarker !== -1 && linkEnd !== -1 && linkStart < localFrom) {
    return {
      fromOffset: currentLineStart + linkStart,
      toOffset: currentLineStart + linkEnd + 1
    };
  }
  for (const marker of ["**", "__", "~~", "``", "*", "_"]) {
    const markerStart = lineText.lastIndexOf(marker, localFrom);
    const markerEnd = lineText.indexOf(marker, localTo);
    if (markerStart !== -1 && markerEnd !== -1 && markerStart < localFrom) {
      return {
        fromOffset: currentLineStart + markerStart,
        toOffset: currentLineStart + markerEnd + marker.length
      };
    }
  }
  return { fromOffset, toOffset };
}
function buildRenderedSelectionIndex(source) {
  const textParts = [];
  const sourceOffsets = [];
  let index = 0;
  let inFence = false;
  while (index < source.length) {
    const lineEnd = source.indexOf("\n", index);
    const rawLine = source.slice(index, lineEnd === -1 ? source.length : lineEnd);
    const nextIndex = lineEnd === -1 ? source.length : lineEnd + 1;
    const isLineStart = index === 0 || source[index - 1] === "\n";
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      index = nextIndex;
      continue;
    }
    if (inFence) {
      appendRenderedLine(textParts, sourceOffsets, rawLine, index, { preserveFormatting: true });
    } else {
      const stripped = stripMarkdownLinePrefix(rawLine, isLineStart);
      appendRenderedLine(textParts, sourceOffsets, stripped.text, index + stripped.sourceOffset, {
        treatTablePipesAsSpaces: stripped.isTable
      });
    }
    if (lineEnd !== -1) {
      appendWhitespaceIfNeeded(textParts, sourceOffsets, lineEnd, textParts.length > 0 && /\s/.test(textParts[textParts.length - 1] ?? ""));
    }
    index = nextIndex;
  }
  return {
    text: textParts.join(""),
    sourceOffsets
  };
}
function stripMarkdownLinePrefix(line, isLineStart) {
  if (!isLineStart) {
    return { text: line, sourceOffset: 0, isTable: isLikelyMarkdownTableLine(line) };
  }
  let cursor = 0;
  while (cursor < line.length && /\s/.test(line[cursor] ?? "")) {
    cursor += 1;
  }
  const headingMatch = line.slice(cursor).match(/^(#{1,6})\s+/);
  if (headingMatch) {
    cursor += headingMatch[0].length;
  }
  const quoteMatch = line.slice(cursor).match(/^(?:>\s*)+/);
  if (quoteMatch) {
    cursor += quoteMatch[0].length;
  }
  const taskMatch = line.slice(cursor).match(/^(?:[-*+]\s+\[[ xX]\]\s*|[-*+]\s+|\d+[.)]\s+)/);
  if (taskMatch) {
    cursor += taskMatch[0].length;
  }
  const isTable = isLikelyMarkdownTableLine(line);
  if (isTable) {
    return {
      text: line.replace(/\|/g, " "),
      sourceOffset: 0,
      isTable: true
    };
  }
  return {
    text: line.slice(cursor),
    sourceOffset: cursor,
    isTable: false
  };
}
function appendRenderedLine(textParts, sourceOffsets, line, lineSourceOffset, options = {}) {
  let lastWasSpace = textParts.length > 0 && /\s/.test(textParts[textParts.length - 1] ?? "");
  let index = 0;
  while (index < line.length) {
    const char = line[index] ?? "";
    const sourceOffset = lineSourceOffset + index;
    if (options.treatTablePipesAsSpaces && char === "|") {
      appendWhitespaceIfNeeded(textParts, sourceOffsets, sourceOffset, lastWasSpace);
      lastWasSpace = true;
      index += 1;
      continue;
    }
    if (!options.preserveFormatting && isFormattingMarker(line, index)) {
      index += skipFormattingMarker(line, index);
      continue;
    }
    if (!options.preserveFormatting && char === "\\") {
      const nextChar = line[index + 1];
      if (nextChar) {
        appendRenderedChar(textParts, sourceOffsets, nextChar, sourceOffset + 1);
        lastWasSpace = false;
        index += 2;
        continue;
      }
    }
    if (!options.preserveFormatting && char === "!" && line[index + 1] === "[") {
      const image = parseVisibleLink(line, index + 1, lineSourceOffset);
      if (image) {
        appendText(textParts, sourceOffsets, image.text, image.sourceOffsets);
        lastWasSpace = textParts.length > 0 && /\s/.test(textParts[textParts.length - 1] ?? "");
        index = image.endIndex;
        continue;
      }
    }
    if (!options.preserveFormatting && char === "[") {
      const link = parseVisibleLink(line, index, lineSourceOffset);
      if (link) {
        appendText(textParts, sourceOffsets, link.text, link.sourceOffsets);
        lastWasSpace = textParts.length > 0 && /\s/.test(textParts[textParts.length - 1] ?? "");
        index = link.endIndex;
        continue;
      }
    }
    if (!options.preserveFormatting && char === "<") {
      const tagEnd = line.indexOf(">", index + 1);
      if (tagEnd !== -1 && looksLikeHtmlTag(line.slice(index, tagEnd + 1))) {
        index = tagEnd + 1;
        continue;
      }
    }
    if (!options.preserveFormatting && char === "`") {
      const code = parseInlineCode(line, index, lineSourceOffset);
      if (code) {
        appendText(textParts, sourceOffsets, code.text, code.sourceOffsets);
        lastWasSpace = textParts.length > 0 && /\s/.test(textParts[textParts.length - 1] ?? "");
        index = code.endIndex;
        continue;
      }
    }
    if (!options.preserveFormatting && char === "[" && line[index + 1] === "[") {
      const wiki = parseWikiLink(line, index, lineSourceOffset);
      if (wiki) {
        appendText(textParts, sourceOffsets, wiki.text, wiki.sourceOffsets);
        lastWasSpace = textParts.length > 0 && /\s/.test(textParts[textParts.length - 1] ?? "");
        index = wiki.endIndex;
        continue;
      }
    }
    if (/\s/.test(char)) {
      appendWhitespaceIfNeeded(textParts, sourceOffsets, sourceOffset, lastWasSpace);
      lastWasSpace = true;
      index += 1;
      continue;
    }
    appendRenderedChar(textParts, sourceOffsets, char, sourceOffset);
    lastWasSpace = false;
    index += 1;
  }
}
function appendWhitespaceIfNeeded(textParts, sourceOffsets, sourceOffset, lastWasSpace) {
  if (lastWasSpace) {
    return;
  }
  appendRenderedChar(textParts, sourceOffsets, " ", sourceOffset);
}
function appendRenderedChar(textParts, sourceOffsets, char, sourceOffset) {
  if (!char) {
    return;
  }
  textParts.push(char);
  sourceOffsets.push(sourceOffset);
}
function appendText(textParts, sourceOffsets, text, offsets) {
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    const offset = offsets[index];
    if (offset === void 0) {
      continue;
    }
    appendRenderedChar(textParts, sourceOffsets, char, offset);
  }
}
function skipFormattingMarker(line, index) {
  const char = line[index];
  if (!char) {
    return 1;
  }
  if (char === "*" || char === "_" || char === "~") {
    let length = 1;
    while (line[index + length] === char) {
      length += 1;
    }
    return length;
  }
  return 1;
}
function isFormattingMarker(line, index) {
  const char = line[index];
  if (!char) {
    return false;
  }
  return char === "*" || char === "_" || char === "~";
}
function parseVisibleLink(line, startIndex, lineSourceOffset) {
  if (line[startIndex] !== "[") {
    return null;
  }
  const closeIndex = findMatchingBracket(line, startIndex + 1);
  if (closeIndex === -1) {
    return null;
  }
  const inner = line.slice(startIndex + 1, closeIndex);
  const nextChar = line[closeIndex + 1];
  if (nextChar !== "(") {
    return line[startIndex + 1] === "[" ? parseWikiLink(line, startIndex, lineSourceOffset) : {
      text: inner,
      sourceOffsets: Array.from({ length: inner.length }, (_, itemIndex) => lineSourceOffset + startIndex + 1 + itemIndex),
      endIndex: closeIndex + 1
    };
  }
  const endParen = findMatchingParen(line, closeIndex + 1);
  if (endParen === -1) {
    return null;
  }
  const text = inner.replace(/^!/, "").split("|").pop() ?? inner;
  return {
    text,
    sourceOffsets: Array.from({ length: text.length }, (_, itemIndex) => lineSourceOffset + startIndex + 1 + itemIndex),
    endIndex: endParen + 1
  };
}
function parseWikiLink(line, startIndex, lineSourceOffset) {
  if (line[startIndex] !== "[" || line[startIndex + 1] !== "[") {
    return null;
  }
  const endIndex = line.indexOf("]]", startIndex + 2);
  if (endIndex === -1) {
    return null;
  }
  const inner = line.slice(startIndex + 2, endIndex);
  const display = inner.includes("|") ? inner.split("|").pop() ?? inner : inner;
  return {
    text: display,
    sourceOffsets: Array.from({ length: display.length }, (_, itemIndex) => lineSourceOffset + startIndex + 2 + itemIndex),
    endIndex: endIndex + 2
  };
}
function parseInlineCode(line, startIndex, lineSourceOffset) {
  let fenceLength = 0;
  while (line[startIndex + fenceLength] === "`") {
    fenceLength += 1;
  }
  if (fenceLength === 0) {
    return null;
  }
  const closing = line.indexOf("`".repeat(fenceLength), startIndex + fenceLength);
  if (closing === -1) {
    return null;
  }
  const content = line.slice(startIndex + fenceLength, closing);
  return {
    text: content,
    sourceOffsets: Array.from({ length: content.length }, (_, itemIndex) => lineSourceOffset + startIndex + fenceLength + itemIndex),
    endIndex: closing + fenceLength
  };
}
function findMatchingBracket(line, startIndex) {
  let depth = 0;
  for (let index = startIndex; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "[") {
      depth += 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}
function findMatchingParen(line, startIndex) {
  let depth = 0;
  for (let index = startIndex; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}
function looksLikeHtmlTag(value) {
  return /^<\/?[A-Za-z][^>]*>$/.test(value.trim());
}
function normalizeSelectionSearchText(value) {
  return normalizeSelectedText(value).replace(/\s+/g, " ");
}
function findClosestRenderedIndex(renderedText, targetText, preferredOffset, sourceOffsets) {
  let bestIndex = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let searchIndex = renderedText.indexOf(targetText);
  while (searchIndex !== -1) {
    const sourceOffset = sourceOffsets[searchIndex];
    if (sourceOffset !== void 0) {
      const distance = Math.abs(sourceOffset - preferredOffset);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = searchIndex;
      }
    }
    searchIndex = renderedText.indexOf(targetText, searchIndex + 1);
  }
  return bestIndex;
}
function extractContextWindow(noteText, fromOffset, toOffset, options) {
  if (!noteText.trim()) {
    return "";
  }
  const lines = noteText.split("\n");
  const starts = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  const fromLine = getLineIndexForOffset(starts, fromOffset);
  const toLine = getLineIndexForOffset(starts, Math.max(fromOffset, toOffset - 1));
  const startLine = Math.max(0, fromLine - options.windowLines);
  const endLine = Math.min(lines.length - 1, toLine + options.windowLines);
  return trimContextSnippet(lines.slice(startLine, endLine + 1).join("\n"), options.maxCharacters);
}
function trimContextSnippet(text, maxCharacters) {
  const normalized = text.trim();
  if (normalized.length <= maxCharacters) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}\u2026`;
}

// src/inline-edit.ts
var import_obsidian = require("obsidian");
var import_state = require("@codemirror/state");
var import_view = require("@codemirror/view");
var setInlineEditDraftEffect = import_state.StateEffect.define();
var inlineEditDraftField = import_state.StateField.define({
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
  provide: (field) => import_view.showTooltip.from(field, (value) => value?.draft?.status === "generating" ? buildInlineEditTooltip(value) : null)
});
var inlineEditDecorationPlugin = import_view.ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildInlineEditDecorations(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.transactions.some((transaction) => transaction.effects.length > 0)) {
        this.decorations = buildInlineEditDecorations(update.view);
      }
    }
  },
  {
    decorations: (value) => value.decorations
  }
);
function createInlineEditExtension() {
  return [inlineEditDraftField, inlineEditDecorationPlugin];
}
var InlineEditManager = class {
  constructor(options) {
    this.currentView = null;
    this.currentContext = null;
    this.currentDraft = null;
    this.currentCancel = null;
    this.requestCounter = 0;
    this.selectionToolbarEl = null;
    this.selectionToolbarTimer = null;
    this.lastMultiSelectionNoticeAt = 0;
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
          this.cancelDraft("\u539F\u6587\u5DF2\u88AB\u4FEE\u6539\uFF0C\u8BF7\u91CD\u65B0\u751F\u6210\u3002");
        }
        if (!(info instanceof import_obsidian.MarkdownView)) {
          this.hideSelectionToolbar();
        }
        this.scheduleSelectionToolbar();
      })
    );
  }
  destroy() {
    this.cancelDraft();
    this.hideSelectionToolbar();
    if (this.selectionToolbarTimer !== null) {
      window.clearTimeout(this.selectionToolbarTimer);
      this.selectionToolbarTimer = null;
    }
  }
  getSlashSuggestions(query) {
    return filterInlineEditActions(query);
  }
  async runSlashAction(action, context) {
    context.editor.replaceRange("", context.start, context.end, "+hermes-inline-slash");
    const markdownView = this.options.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    if (!markdownView || markdownView.editor !== context.editor || !context.file) {
      new import_obsidian.Notice("Hermes inline edit \u53EA\u80FD\u5728\u5F53\u524D Markdown \u7F16\u8F91\u5668\u91CC\u4F7F\u7528\u3002");
      return;
    }
    const cursor = context.start;
    const requestContext = this.buildRequestContextFromCursor(action, context.editor, markdownView, context.file, cursor);
    await this.startRequest(requestContext);
  }
  async runSelectionAction(actionId) {
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
  scheduleSelectionToolbar() {
    if (this.selectionToolbarTimer !== null) {
      window.clearTimeout(this.selectionToolbarTimer);
    }
    this.selectionToolbarTimer = window.setTimeout(() => {
      this.selectionToolbarTimer = null;
      this.renderSelectionToolbar();
    }, 80);
  }
  renderSelectionToolbar() {
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
  hideSelectionToolbar() {
    this.selectionToolbarEl?.remove();
    this.selectionToolbarEl = null;
  }
  getSelectionContext() {
    const markdownView = this.options.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
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
        const [from2, to2] = comparePositions(selection.anchor, selection.head) <= 0 ? [selection.anchor, selection.head] : [selection.head, selection.anchor];
        const text = editor.getRange(from2, to2);
        if (!text.trim()) {
          return null;
        }
        const view = this.findEditorView(markdownView);
        const fromOffset = editor.posToOffset(from2);
        const toOffset = editor.posToOffset(to2);
        const rect2 = view?.coordsAtPos(toOffset, 1) ?? view?.coordsAtPos(fromOffset, -1);
        if (!rect2 || !view) {
          return null;
        }
        const noteContext2 = buildSelectionContextWindow({
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
            left: rect2.left,
            top: rect2.top,
            right: rect2.right,
            bottom: rect2.bottom
          },
          from: from2,
          to: to2,
          fromOffset,
          toOffset,
          text,
          noteText,
          noteContext: noteContext2
        };
      }
      if (selections.length > 1) {
        this.noticeMultipleSelections();
        return null;
      }
      const domSelection2 = window.getSelection();
      if (domSelection2 && !domSelection2.isCollapsed && domSelection2.rangeCount === 1) {
        const view = this.findEditorView(markdownView);
        if (!view || !this.selectionBelongsToContainer(domSelection2, view.dom)) {
          return null;
        }
        const selectedText2 = domSelection2.toString().trim();
        if (!selectedText2) {
          return null;
        }
        const cursorOffset = editor.posToOffset(editor.getCursor());
        const sourceRange2 = findInlineEditSourceRange(noteText, selectedText2, cursorOffset);
        if (!sourceRange2) {
          return null;
        }
        const from2 = editor.offsetToPos(sourceRange2.fromOffset);
        const to2 = editor.offsetToPos(sourceRange2.toOffset);
        const rect2 = domSelection2.getRangeAt(0).getBoundingClientRect();
        const noteContext2 = buildSelectionContextWindow({
          noteText,
          fromOffset: sourceRange2.fromOffset,
          toOffset: sourceRange2.toOffset,
          selectedText: sourceRange2.targetText,
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
            left: rect2.left,
            top: rect2.top,
            right: rect2.right,
            bottom: rect2.bottom
          },
          from: from2,
          to: to2,
          fromOffset: sourceRange2.fromOffset,
          toOffset: sourceRange2.toOffset,
          text: sourceRange2.targetText,
          noteText,
          noteContext: noteContext2
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
      new import_obsidian.Notice("\u9605\u8BFB\u6A21\u5F0F\u9009\u533A\u6682\u65F6\u65E0\u6CD5\u6620\u5C04\u5230\u6E90\u7801\uFF0C\u8BF7\u5207\u6362\u5230\u6E90\u7801\u6A21\u5F0F\u540E\u518D\u8BD5\u3002");
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
  buildRequestContextFromSelection(action, context) {
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
  buildRequestContextFromCursor(action, editor, markdownView, file, cursor) {
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
  async startRequest(context) {
    this.cancelDraft();
    const view = this.findEditorView(context.markdownView);
    if (!view) {
      new import_obsidian.Notice("\u6CA1\u6709\u627E\u5230\u5F53\u524D\u7F16\u8F91\u5668\u89C6\u56FE\u3002");
      return;
    }
    const requestId = ++this.requestCounter;
    const draft = {
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
    const vaultNoteTitles = context.action.id === "wiki-link" ? this.getVaultNoteTitlesForWiki(context) : void 0;
    const prompt = buildInlineEditPrompt({
      action: context.action,
      targetText: context.action.mode === "note" ? "" : context.targetText,
      sourceText: context.sourceText,
      noteText: context.action.mode === "note" ? context.noteText : void 0,
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
      new import_obsidian.Notice(`Hermes inline edit \u5931\u8D25\uFF1A${message}`);
    } finally {
      if (this.currentDraft?.requestId === requestId) {
        this.currentCancel = null;
      }
    }
  }
  acceptDraft() {
    if (!this.currentDraft || !this.currentContext) {
      return;
    }
    const proposed = this.currentDraft.proposedText.trim();
    if (!proposed) {
      new import_obsidian.Notice("\u6CA1\u6709\u53EF\u63A5\u53D7\u7684 AI \u7ED3\u679C\u3002");
      return;
    }
    if (!this.isOriginalTextStillPresent(this.currentContext.editor)) {
      this.cancelDraft("\u539F\u6587\u5DF2\u53D8\u5316\uFF0C\u5DF2\u53D6\u6D88\u8FD9\u6B21\u9884\u89C8\u3002");
      return;
    }
    const editor = this.currentContext.editor;
    const from = editor.offsetToPos(this.currentDraft.fromOffset);
    const to = editor.offsetToPos(this.currentDraft.toOffset);
    this.clearDraft();
    editor.replaceRange(proposed, from, to, "+hermes-inline-accept");
  }
  cancelDraft(message) {
    if (this.currentCancel) {
      this.currentCancel();
      this.currentCancel = null;
    }
    this.clearDraft();
    if (message) {
      new import_obsidian.Notice(message);
    }
  }
  retryDraft() {
    if (!this.currentContext) {
      return;
    }
    void this.startRequest({ ...this.currentContext, currentProposal: this.currentDraft?.proposedText });
  }
  followUpDraft(text) {
    if (!this.currentContext || !text.trim()) {
      return;
    }
    void this.startRequest({
      ...this.currentContext,
      followUp: text.trim(),
      currentProposal: this.currentDraft?.proposedText
    });
  }
  clearDraft() {
    this.currentDraft = null;
    this.currentContext = null;
    this.currentCancel = null;
    this.pushDraftToView();
    this.currentView = null;
  }
  pushDraftToView() {
    if (!this.currentView) {
      return;
    }
    const draft = this.currentDraft;
    this.currentView.dispatch({
      effects: setInlineEditDraftEffect.of(
        draft ? {
          draft,
          anchor: draft.toOffset,
          onAccept: () => this.acceptDraft(),
          onCancel: () => this.cancelDraft(),
          onRetry: () => this.retryDraft(),
          onFollowUp: (text) => this.followUpDraft(text)
        } : null
      )
    });
  }
  findEditorView(markdownView) {
    try {
      const editorWithCm = markdownView.editor;
      const state = editorWithCm.cm?.state;
      const view = state?.field ? state.field(import_obsidian.editorEditorField, false) : null;
      if (view instanceof import_view.EditorView) {
        return view;
      }
    } catch {
    }
    const editorEl = markdownView.containerEl.querySelector(".cm-editor");
    return editorEl instanceof HTMLElement ? import_view.EditorView.findFromDOM(editorEl) : null;
  }
  selectionBelongsToContainer(selection, container) {
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    return Boolean(anchor && focus && container.contains(anchor) && container.contains(focus));
  }
  getVaultNoteTitlesForWiki(context) {
    const titles = this.options.app.vault.getMarkdownFiles().filter((file) => file.path !== context.file.path).map((file) => file.basename);
    return selectVaultNoteTitlesForWikiPrompt({
      titles,
      targetText: `${context.targetText}
${context.sourceText ?? ""}`,
      noteTitle: context.noteTitle,
      limit: 100
    });
  }
  async promptForCustomInstruction() {
    return new Promise((resolve2) => {
      const modal = new InlineEditCustomPromptModal(this.options.app, resolve2);
      modal.open();
    });
  }
  syncCurrentDraftFromView() {
    if (!this.currentView || !this.currentDraft) {
      return;
    }
    const payload = this.currentView.state.field(inlineEditDraftField, false);
    if (payload?.draft?.requestId === this.currentDraft.requestId) {
      this.currentDraft = payload.draft;
    }
  }
  isOriginalTextStillPresent(editor) {
    if (!this.currentDraft || this.currentContext?.mode === "insert" || this.currentContext?.mode === "note") {
      return true;
    }
    const from = editor.offsetToPos(this.currentDraft.fromOffset);
    const to = editor.offsetToPos(this.currentDraft.toOffset);
    return editor.getRange(from, to) === this.currentDraft.originalText;
  }
  noticeMultipleSelections() {
    const now = Date.now();
    if (now - this.lastMultiSelectionNoticeAt < 2400) {
      return;
    }
    this.lastMultiSelectionNoticeAt = now;
    new import_obsidian.Notice("\u8BF7\u9009\u62E9\u4E00\u6BB5\u8FDE\u7EED\u6587\u672C\u3002");
  }
};
var HermesInlineSlashSuggest = class extends import_obsidian.EditorSuggest {
  constructor(app, manager) {
    super(app);
    this.manager = manager;
    this.limit = 9;
  }
  onTrigger(cursor, editor, file) {
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
  getSuggestions(context) {
    return this.manager.getSlashSuggestions(context.query);
  }
  renderSuggestion(value, el) {
    el.addClass("hermes-inline-suggest-item");
    el.createDiv({ cls: "hermes-inline-suggest-title", text: value.label });
    el.createDiv({ cls: "hermes-inline-suggest-desc", text: value.description });
  }
  selectSuggestion(value) {
    if (!this.context) {
      return;
    }
    void this.manager.runSlashAction(value, this.context);
  }
};
var InlineEditCustomPromptModal = class {
  constructor(_app, resolve2) {
    this.didResolve = false;
    this.panelEl = null;
    this.inputEl = null;
    this.previouslyFocusedEl = null;
    this.outsideClickHandler = (event) => {
      if (!this.panelEl || !(event.target instanceof Node) || this.panelEl.contains(event.target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.dismiss(null);
    };
    this.keydownHandler = (event) => {
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
    this.resolve = resolve2;
  }
  open() {
    if (this.panelEl) {
      return;
    }
    this.previouslyFocusedEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.body.createDiv({ cls: "hermes-inline-custom-modal" });
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "false");
    dialog.setAttribute("aria-label", "\u81EA\u5B9A\u4E49\u63D0\u95EE");
    const header = dialog.createDiv({ cls: "hermes-inline-custom-header" });
    const titleWrap = header.createDiv({ cls: "hermes-inline-custom-title-wrap" });
    titleWrap.createEl("h2", { text: "\u81EA\u5B9A\u4E49\u63D0\u95EE" });
    titleWrap.createDiv({
      cls: "hermes-inline-custom-hint",
      text: "\u7528\u4E00\u53E5\u8BDD\u544A\u8BC9 Hermes \u4F60\u60F3\u600E\u4E48\u6539\u3002"
    });
    const closeButton = header.createEl("button", {
      cls: "hermes-inline-custom-close",
      text: "\xD7",
      attr: { type: "button", "aria-label": "\u5173\u95ED" }
    });
    const input = dialog.createEl("textarea", {
      cls: "hermes-inline-custom-input",
      attr: {
        rows: "5",
        placeholder: "\u6BD4\u5982\uFF1A\u6574\u7406\u6210\u66F4\u6709\u529B\u91CF\u7684 Markdown\uFF1B\u628A\u8868\u683C\u6539\u6210\u66F4\u6E05\u695A\u7684\u884C\u52A8\u6E05\u5355\uFF1B\u8BED\u6C14\u66F4\u51B7\u9759\u4E00\u70B9..."
      }
    });
    const actions = dialog.createDiv({ cls: "hermes-inline-custom-actions" });
    const cancel = actions.createEl("button", { text: "\u53D6\u6D88", attr: { type: "button" } });
    const submit = actions.createEl("button", {
      cls: "mod-cta",
      text: "\u751F\u6210\u9884\u89C8",
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
  dismiss(value) {
    this.finish(value);
    this.teardown();
  }
  teardown() {
    document.removeEventListener("pointerdown", this.outsideClickHandler, true);
    document.removeEventListener("keydown", this.keydownHandler, true);
    this.panelEl?.remove();
    this.panelEl = null;
    this.inputEl = null;
    this.previouslyFocusedEl?.focus({ preventScroll: true });
    this.previouslyFocusedEl = null;
  }
  finish(value) {
    if (this.didResolve) {
      return;
    }
    this.didResolve = true;
    this.resolve(value);
  }
};
var InlineProposalWidget = class _InlineProposalWidget extends import_view.WidgetType {
  constructor(payload) {
    super();
    this.payload = payload;
  }
  eq(other) {
    return other instanceof _InlineProposalWidget && other.payload.draft === this.payload.draft;
  }
  toDOM() {
    const draft = this.payload.draft;
    const root = document.createElement("span");
    root.className = `hermes-inline-proposal is-${draft?.status ?? "idle"}`;
    if (!draft) {
      return root;
    }
    if (draft.status === "generating") {
      root.createSpan({ cls: "hermes-inline-loading", text: "Hermes \u6B63\u5728\u751F\u6210..." });
      return root;
    }
    if (draft.status === "error") {
      root.createSpan({ cls: "hermes-inline-error", text: "\u751F\u6210\u5931\u8D25" });
      appendInlineControls(root, this.payload, true);
      return root;
    }
    root.createSpan({ cls: "hermes-inline-new-text", text: draft.proposedText || "(\u7A7A\u7ED3\u679C)" });
    appendInlineControls(root, this.payload, false);
    return root;
  }
};
function buildInlineEditDecorations(view) {
  const payload = view.state.field(inlineEditDraftField, false);
  if (!payload?.draft) {
    return import_view.Decoration.none;
  }
  const ranges = [];
  const draft = payload.draft;
  if (draft.status !== "generating" && draft.originalText && draft.fromOffset !== draft.toOffset) {
    ranges.push(
      import_view.Decoration.mark({
        class: "hermes-inline-original"
      }).range(draft.fromOffset, draft.toOffset)
    );
  }
  ranges.push(
    import_view.Decoration.widget({
      widget: new InlineProposalWidget(payload),
      side: 1
    }).range(payload.anchor)
  );
  return import_view.Decoration.set(ranges, true);
}
function buildInlineEditTooltip(payload) {
  return {
    pos: payload.anchor,
    above: true,
    clip: false,
    create() {
      const dom = document.createElement("div");
      dom.className = `hermes-inline-tooltip is-${payload.draft?.status ?? "idle"}`;
      if (payload.draft?.status === "generating") {
        dom.createSpan({ cls: "hermes-inline-tooltip-status", text: "\u751F\u6210\u4E2D" });
        return { dom };
      }
      if (payload.draft?.status === "error") {
        dom.createSpan({ cls: "hermes-inline-tooltip-status", text: "\u751F\u6210\u5931\u8D25" });
      }
      appendInlineControls(dom, payload, payload.draft?.status === "error");
      return { dom };
    }
  };
}
function appendInlineControls(root, payload, errorOnly) {
  const controls = root.createSpan({ cls: "hermes-inline-controls" });
  if (!errorOnly) {
    const accept = controls.createEl("button", {
      cls: "hermes-inline-control is-accept",
      text: "\u63A5\u53D7",
      attr: { type: "button" }
    });
    accept.addEventListener("mousedown", (event) => event.preventDefault());
    accept.addEventListener("click", payload.onAccept);
  }
  const cancel = controls.createEl("button", {
    cls: "hermes-inline-control",
    text: "\u64A4\u9500",
    attr: { type: "button" }
  });
  cancel.addEventListener("mousedown", (event) => event.preventDefault());
  cancel.addEventListener("click", payload.onCancel);
  const retry = controls.createEl("button", {
    cls: "hermes-inline-control",
    text: "\u91CD\u8BD5",
    attr: { type: "button" }
  });
  retry.addEventListener("mousedown", (event) => event.preventDefault());
  retry.addEventListener("click", payload.onRetry);
  if (!errorOnly) {
    const follow = controls.createEl("form", { cls: "hermes-inline-followup" });
    const input = follow.createEl("input", {
      type: "text",
      placeholder: "\u8FFD\u95EE\uFF1A\u518D\u77ED\u4E00\u70B9...",
      cls: "hermes-inline-followup-input"
    });
    const submit = follow.createEl("button", {
      cls: "hermes-inline-control is-followup",
      text: "\u8FFD\u95EE",
      attr: { type: "submit" }
    });
    submit.addEventListener("mousedown", (event) => event.preventDefault());
    follow.addEventListener("submit", (event) => {
      event.preventDefault();
      payload.onFollowUp(input.value);
    });
  }
}
function buildInlineSystemPrompt(basePrompt) {
  return [
    basePrompt.trim(),
    "You are Hermes inline edit inside Obsidian. Return only the replacement or insertion Markdown. No explanations, no code fences, no chat preface."
  ].filter(Boolean).join("\n\n");
}
function cleanInlineProposal(text) {
  return text.replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

// src/mermaid-helpers.ts
var MERMAID_FENCE_START = /^```mermaid\s*$/i;
var FENCE_END = /^```\s*$/;
async function collectMermaidValidationProblems(markdown, loadMermaidRuntime) {
  const fences = extractMermaidFences(markdown);
  if (fences.length === 0) {
    return [];
  }
  const runtime = await loadMermaidRuntime();
  const parse = runtime?.parse;
  const problems = [];
  for (const fence of fences) {
    if (!fence.closed) {
      problems.push({
        index: fence.index,
        code: fence.code,
        message: "Unclosed mermaid code fence."
      });
      continue;
    }
    if (typeof parse !== "function") {
      problems.push({
        index: fence.index,
        code: fence.code,
        message: "Mermaid runtime is unavailable."
      });
      continue;
    }
    try {
      await Promise.resolve(parse.call(runtime, fence.code));
    } catch (error) {
      problems.push({
        index: fence.index,
        code: fence.code,
        message: stringifyMermaidError(error)
      });
    }
  }
  return problems;
}
function extractMermaidFences(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const fences = [];
  let insideFence = false;
  let currentLines = [];
  let currentIndex = 0;
  for (const line of lines) {
    if (!insideFence) {
      if (MERMAID_FENCE_START.test(line.trim())) {
        insideFence = true;
        currentLines = [];
        currentIndex = fences.length;
      }
      continue;
    }
    if (FENCE_END.test(line.trim())) {
      fences.push({
        index: currentIndex,
        code: currentLines.join("\n").trim(),
        closed: true
      });
      insideFence = false;
      currentLines = [];
      continue;
    }
    currentLines.push(line);
  }
  if (insideFence) {
    fences.push({
      index: currentIndex,
      code: currentLines.join("\n").trim(),
      closed: false
    });
  }
  return fences;
}
function stringifyMermaidError(error) {
  if (error instanceof Error) {
    return error.message.trim() || error.name;
  }
  return String(error || "Unknown Mermaid parse error");
}

// src/wiki-link-helpers.ts
var CODE_FENCE_PATTERN = /```[\s\S]*?```/g;
var INLINE_CODE_PATTERN = /`[^`\n]*`/g;
var WIKI_LINK_PATTERN = /(!)?\[\[([^[\]]+)\]\]/g;
var ATTACHMENT_EXTENSIONS = /* @__PURE__ */ new Set([
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
function stripCodeBlocks(markdown) {
  return markdown.replace(CODE_FENCE_PATTERN, "").replace(INLINE_CODE_PATTERN, "");
}
function normalizeSlashes(value) {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}
function parseWikiLinkTarget(rawTarget) {
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
function looksLikeAttachment(linkpath) {
  const lower = linkpath.toLowerCase();
  const extensionMatch = /\.[^./]+$/.exec(lower);
  if (!extensionMatch) {
    return false;
  }
  const extension = extensionMatch[0];
  return extension !== ".md" && ATTACHMENT_EXTENSIONS.has(extension);
}
function buildMissingTargetPath(linkpath, sourcePath, pickParentFolder) {
  if (linkpath.toLowerCase().endsWith(".md")) {
    return normalizeSlashes(linkpath);
  }
  if (linkpath.includes("/")) {
    return normalizeSlashes(`${linkpath}.md`);
  }
  const parentFolder = normalizeSlashes(pickParentFolder(sourcePath, `${linkpath}.md`) || "");
  return normalizeSlashes(parentFolder ? `${parentFolder}/${linkpath}.md` : `${linkpath}.md`);
}
function collectMissingWikiLinkTargets(input) {
  const sanitized = stripCodeBlocks(String(input.markdown || ""));
  const targets = [];
  const seenPaths = /* @__PURE__ */ new Set();
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
var HERMES_CONTEXT_MODE_OPTIONS = [
  { label: "\u81EA\u52A8", value: "auto" },
  { label: "\u9009\u533A", value: "selection" },
  { label: "\u7B14\u8BB0", value: "note" },
  { label: "\u624B\u52A8", value: "manual" }
];
var DEFAULT_SYSTEM_PROMPT = [
  "\u4F60\u662F Hermes\uFF0C\u8FD0\u884C\u5728\u7528\u6237\u7684 Obsidian \u77E5\u8BC6\u5E93\u4E2D\u3002",
  "\u4F60\u7684\u6838\u5FC3\u804C\u8D23\u4E0D\u662F\u6CDB\u6CDB\u804A\u5929\uFF0C\u800C\u662F\u5E2E\u52A9\u7528\u6237\u628A\u60F3\u6CD5\u3001\u6587\u7AE0\u548C\u8D44\u6599\u6574\u7406\u6210\u53EF\u4EE5\u957F\u671F\u6C89\u6DC0\u3001\u7EE7\u7EED\u751F\u957F\u7684\u7B14\u8BB0\u3002",
  "",
  "\u5DE5\u4F5C\u54C1\u5473\uFF1A",
  "- \u5199\u4F5C\u8981\u81EA\u7136\u3001\u51C6\u786E\u3001\u6709\u7ED3\u6784\uFF0C\u8BFB\u8D77\u6765\u4E0D\u50CF AI \u62FC\u8D34\u3002",
  "- \u7ED3\u6784\u670D\u52A1\u7406\u89E3\uFF0C\u4E0D\u8981\u4E3A\u4E86\u683C\u5F0F\u800C\u683C\u5F0F\u5316\u3002",
  "- \u65B0\u589E\u5185\u5BB9\u8981\u80FD\u88AB\u672A\u6765\u7684\u81EA\u5DF1\u7EE7\u7EED\u4F7F\u7528\u3002",
  "- \u6982\u5FF5\u8FB9\u754C\u8981\u6E05\u695A\uFF0C\u94FE\u63A5\u8981\u6709\u610F\u4E49\uFF0C\u4E0D\u5236\u9020\u566A\u97F3\u3002",
  "- \u907F\u514D\u8FC7\u5EA6\u53D1\u6325\uFF1B\u7528\u6237\u8981\u7684\u662F\u7B14\u8BB0\u8D28\u91CF\uFF0C\u4E0D\u662F\u8868\u6F14\u3002",
  "",
  "\u6C9F\u901A\u65B9\u5F0F\uFF1A",
  "- \u9ED8\u8BA4\u7528\u81EA\u7136\u4E2D\u6587\uFF0C\u7B80\u6D01\u4F46\u4E0D\u8981\u51B7\u51B0\u51B0\u3002",
  "- \u80FD\u76F4\u63A5\u5B8C\u6210\u7684\u4E8B\u5C31\u76F4\u63A5\u5B8C\u6210\uFF0C\u4E0D\u628A\u5B9E\u73B0\u8D23\u4EFB\u63A8\u56DE\u7ED9\u7528\u6237\u3002",
  "- \u4F4E\u98CE\u9669\u4E0D\u786E\u5B9A\u65F6\u505A\u5408\u7406\u5047\u8BBE\u5E76\u7EE7\u7EED\uFF1B\u9AD8\u98CE\u9669\u9009\u62E9\u624D\u8BE2\u95EE\u7528\u6237\u3002",
  "- \u6700\u7EC8\u56DE\u7B54\u8981\u77ED\uFF0C\u8BF4\u660E\u505A\u4E86\u4EC0\u4E48\u3001\u662F\u5426\u5DF2\u5E94\u7528\u3001\u6709\u6CA1\u6709\u9700\u8981\u7528\u6237\u786E\u8BA4\u7684\u98CE\u9669\u3002",
  "",
  "Obsidian \u5199\u5165\u534F\u8BAE\uFF1A",
  "- \u5F53\u7528\u6237\u8981\u6C42\u4FEE\u6539\u3001\u91CD\u5199\u3001\u6DA6\u8272\u3001\u4F18\u5316\u3001\u8FFD\u52A0\u3001\u5220\u9664\uFF0C\u6216\u66F4\u6539\u5F53\u524D\u6253\u5F00\u7B14\u8BB0\u3001\u7528\u6237\u9AD8\u4EAE\u9009\u533A\u3001\u5F53\u524D\u7B14\u8BB0\u4E0A\u4E0B\u6587\u3001\u4EFB\u610F vault \u6587\u4EF6\u65F6\uFF0C\u5FC5\u987B\u7528\u6587\u4EF6\u5DE5\u5177\uFF08`patch` \u6216 `write_file`\uFF09\u771F\u6B63\u5199\u5165\u3002",
  "- \u7528\u6237\u8BF4\u201C\u8FD9\u7BC7\u201D\u201C\u5F53\u524D\u7B14\u8BB0\u201D\u201C\u9009\u4E2D\u7684\u6587\u5B57\u201D\u201C\u539F\u6587\u201D\u201C\u6539\u4E00\u4E0B\u201D\u201C\u4F18\u5316\u4E00\u4E0B\u201D\u201C\u6DA6\u8272\u201D\u7B49\uFF0C\u9ED8\u8BA4\u6307 Obsidian \u4E0A\u4E0B\u6587\u91CC\u7684 Current open note \u6216\u9009\u533A\uFF1B\u4F7F\u7528\u5176\u4E2D\u7684\u51C6\u786E\u8DEF\u5F84\u3002",
  "- \u4F18\u5148\u4F7F\u7528 `patch` \u505A\u5C40\u90E8\u7CBE\u51C6\u7F16\u8F91\uFF1B\u53EA\u6709\u6574\u7BC7\u91CD\u5199\u3001\u65B0\u5EFA\u6587\u4EF6\u3001\u6216\u5927\u6BB5\u7ED3\u6784\u91CD\u6392\u65F6\u624D\u4F7F\u7528 `write_file`\u3002",
  "- \u5199\u5165\u524D\u53D1\u9001\u4E00\u53E5\u7B80\u77ED\u8FDB\u5C55\uFF0C\u8BA9\u7528\u6237\u77E5\u9053\u4F60\u6B63\u5728\u5904\u7406\u54EA\u4E00\u90E8\u5206\uFF1B\u4E0D\u8981\u8F93\u51FA\u5DE5\u5177\u65E5\u5FD7\u3001\u5185\u90E8\u94FE\u8DEF\u6216\u9690\u85CF\u63A8\u7406\u3002",
  "- \u7528\u6237\u8981\u6C42\u6587\u4EF6\u7F16\u8F91\u65F6\uFF0C\u4E0D\u8981\u5728\u6700\u7EC8\u56DE\u7B54\u91CC\u7C98\u8D34\u5B8C\u6574\u91CD\u5199\u5185\u5BB9\uFF0C\u9664\u975E\u7528\u6237\u660E\u786E\u8981\u6C42\u3002",
  "- \u5199\u5165\u5B8C\u6210\u540E\uFF0C\u6700\u7EC8\u56DE\u7B54\u4FDD\u6301\u7B80\u77ED\uFF1A\u8BF4\u660E\u6539\u4E86\u4EC0\u4E48\u3001\u662F\u5426\u5DF2\u5E94\u7528\u3001\u6709\u6CA1\u6709\u9700\u8981\u7528\u6237\u786E\u8BA4\u7684\u98CE\u9669\u3002",
  "",
  "Obsidian \u5199\u4F5C\u89C4\u8303\uFF1A",
  "- Markdown \u5FC5\u987B\u80FD\u5728 Obsidian \u4E2D\u76F4\u63A5\u9605\u8BFB\u548C\u6E32\u67D3\uFF1B\u6807\u9898\u5C42\u7EA7\u6E05\u6670\uFF0C\u5217\u8868\u4E0D\u8981\u8FC7\u6DF1\uFF0C\u8868\u683C\u53EA\u5728\u786E\u5B9E\u63D0\u5347\u53EF\u8BFB\u6027\u65F6\u4F7F\u7528\u3002",
  "- Callout \u7528\u4E8E\u63D0\u9192\u3001\u603B\u7ED3\u3001\u8B66\u544A\u3001\u5F85\u529E\u6216\u5173\u952E\u89C2\u70B9\uFF0C\u4E0D\u8981\u6EE5\u7528\u3002",
  "- \u4E0D\u8981\u5F3A\u884C\u4F7F\u7528 Mermaid\u3002\u666E\u901A Markdown\u3001\u5217\u8868\u3001\u8868\u683C\u3001callout \u6216\u6B63\u6587\u8868\u8FBE\u66F4\u597D\u65F6\uFF0C\u5C31\u7528\u8FD9\u4E9B\u65B9\u5F0F\u3002",
  "- \u5982\u679C\u4EFB\u52A1\u6D89\u53CA Mermaid \u56FE\u8868\uFF0C\u8D77\u8349\u524D\u4F18\u5148\u67E5\u770B Obsidian/Mermaid \u76F8\u5173 skill\uFF0C\u4F8B\u5982 `obsidian-cli`\u3001`obsidian-markdown`\u3001`mermaid-visualizer`\u3002",
  "- \u5F53\u4F60\u786E\u5B9E\u9009\u62E9 Mermaid \u65F6\uFF0C\u56FE\u8868\u8981\u4FDD\u5B88\u3001\u7B80\u6D01\uFF0C\u5E76\u4E14\u80FD\u901A\u8FC7 Obsidian Mermaid \u8BED\u6CD5\u89E3\u6790\uFF1B\u4E0D\u786E\u5B9A\u80FD\u89E3\u6790\u65F6\u5C31\u7B80\u5316\u3002",
  "",
  "Wiki \u94FE\u63A5\u89C4\u8303\uFF1A",
  "- Wiki \u94FE\u63A5\u5E94\u8BE5\u6307\u5411\u53EF\u957F\u671F\u6C89\u6DC0\u7684\u6982\u5FF5\u3001\u4EBA\u7269\u3001\u9879\u76EE\u3001\u7406\u8BBA\u3001\u65B9\u6CD5\u6216\u4E3B\u9898\uFF0C\u4E0D\u8981\u94FE\u63A5\u666E\u901A\u8BCD\u3001\u6CDB\u8BCD\u3001\u4E00\u6B21\u6027\u8868\u8FBE\u3002",
  "- \u4E0D\u8981\u8FC7\u5EA6\u94FE\u63A5\u3002\u6BCF\u6BB5\u4F18\u5148\u94FE\u63A5 1-3 \u4E2A\u771F\u6B63\u6709\u4EF7\u503C\u7684\u6838\u5FC3\u6982\u5FF5\uFF1B\u540C\u4E00\u6982\u5FF5\u9996\u6B21\u51FA\u73B0\u94FE\u63A5\u5373\u53EF\u3002",
  "- \u53EA\u6709\u76EE\u6807\u7B14\u8BB0\u5DF2\u5B58\u5728\uFF0C\u6216\u4F60\u4F1A\u5728\u540C\u4E00\u6B21\u4EFB\u52A1\u4E2D\u521B\u5EFA\u5B83\uFF0C\u624D\u6DFB\u52A0\u65B0\u7684 `[[wiki]]`\u3002",
  "- \u5982\u679C\u5F15\u5165\u5168\u65B0\u7684 wiki \u94FE\u63A5\u6982\u5FF5\uFF0C\u5FC5\u987B\u5728\u540C\u4E00\u6B21\u5199\u5165\u6D41\u7A0B\u4E2D\u521B\u5EFA\u5BF9\u5E94 Markdown \u7B14\u8BB0\uFF0C\u8BA9\u5B83\u6210\u4E3A\u53EF\u7EE7\u7EED\u751F\u957F\u7684\u77E5\u8BC6\u79CD\u5B50\uFF0C\u800C\u4E0D\u662F\u7A7A\u58F3\u3002",
  "- \u9047\u5230\u53EF\u80FD\u91CD\u590D\u6216\u8FD1\u4E49\u7684\u6982\u5FF5\uFF0C\u4F18\u5148\u590D\u7528\u5DF2\u6709\u7B14\u8BB0\uFF1B\u4E0D\u8981\u5236\u9020\u540C\u4E49\u91CD\u590D\u7B14\u8BB0\u3002",
  "- \u4E0D\u8981\u7559\u4E0B\u6307\u5411\u672A\u521B\u5EFA\u7B14\u8BB0\u7684\u60AC\u7A7A wiki \u94FE\u63A5\u3002",
  "",
  "Skill \u4F7F\u7528\uFF1A",
  "- \u6D89\u53CA Obsidian \u6587\u4EF6\u3001Markdown\u3001Wiki\u3001\u5C5E\u6027\u3001callout\u3001embed\u3001Canvas\u3001Bases \u65F6\uFF0C\u4F18\u5148\u67E5\u770B\u76F8\u5173 Obsidian skill\uFF0C\u4E0D\u8981\u51ED\u8BB0\u5FC6\u786C\u5199\u590D\u6742\u8BED\u6CD5\u3002",
  "- \u6D89\u53CA Mermaid \u56FE\u8868\u65F6\uFF0C\u4F18\u5148\u67E5\u770B Mermaid/Obsidian \u56FE\u8868\u76F8\u5173 skill\u3002"
].join("\n");
var setHermesInlineWriteReviewEffect = import_state2.StateEffect.define();
var hermesInlineWriteReviewField = import_state2.StateField.define({
  create: () => import_view2.Decoration.none,
  update(decorations, transaction) {
    let nextDecorations = transaction.docChanged ? decorations.map(transaction.changes) : decorations;
    for (const effect of transaction.effects) {
      if (effect.is(setHermesInlineWriteReviewEffect)) {
        nextDecorations = buildHermesInlineWriteReviewDecorations(effect.value, transaction.state.doc);
      }
    }
    return nextDecorations;
  },
  provide: (field) => import_view2.EditorView.decorations.from(field)
});
function createHermesInlineWriteReviewExtension() {
  return [hermesInlineWriteReviewField];
}
var DEFAULT_SETTINGS = {
  hermesBinary: DEFAULT_HERMES_BINARY,
  provider: DEFAULT_PROVIDER,
  model: DEFAULT_MODEL,
  reasoningEffort: DEFAULT_REASONING_EFFORT,
  fallbackProvider: DEFAULT_FALLBACK_PROVIDER,
  fallbackModel: DEFAULT_FALLBACK_MODEL,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  pathPrefix: DEFAULT_HERMES_PATH_PREFIX,
  contextMode: "auto"
};
var HermesSidebarPlugin = class extends import_obsidian2.Plugin {
  constructor() {
    super(...arguments);
    this.inlineEditManager = null;
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
    this.inlineEditManager = new InlineEditManager({
      plugin: this,
      app: this.app,
      getSettings: () => ({
        provider: this.settings.provider,
        model: this.settings.model,
        reasoningEffort: this.settings.reasoningEffort,
        systemPrompt: this.settings.systemPrompt
      }),
      run: (input) => runInlineHermesBridge(this, input)
    });
    this.registerEditorExtension(createHermesInlineWriteReviewExtension());
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
        const sidebar = await this.activateView();
        sidebar.attachCurrentSelection();
      }
    });
    this.addCommand({
      id: "attach-current-note-to-hermes",
      name: "Attach current note to Hermes",
      callback: async () => {
        const sidebar = await this.activateView();
        await sidebar.attachCurrentArticle();
      }
    });
    this.addSettingTab(new HermesSidebarSettingTab(this.app, this));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        const markdownView = leaf?.view instanceof import_obsidian2.MarkdownView ? leaf.view : null;
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
    this.inlineEditManager?.destroy();
    this.inlineEditManager = null;
    await this.app.workspace.detachLeavesOfType(VIEW_TYPE_HERMES_SIDEBAR);
  }
  async loadSettings() {
    const rawData = await this.loadData();
    const persistedData = isPersistedDataShape(rawData) ? rawData : void 0;
    const legacySettings = isPlainObject(rawData) ? rawData : void 0;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, persistedData?.settings ?? legacySettings ?? {});
    this.settings.contextMode = normalizeContextMode(this.settings.contextMode);
    this.chatSessions = restoreSessions(persistedData?.sessions);
    this.activeSessionId = pickNextActiveSessionId(this.chatSessions, persistedData?.activeSessionId) ?? this.chatSessions[0]?.id ?? "";
  }
  async saveSettings() {
    await this.savePluginState();
  }
  getActiveMarkdownView() {
    return this.app.workspace.getActiveViewOfType(import_obsidian2.MarkdownView) ?? null;
  }
  getCurrentContextFile() {
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      return activeFile;
    }
    const mostRecentLeaf = this.app.workspace.getMostRecentLeaf();
    if (mostRecentLeaf?.view instanceof import_obsidian2.MarkdownView) {
      return mostRecentLeaf.view.file ?? null;
    }
    const markdownLeaf = this.app.workspace.getLeavesOfType("markdown")[0];
    if (markdownLeaf?.view instanceof import_obsidian2.MarkdownView) {
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
    const markdownView = this.getActiveMarkdownView();
    const file = this.getCurrentContextFile();
    const noteText = markdownView?.getViewData?.() ?? "";
    const selectionText = this.selectionSnapshot.trim();
    return {
      noteTitle: (file?.basename ?? this.lastActiveNoteTitle) || void 0,
      notePath: (file?.path ?? this.lastActiveNotePath) || void 0,
      selectionText: selectionText || void 0,
      noteContext: selectionText && noteText ? buildSelectionContextWindow({
        noteText,
        selectedText: selectionText,
        mode: markdownView?.getMode?.() ?? "source",
        preferredOffset: 0,
        windowLines: 6,
        maxCharacters: 1800
      }) : void 0
    };
  }
  async getCurrentArticleContext() {
    const file = this.getCurrentContextFile();
    if (!file) {
      return null;
    }
    const markdownView = this.getActiveMarkdownView();
    const noteText = markdownView?.file?.path === file.path ? markdownView.getViewData() : await this.app.vault.cachedRead(file);
    return {
      label: "\u5F53\u524D\u6587\u7AE0",
      content: [
        file.basename ? `Title: ${file.basename}` : "",
        file.path ? `Path: ${file.path}` : "",
        "```markdown",
        noteText || "(\u7A7A\u767D\u6587\u7AE0)",
        "```"
      ].filter(Boolean).join("\n")
    };
  }
  getCurrentSelectionContext() {
    const markdownView = this.getActiveMarkdownView();
    const selectedText = this.getCurrentSelectionText().trim() || this.selectionSnapshot.trim();
    if (!selectedText) {
      return null;
    }
    const noteText = markdownView?.getViewData?.() ?? "";
    const noteContext = noteText ? buildSelectionContextWindow({
      noteText,
      selectedText,
      mode: markdownView?.getMode?.() ?? "source",
      preferredOffset: 0,
      windowLines: 6,
      maxCharacters: 1800
    }) : "";
    return {
      label: "\u9009\u533A",
      content: [
        "Selected text:",
        "```text",
        selectedText,
        "```",
        noteContext ? "Nearby note context:" : "",
        noteContext ? "```text" : "",
        noteContext,
        noteContext ? "```" : ""
      ].filter(Boolean).join("\n")
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
    applySessionSnapshot(current, input, touch, Date.now());
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
  resolveWriteReviewMarkdownFile(reviewFilePath) {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const targetPath = resolveChatWriteReviewTargetPath(
      reviewFilePath,
      markdownFiles.map((file) => file.path),
      getVaultBasePath(this.app)
    );
    if (!targetPath) {
      return null;
    }
    return markdownFiles.find((file) => file.path === targetPath) ?? null;
  }
  async revealMarkdownFileForReview(file) {
    const existingLeaf = this.app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view instanceof import_obsidian2.MarkdownView && leaf.view.file?.path === file.path);
    if (existingLeaf?.view instanceof import_obsidian2.MarkdownView) {
      this.app.workspace.revealLeaf(existingLeaf);
      await this.ensureMarkdownReviewSourceMode(existingLeaf, file);
      return existingLeaf.view instanceof import_obsidian2.MarkdownView ? existingLeaf.view : null;
    }
    const markdownLeaf = this.app.workspace.getMostRecentLeaf()?.view instanceof import_obsidian2.MarkdownView ? this.app.workspace.getMostRecentLeaf() : this.app.workspace.getLeavesOfType("markdown")[0] ?? this.app.workspace.getLeaf("tab");
    if (!markdownLeaf) {
      return null;
    }
    await markdownLeaf.openFile(file, { active: true, state: { mode: "source" } });
    await this.ensureMarkdownReviewSourceMode(markdownLeaf, file);
    return markdownLeaf.view instanceof import_obsidian2.MarkdownView ? markdownLeaf.view : null;
  }
  async revealMarkdownFileByReviewPath(reviewFilePath) {
    const file = this.resolveWriteReviewMarkdownFile(reviewFilePath);
    if (!file) {
      return false;
    }
    const view = await this.revealMarkdownFileForReview(file);
    return Boolean(view);
  }
  async ensureMarkdownReviewSourceMode(leaf, file) {
    if (leaf.view instanceof import_obsidian2.MarkdownView && leaf.view.getMode() === "source") {
      await nextAnimationFrame();
      return;
    }
    await leaf.setViewState({
      type: "markdown",
      state: { file: file.path, mode: "source" },
      active: true
    });
    await nextAnimationFrame();
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
var HermesSidebarView = class extends import_obsidian2.ItemView {
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
    this.messageCounter = 0;
    this.queueCounter = 0;
    this.isHistoryOpen = false;
    this.shouldAutoStickToBottom = true;
    this.pendingBottomScrollFrame = null;
    this.pendingScrollRestoreFrame = null;
    this.suppressNextMessagesScroll = false;
    this.activityEntries = [];
    this.activityCounter = 0;
    this.expandedActivityMessageIds = /* @__PURE__ */ new Set();
    this.expandedActivityGroupIds = /* @__PURE__ */ new Set();
    this.activeInlineWriteReview = null;
    this.pendingInlineWriteFollowFrame = null;
    this.pendingWriteReviewReveal = null;
    this.pendingWikiAutoCreateReview = null;
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
    this.clearInlineWriteReview();
    if (this.pendingInlineWriteFollowFrame !== null) {
      window.cancelAnimationFrame(this.pendingInlineWriteFollowFrame);
      this.pendingInlineWriteFollowFrame = null;
    }
    this.pendingWriteReviewReveal = null;
    this.pendingWikiAutoCreateReview = null;
    this.expandedActivityMessageIds.clear();
    this.expandedActivityGroupIds.clear();
    this.pendingImages = [];
    this.containerEl.empty();
  }
  requestRefresh() {
    if (!this.liveContextEl) {
      this.render(false);
      return;
    }
    this.renderLiveContext();
    if (this.quickActionsEl?.isConnected) {
      this.renderQuickActions(this.quickActionsEl, () => this.imageFileInputEl?.click());
    }
  }
  isComposerFocused() {
    return !!this.inputEl && document.activeElement === this.inputEl;
  }
  attachContext(context) {
    this.pendingContexts.push(context);
    this.statusText = `\u5DF2\u9644\u52A0 ${context.label.toLowerCase()} \u4E0A\u4E0B\u6587`;
    this.render();
    new import_obsidian2.Notice(`\u5DF2\u6DFB\u52A0${context.label}\u3002`);
  }
  async attachCurrentArticle() {
    const context = await this.plugin.getCurrentArticleContext();
    if (!context) {
      new import_obsidian2.Notice("\u5F53\u524D\u6CA1\u6709\u53EF\u6DFB\u52A0\u7684\u6587\u7AE0\u3002");
      return;
    }
    this.pendingContexts.push(context);
    this.statusText = `\u5DF2\u6DFB\u52A0\u6587\u7AE0\uFF1A${this.plugin.getCurrentContextFile()?.basename ?? "\u5F53\u524D\u6587\u7AE0"}`;
    this.render(false);
  }
  attachCurrentSelection() {
    const context = this.plugin.getCurrentSelectionContext();
    if (!context) {
      new import_obsidian2.Notice("\u8BF7\u5148\u5728\u5F53\u524D\u6587\u7AE0\u91CC\u9009\u4E2D\u4E00\u6BB5\u6587\u5B57\u3002");
      return;
    }
    this.pendingContexts.push(context);
    this.plugin.clearSelectionSnapshot(false);
    this.statusText = "\u5DF2\u6DFB\u52A0\u9009\u533A";
    this.render(false);
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
    this.quickActionsEl = void 0;
    this.imageFileInputEl = void 0;
    this.contextModeSelectEl = void 0;
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
        new import_obsidian2.Notice("Stop the current reply before starting a new chat.");
        return;
      }
      this.stopActiveRun();
      this.pendingContexts = [];
      this.queuedTurns = [];
      this.activeStreamingMessageIndex = null;
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
          new import_obsidian2.Notice("Wait for the current reply to finish before switching chats.");
          return;
        }
        this.pendingContexts = [];
        this.queuedTurns = [];
        this.activeStreamingMessageIndex = null;
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
          new import_obsidian2.Notice("Stop the current run before deleting this chat.");
          return;
        }
        this.plugin.deleteSession(session.id);
        this.statusText = "\u5DF2\u5220\u9664\u5BF9\u8BDD";
        this.render();
      });
    }
    this.liveContextEl = root.createDiv({ cls: "hermes-sidebar-live-context" });
    this.renderLiveContext();
    this.renderHealthPanel(root);
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
        text: "\u624B\u52A8\u6DFB\u52A0\u6587\u7AE0\u3001\u9009\u533A\u6216\u56FE\u7247\uFF0C\u518D\u5411 Hermes \u63D0\u95EE\u3002"
      });
    } else {
      this.renderSessionMessages(activeSession.messages);
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
    this.inputEl.placeholder = "\u95EE\u95EE Hermes...";
    this.inputEl.addEventListener("input", () => {
      this.draftText = this.inputEl?.value ?? "";
    });
    this.inputEl.addEventListener("paste", (event) => {
      void this.handlePasteImages(event);
    });
    this.contextEl = shell.createDiv({ cls: "hermes-sidebar-context" });
    this.renderContextChips();
    const fileInput = shell.createEl("input", {
      type: "file",
      cls: "hermes-sidebar-file-input"
    });
    this.imageFileInputEl = fileInput;
    fileInput.accept = "image/*";
    fileInput.multiple = true;
    fileInput.addEventListener("change", () => {
      void this.handleFileInput(fileInput.files);
      fileInput.value = "";
    });
    this.quickActionsEl = shell.createDiv({ cls: "hermes-sidebar-quick-actions" });
    this.renderQuickActions(this.quickActionsEl, () => fileInput.click());
    const toolbar = shell.createDiv({ cls: "hermes-sidebar-composer-toolbar" });
    const controls = toolbar.createDiv({ cls: "hermes-sidebar-controls" });
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
    const contextModeControl = controls.createDiv({
      cls: "hermes-sidebar-control-group"
    });
    contextModeControl.createDiv({
      cls: "hermes-sidebar-control-label",
      text: "\u4E0A\u4E0B\u6587"
    });
    this.contextModeSelectEl = contextModeControl.createEl("select", {
      cls: "hermes-sidebar-select hermes-sidebar-context-mode-select"
    });
    for (const option of HERMES_CONTEXT_MODE_OPTIONS) {
      this.contextModeSelectEl.createEl("option", {
        value: option.value,
        text: option.label
      });
    }
    this.contextModeSelectEl.value = this.plugin.settings.contextMode;
    this.contextModeSelectEl.addEventListener("change", async (event) => {
      const select = event.currentTarget instanceof HTMLSelectElement ? event.currentTarget : this.contextModeSelectEl;
      const value = normalizeContextMode(select?.value);
      this.plugin.settings.contextMode = value;
      await this.plugin.saveSettings();
      this.statusText = `\u4E0A\u4E0B\u6587\u6A21\u5F0F\u5DF2\u5207\u5230 ${getContextModeDescription(value)}`;
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
      if (isComposerSendShortcut(event)) {
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
    this.liveContextEl.addClass("is-empty");
  }
  renderHealthPanel(root) {
    const details = root.createEl("details", { cls: "hermes-sidebar-health" });
    const summary = details.createEl("summary", { cls: "hermes-sidebar-health-summary" });
    summary.createSpan({ cls: "hermes-sidebar-health-title", text: "\u72B6\u6001" });
    const liveContext = this.lastTurnContextSnapshot?.liveContext ?? this.getActiveTurnLiveContext();
    const items = buildContextHealthItems({
      sessionId: this.plugin.getActiveSession().sessionId,
      contextMode: this.plugin.settings.contextMode,
      pendingContextCount: this.pendingContexts.length,
      pendingImageCount: this.pendingImages.length,
      queueCount: this.queuedTurns.length,
      liveContext,
      usage: this.lastUsage
    });
    const inputItem = items.find((item) => item.label === "Input");
    summary.createSpan({
      cls: "hermes-sidebar-health-pill",
      text: inputItem?.value ?? "\u7B49\u5F85\u4E0B\u4E00\u6B21\u56DE\u590D"
    });
    const grid = details.createDiv({ cls: "hermes-sidebar-health-grid" });
    for (const item of items) {
      const row = grid.createDiv({ cls: "hermes-sidebar-health-item" });
      row.createSpan({ cls: "hermes-sidebar-health-label", text: item.label });
      row.createSpan({ cls: "hermes-sidebar-health-value", text: item.value });
    }
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
        message.interim ? "is-interim" : "",
        message.kind,
        hasAttachments ? "has-attachments" : ""
      ].filter(Boolean).join(" ")
    });
    if (message.id) {
      row.dataset.hermesMessageId = message.id;
    }
    if (message.kind === "activity") {
      const activity = this.renderMessageActivityTimeline(row, message, {
        forceExpanded: options.forceExpandActivityTimeline,
        hideSummary: options.hideActivityTimelineSummary
      });
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
        message.interim ? "is-interim" : "",
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
  renderSessionMessages(messages) {
    if (!this.messagesEl) {
      return;
    }
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.kind === "activity") {
        const chain = this.collectActivityMessageChain(messages, index);
        if (chain.items.length > 0) {
          const isExpanded = this.expandedActivityGroupIds.has(chain.groupId);
          const isRunningChain = chain.items.some(
            (item) => item.message.pending || (item.message.activities ?? []).some((entry) => entry.status === "running")
          );
          const tailVisibleCount = getActivityChainTailVisibleCount(chain.items.map((item) => item.message));
          if (chain.items.length === 1) {
            const item = chain.items[0];
            this.renderAndTrackMessage(item.message, item.index);
            index = chain.endIndex;
            continue;
          }
          const visibility = getVisibleActivityMessages(
            chain.items.map((item) => item.message),
            isExpanded,
            tailVisibleCount,
            isRunningChain
          );
          const hiddenCount = visibility.hiddenCount;
          if (visibility.totalCount > 0 && (hiddenCount > 0 || isExpanded || !isRunningChain)) {
            this.renderActivityChainSummary(chain, visibility.totalCount, hiddenCount, isExpanded);
          }
          for (const item of chain.items) {
            if (!visibility.visibleMessages.includes(item.message)) {
              continue;
            }
            this.renderAndTrackMessage(item.message, item.index, {
              forceExpandActivityTimeline: isExpanded,
              hideActivityTimelineSummary: isExpanded
            });
          }
        }
        index = chain.endIndex;
        continue;
      }
      this.renderAndTrackMessage(message, index);
    }
  }
  renderAndTrackMessage(message, index, options = {}) {
    const rendered = this.renderChatMessage(message, {
      forceExpandActivityTimeline: options.forceExpandActivityTimeline,
      hideActivityTimelineSummary: options.hideActivityTimelineSummary
    });
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
  collectActivityMessageChain(messages, startIndex) {
    const items = [];
    let endIndex = startIndex;
    for (let index = startIndex; index < messages.length; index += 1) {
      const candidate = messages[index];
      if (candidate.kind !== "activity") {
        break;
      }
      endIndex = index;
      if (!this.hasVisibleActivities(candidate)) {
        continue;
      }
      items.push({ message: candidate, index });
    }
    const groupId = items[0]?.message.id ?? `activity-group-${startIndex}`;
    return { groupId, items, endIndex };
  }
  renderActivityChainSummary(chain, totalCount, hiddenCount, isExpanded) {
    if (!this.messagesEl) {
      return;
    }
    const row = this.messagesEl.createDiv({
      cls: "hermes-sidebar-chat-row hermes-sidebar-activity-group-row"
    });
    const summary = row.createDiv({
      cls: "hermes-sidebar-run-trace-summary hermes-sidebar-activity-group-summary"
    });
    summary.createDiv({
      cls: "hermes-sidebar-run-trace-summary-text",
      text: formatActivityTimelineSummary(totalCount, hiddenCount)
    });
    const toggle = summary.createEl("button", {
      cls: "hermes-sidebar-run-trace-toggle",
      attr: {
        type: "button",
        title: isExpanded ? "\u6536\u8D77\u8FD9\u6BB5\u8FC7\u7A0B\u94FE" : "\u5C55\u5F00\u8FD9\u6BB5\u8FC7\u7A0B\u94FE",
        "aria-label": isExpanded ? "\u6536\u8D77\u8FD9\u6BB5\u8FC7\u7A0B\u94FE" : "\u5C55\u5F00\u8FD9\u6BB5\u8FC7\u7A0B\u94FE"
      }
    });
    (0, import_obsidian2.setIcon)(toggle, "chevron-right");
    toggle.toggleClass("is-expanded", isExpanded);
    toggle.addEventListener("mousedown", (event) => event.preventDefault());
    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.setActivityGroupExpanded(chain.groupId, !isExpanded);
      this.render(false);
      this.scheduleMessagesToBottom();
    });
  }
  setActivityGroupExpanded(groupId, expanded) {
    if (!groupId) {
      return;
    }
    if (expanded) {
      this.expandedActivityGroupIds.add(groupId);
      return;
    }
    this.expandedActivityGroupIds.delete(groupId);
  }
  hasVisibleActivities(message) {
    return (message.activities ?? []).some(
      (entry) => isHermesActivityEntry(entry) && shouldShowActivityEntry(entry.toolName)
    );
  }
  renderMessageActivityTimeline(container, message, options = {}) {
    const activities = (message.activities ?? []).filter(
      (entry) => isHermesActivityEntry(entry) && shouldShowActivityEntry(entry.toolName)
    );
    if (activities.length === 0 || message.role !== "assistant") {
      return void 0;
    }
    const messageId = message.id;
    const isExpanded = options.forceExpanded || Boolean(messageId && this.expandedActivityMessageIds.has(messageId));
    const isRunning = message.pending || activities.some((entry) => entry.status === "running");
    const latestActivity = activities.length > 0 ? activities[activities.length - 1] : void 0;
    const tailVisibleCount = activities.length > 1 && latestActivity?.toolName === "thinking" ? 2 : 1;
    const visibility = getVisibleActivityTimelineEntries(activities, isExpanded, tailVisibleCount, isRunning);
    const trace = container.createDiv({
      cls: "hermes-sidebar-run-trace"
    });
    trace.toggleClass("is-running", isRunning);
    trace.toggleClass("is-expanded", isExpanded);
    trace.toggleClass("is-collapsed", !isExpanded);
    const shouldRenderSummary = !options.hideSummary && visibility.totalCount > 0 && (visibility.hiddenCount > 0 || isExpanded || !isRunning);
    if (shouldRenderSummary) {
      const summary = trace.createDiv({ cls: "hermes-sidebar-run-trace-summary" });
      summary.createDiv({
        cls: "hermes-sidebar-run-trace-summary-text",
        text: formatActivityTimelineSummary(visibility.totalCount, visibility.hiddenCount)
      });
      const toggle = summary.createEl("button", {
        cls: "hermes-sidebar-run-trace-toggle",
        attr: {
          type: "button",
          title: isExpanded ? "\u6536\u8D77\u8FD9\u6761\u8FC7\u7A0B\u94FE" : "\u5C55\u5F00\u8FD9\u6761\u8FC7\u7A0B\u94FE",
          "aria-label": isExpanded ? "\u6536\u8D77\u8FD9\u6761\u8FC7\u7A0B\u94FE" : "\u5C55\u5F00\u8FD9\u6761\u8FC7\u7A0B\u94FE"
        }
      });
      (0, import_obsidian2.setIcon)(toggle, "chevron-right");
      toggle.toggleClass("is-expanded", isExpanded);
      toggle.addEventListener("mousedown", (event) => event.preventDefault());
      toggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!messageId) {
          return;
        }
        this.setActivityTimelineExpanded(messageId, !isExpanded);
        this.refreshActivityMessage(message);
        this.scheduleMessagesToBottom();
      });
    }
    if (visibility.visibleEntries.length === 0) {
      return trace;
    }
    const list = trace.createDiv({ cls: "hermes-sidebar-run-steps" });
    for (const [index, entry] of visibility.visibleEntries.entries()) {
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
        } else if (entry.toolName === "write_trace") {
          const tracePreview = content.createDiv({
            cls: "hermes-sidebar-run-step-preview hermes-sidebar-write-trace-preview"
          });
          tracePreview.setText(entry.preview);
          this.renderWriteReviewActivityControls(content, entry);
        } else {
          content.createDiv({
            cls: "hermes-sidebar-run-step-preview",
            text: entry.preview
          });
        }
      }
      if (entry.toolName === "write_trace" && !entry.preview) {
        this.renderWriteReviewActivityControls(content, entry);
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
  renderWriteReviewActivityControls(container, entry) {
    const active = this.activeInlineWriteReview;
    if (entry.status !== "running" || entry.toolName !== "write_trace" || !active || active.approved) {
      return;
    }
    const requestId = entry.writeReview?.requestId ?? active.requestId;
    const controls = container.createDiv({ cls: "hermes-sidebar-write-review-actions" });
    const cancel = controls.createEl("button", {
      cls: "hermes-sidebar-write-review-button",
      text: "\u53D6\u6D88",
      attr: { type: "button" }
    });
    const approve = controls.createEl("button", {
      cls: "hermes-sidebar-write-review-button is-accept",
      text: "\u786E\u5B9A\u5199\u5165",
      attr: { type: "button" }
    });
    cancel.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.cancelInlineWriteReviewFromActivity(requestId);
    });
    approve.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.approveInlineWriteReviewFromActivity(requestId);
    });
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
  revealInlineActivityTimeline() {
    const target = this.getActiveActivityMessage();
    if (!target?.id) {
      return;
    }
    const groupId = this.getActivityGroupIdForMessage(target);
    if (groupId && !this.expandedActivityGroupIds.has(groupId)) {
      this.setActivityGroupExpanded(groupId, true);
    }
    const activities = (target.activities ?? []).filter(
      (entry) => isHermesActivityEntry(entry) && shouldShowActivityEntry(entry.toolName)
    );
    const isExpanded = this.expandedActivityMessageIds.has(target.id);
    const isRunning = target.pending || activities.some((entry) => entry.status === "running");
    const visibility = getVisibleActivityTimelineEntries(activities, isExpanded, 1, isRunning);
    if (!isExpanded && visibility.hiddenCount > 0) {
      this.setActivityTimelineExpanded(target.id, true);
      this.render(false);
      this.scheduleMessagesToBottom();
      return;
    }
    if (!isExpanded) {
      this.setActivityTimelineExpanded(target.id, true);
      this.refreshActivityMessage(target);
      this.scheduleMessagesToBottom();
      return;
    }
    if (!this.activityTimelineEl?.isConnected) {
      this.render(false);
    }
    this.scheduleMessagesToBottom();
  }
  settleInlineActivityTimeline() {
    const target = this.getActiveActivityMessage();
    if (target?.role === "assistant" && target.kind === "activity") {
      this.settleActivityMessage(target);
      this.refreshActivityMessage(target);
      this.persistActiveSession(false);
    }
    this.refreshLastAssistantHistoryContent();
  }
  setActivityTimelineExpanded(messageId, expanded) {
    if (!messageId) {
      return;
    }
    if (expanded) {
      this.expandedActivityMessageIds.add(messageId);
      return;
    }
    this.expandedActivityMessageIds.delete(messageId);
  }
  getActivityGroupIdForMessage(target) {
    const messages = this.plugin.getActiveSession().messages;
    const targetIndex = messages.findIndex((message) => message.id === target.id);
    if (targetIndex < 0) {
      return void 0;
    }
    let groupStartIndex = targetIndex;
    for (let index = targetIndex; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate.kind !== "activity") {
        break;
      }
      if (this.hasVisibleActivities(candidate)) {
        groupStartIndex = index;
      }
    }
    return messages[groupStartIndex]?.id ?? target.id;
  }
  async renderMarkdownInto(container, content) {
    container.empty();
    await import_obsidian2.MarkdownRenderer.render(this.app, content, container, "", this);
    this.scheduleMessagesToBottom();
  }
  async renderStreamingMarkdownInto(container, content) {
    const token = ++this.streamingRenderToken;
    const scratch = document.createElement("div");
    await import_obsidian2.MarkdownRenderer.render(this.app, content, scratch, "", this);
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
      chip.createSpan({
        cls: "hermes-sidebar-chip-prefix",
        text: "\u5DF2\u6DFB\u52A0"
      });
      chip.createSpan({
        cls: "hermes-sidebar-chip-value",
        text: context.label
      });
      const remove = chip.createEl("button", {
        cls: "hermes-sidebar-chip-remove",
        text: "x"
      });
      remove.addEventListener("click", () => {
        this.pendingContexts.splice(index, 1);
        this.render(false);
      });
    }
    for (const image of this.pendingImages) {
      const chip = this.contextEl.createDiv({
        cls: "hermes-sidebar-image-chip"
      });
      chip.createSpan({
        cls: "hermes-sidebar-chip-prefix",
        text: "\u56FE\u7247"
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
  renderQuickActions(container, openImagePicker) {
    container.empty();
    const liveContext = this.plugin.getLiveContextInfo();
    const selectedText = liveContext.selectionText ?? "";
    const hasSelection = !!selectedText;
    const title = container.createDiv({
      cls: "hermes-sidebar-quick-actions-title",
      text: hasSelection ? `\u9009\u533A\u5DF2\u5C31\u7EEA \xB7 ${summarizeSelectionLength(selectedText)}` : "\u5FEB\u6377\u64CD\u4F5C"
    });
    const actions = container.createDiv({ cls: "hermes-sidebar-quick-actions-list" });
    const addAction = (label, icon, onClick, options = {}) => {
      const button = actions.createEl("button", {
        cls: "hermes-sidebar-quick-action",
        attr: {
          type: "button",
          title: options.title ?? label,
          "aria-label": label
        }
      });
      button.disabled = !!options.disabled;
      button.toggleClass("is-active", !!options.active);
      const iconEl = button.createSpan({ cls: "hermes-sidebar-quick-action-icon" });
      (0, import_obsidian2.setIcon)(iconEl, icon);
      button.createSpan({
        cls: "hermes-sidebar-quick-action-label",
        text: label
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        if (button.disabled) {
          return;
        }
        onClick();
      });
      return button;
    };
    const currentFile = this.plugin.getCurrentContextFile();
    const articleLabel = currentFile?.basename ? `\u6DFB\u52A0\u6587\u7AE0\uFF1A${currentFile.basename}` : "\u6DFB\u52A0\u5F53\u524D\u6587\u7AE0";
    addAction("\u6587\u7AE0", "file-text", () => void this.attachCurrentArticle(), {
      disabled: !currentFile,
      title: articleLabel
    });
    addAction("\u9009\u533A", "text-select", () => this.attachCurrentSelection(), {
      disabled: !hasSelection,
      title: hasSelection ? `\u53D1\u9001\u65F6\u81EA\u52A8\u9644\u52A0\uFF1A${formatSelectionPreview(selectedText, 64)}` : "\u9009\u4E2D\u6B63\u6587\u540E\u81EA\u52A8\u9644\u52A0\u9009\u533A",
      active: hasSelection
    });
    addAction("\u56FE\u7247", "image-plus", openImagePicker, {
      title: "\u6DFB\u52A0\u56FE\u7247"
    });
    addAction(
      "\u6E05\u7A7A",
      "eraser",
      () => {
        this.clearPendingAttachments();
      },
      {
        disabled: this.pendingContexts.length === 0 && this.pendingImages.length === 0,
        title: "\u6E05\u7A7A\u5DF2\u6DFB\u52A0\u5185\u5BB9"
      }
    );
    title.toggleClass("is-muted", !hasSelection && this.pendingContexts.length === 0 && this.pendingImages.length === 0);
  }
  removePendingImage(imageId) {
    const index = this.pendingImages.findIndex((image) => image.id === imageId);
    if (index === -1) {
      return;
    }
    const [removed] = this.pendingImages.splice(index, 1);
    cleanupAttachmentFile(removed.path);
    this.render(false);
  }
  clearPendingAttachments() {
    for (const image of this.pendingImages) {
      cleanupAttachmentFile(image.path);
    }
    this.pendingContexts = [];
    this.pendingImages = [];
    this.statusText = "\u5DF2\u6E05\u7A7A\u624B\u52A8\u6DFB\u52A0\u5185\u5BB9";
    this.render(false);
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
  getActiveTurnLiveContext() {
    const liveContext = this.plugin.getLiveContextInfo();
    return pickLiveContextForMode(liveContext, this.plugin.settings.contextMode);
  }
  nextMessageId(prefix) {
    return `${prefix}-${Date.now()}-${++this.messageCounter}`;
  }
  getConversationHistory() {
    return this.plugin.getActiveSession().messages.filter((message) => !message.interim && message.kind !== "progress" && message.kind !== "activity").map((message) => ({
      role: message.role,
      content: message.historyContent?.trim() || message.content
    }));
  }
  appendInterimAssistantMessage(content) {
    const text = content.trim();
    if (!text) {
      return;
    }
    if (looksLikeInternalReasoningText(text)) {
      this.pushActivityEntry({
        type: "activity",
        eventType: "_thinking",
        status: "running",
        toolName: "thinking",
        preview: text
      });
      return;
    }
    const session = this.plugin.getActiveSession();
    const insertIndex = getAppendIndexAfterTurnMessages(session.messages, this.activeTurnUserMessageId);
    const previousMessage = insertIndex > 0 ? session.messages[insertIndex - 1] : void 0;
    if (previousMessage?.role === "assistant" && previousMessage.kind === "final" && previousMessage.interim && previousMessage.content.trim() === text) {
      return;
    }
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
    this.render(false);
    this.scheduleMessagesToBottom();
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
    if (toolName === "thinking") {
      const latestThinking = [...this.activityEntries].reverse().find((entry2) => entry2.toolName === "thinking");
      if (latestThinking?.status === status && latestThinking.preview === preview) {
        return;
      }
    }
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
    if (toolName === "write_trace" && this.activeInlineWriteReview && status === "running") {
      const review = this.activeInlineWriteReview.review;
      entry.writeReview = {
        requestId: review.requestId,
        title: review.title,
        meta: review.meta,
        filePath: review.filePath
      };
    }
    if (existingIndex >= 0) {
      const mergedEntry = {
        ...this.activityEntries[existingIndex],
        ...entry,
        id: this.activityEntries[existingIndex].id,
        writeReview: entry.writeReview ?? this.activityEntries[existingIndex].writeReview
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
    const refreshed = this.rerenderActivityMessage(target);
    if (!refreshed) {
      this.activityMessageRef = void 0;
      this.activityRowEl = void 0;
      this.activityBubbleEl = void 0;
      this.activityTimelineEl = void 0;
      this.render(false);
    }
    this.persistActiveSession(false);
    this.scheduleMessagesToBottom();
  }
  rerenderActivityMessage(target) {
    if (target.kind !== "activity" || target.role !== "assistant") {
      return false;
    }
    let row = this.activityRowEl?.isConnected && this.activityMessageRef?.id === target.id ? this.activityRowEl : void 0;
    if (!row && target.id) {
      row = this.findRenderedMessageRow(target) ?? void 0;
    }
    if (!row) {
      return false;
    }
    row.empty();
    const rendered = this.renderMessageActivityTimeline(row, target, {
      forceExpanded: Boolean(target.id && this.expandedActivityMessageIds.has(target.id)),
      hideSummary: Boolean(target.id && this.expandedActivityMessageIds.has(target.id))
    });
    if (!rendered) {
      return false;
    }
    this.activityMessageRef = target;
    this.activityRowEl = row;
    this.activityBubbleEl = row;
    this.activityTimelineEl = rendered;
    return true;
  }
  setFallbackStatus(text) {
    if (!this.statusText || !this.activityEntries.length) {
      this.statusText = text;
    }
  }
  handleInlineWriteTraceEvent(event) {
    if (event.eventType === "write.review.done") {
      void this.finalizePendingWikiAutoCreate(event.requestId);
      void this.revealPendingWriteReviewTarget(event.requestId, event.filePath);
    }
    const state = this.activeInlineWriteReview;
    if (!state) {
      return;
    }
    switch (event.eventType) {
      case "write.review.approved":
        this.setInlineWriteReviewPhase(state.requestId, "writing");
        break;
      case "write.review.done":
        this.setInlineWriteReviewPhase(state.requestId, "done");
        break;
      case "write.review.cancel":
        this.setInlineWriteReviewPhase(state.requestId, "cancelled");
        break;
      case "write.preview.review":
        if (state.phase === "previewing") {
          this.setInlineWriteReviewPhase(state.requestId, "awaiting_approval");
        }
        break;
      default:
        break;
    }
  }
  rememberPendingWriteReviewReveal(review, resolvedTargetPath) {
    if (!shouldAutoRevealWriteReviewTarget(review.filePath, resolvedTargetPath)) {
      return;
    }
    const filePath = review.filePath?.trim();
    if (!filePath) {
      return;
    }
    this.pendingWriteReviewReveal = {
      requestId: review.requestId,
      filePath
    };
  }
  rememberPendingWikiAutoCreateReview(review) {
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const filePaths = listChatWriteReviewMarkdownTargets(
      review,
      markdownFiles.map((file) => file.path),
      getVaultBasePath(this.app)
    );
    if (filePaths.length === 0) {
      this.pendingWikiAutoCreateReview = null;
      return;
    }
    this.pendingWikiAutoCreateReview = {
      requestId: review.requestId,
      filePaths
    };
  }
  async revealPendingWriteReviewTarget(requestId, eventFilePath) {
    const pending = this.pendingWriteReviewReveal;
    if (!pending) {
      return;
    }
    if (requestId && pending.requestId !== requestId) {
      return;
    }
    const targetPath = eventFilePath?.trim() || pending.filePath;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const revealed = await this.plugin.revealMarkdownFileByReviewPath(targetPath);
      if (revealed) {
        this.pendingWriteReviewReveal = null;
        return;
      }
      await new Promise((resolve2) => window.setTimeout(resolve2, 120));
    }
  }
  async finalizePendingWikiAutoCreate(requestId) {
    const pending = this.pendingWikiAutoCreateReview;
    if (!pending) {
      return;
    }
    if (requestId && pending.requestId !== requestId) {
      return;
    }
    this.pendingWikiAutoCreateReview = null;
    const createdPaths = /* @__PURE__ */ new Set();
    for (const filePath of pending.filePaths) {
      const created = await this.ensureWikiLinksExistForFile(filePath, createdPaths);
      created.forEach((path) => createdPaths.add(path));
    }
    if (createdPaths.size > 0) {
      this.statusText = `\u5DF2\u81EA\u52A8\u8865\u5EFA ${createdPaths.size} \u7BC7 Wiki \u6587\u7AE0`;
      new import_obsidian2.Notice(`Hermes \u5DF2\u81EA\u52A8\u8865\u5EFA ${createdPaths.size} \u7BC7 Wiki \u6587\u7AE0`);
    }
  }
  async ensureWikiLinksExistForFile(filePath, createdPaths) {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof import_obsidian2.TFile) || file.extension !== "md") {
      return [];
    }
    const markdownView = this.plugin.getActiveMarkdownView();
    const markdown = markdownView?.file?.path === file.path ? markdownView.getViewData() : await this.app.vault.cachedRead(file);
    const missingTargets = collectMissingWikiLinkTargets({
      markdown,
      sourcePath: file.path,
      resolveExisting: (linkpath) => Boolean(this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path)),
      pickParentFolder: (sourcePath, newFilePath) => this.app.fileManager.getNewFileParent(sourcePath, newFilePath).path
    });
    const created = [];
    for (const target of missingTargets) {
      const normalizedTargetPath = (0, import_obsidian2.normalizePath)(target.filePath);
      if (createdPaths.has(normalizedTargetPath) || this.app.vault.getAbstractFileByPath(normalizedTargetPath)) {
        continue;
      }
      await this.ensureParentFolderExists(normalizedTargetPath);
      await this.app.vault.create(normalizedTargetPath, this.buildAutoCreatedWikiNote(target.title, file));
      created.push(normalizedTargetPath);
    }
    return created;
  }
  async ensureParentFolderExists(filePath) {
    const normalizedFilePath = (0, import_obsidian2.normalizePath)(filePath);
    const parts = normalizedFilePath.split("/");
    parts.pop();
    let currentPath = "";
    for (const part of parts) {
      if (!part) {
        continue;
      }
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      if (this.app.vault.getAbstractFileByPath(currentPath)) {
        continue;
      }
      await this.app.vault.createFolder(currentPath);
    }
  }
  buildAutoCreatedWikiNote(title, sourceFile) {
    return [`# ${title}`, "", `> \u7531 Hermes \u5728 [[${sourceFile.basename}]] \u4E2D\u81EA\u52A8\u521B\u5EFA\u3002`, "", "\u5F85\u8865\u5145\u3002"].join("\n");
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
  formatConnectionStatus(sessionId, usage) {
    return formatBridgeConnectionStatus(sessionId, usage);
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
        if (looksLikeInternalReasoningText(target.content)) {
          this.pushActivityEntry({
            type: "activity",
            eventType: "_thinking",
            status: "running",
            toolName: "thinking",
            preview: target.content
          });
          session.messages.splice(this.activeStreamingMessageIndex, 1);
          this.activeStreamingMessageIndex = null;
          this.persistActiveSession(false);
          this.render(false);
          return;
        }
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
    const normalizedFinalText = finalText?.trim() ?? "";
    if (normalizedFinalText && looksLikeInternalReasoningText(normalizedFinalText)) {
      this.convertActiveStreamToProgress();
      this.pushActivityEntry({
        type: "activity",
        eventType: "_thinking",
        status: "done",
        toolName: "thinking",
        preview: normalizedFinalText
      });
      return;
    }
    if (this.activeStreamingMessageIndex === null) {
      const content = finalText?.trim() || "(Hermes returned an empty response.)";
      const message = {
        id: this.nextMessageId("assistant"),
        role: "assistant",
        kind: "final",
        content,
        historyContent: buildReplayAssistantContent({
          finalText: content,
          activities: this.activityEntries
        }),
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
    target.historyContent = buildReplayAssistantContent({
      finalText: target.content,
      activities: this.activityEntries
    });
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
  refreshLastAssistantHistoryContent() {
    const session = this.plugin.getActiveSession();
    for (let index = session.messages.length - 1; index >= 0; index -= 1) {
      const message = session.messages[index];
      if (message.role !== "assistant" || message.kind !== "final" || message.interim) {
        continue;
      }
      message.historyContent = buildReplayAssistantContent({
        finalText: message.content,
        activities: this.activityEntries
      });
      return;
    }
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
      new import_obsidian2.Notice("Type a message or attach an image first.");
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
    this.lastTurnContextSnapshot = {
      mode: this.plugin.settings.contextMode,
      liveContext: turn.liveContext,
      pendingContextCount: turn.contexts.length,
      pendingImageCount: turn.images.length,
      queueCount: this.queuedTurns.length
    };
    this.queuedTurns.push(turn);
    this.pendingContexts = [];
    this.pendingImages = [];
    this.draftText = "";
    this.inputEl.value = "";
    if (turn.liveContext.selectionText) {
      this.plugin.clearSelectionSnapshot(false);
    }
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
      content: turn.userText,
      historyContent: buildReplayUserContent({
        userText: turn.userText,
        contexts: turn.contexts,
        liveContext: turn.liveContext,
        imageNames: turn.images.map((image) => image.name)
      })
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
    this.expandedActivityMessageIds.clear();
    this.expandedActivityGroupIds.clear();
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
        workspaceCwd: getVaultBasePath(this.app),
        onWriteReview: (review) => this.confirmChatWriteReview(review),
        onEvent: (event) => {
          if (canUpdateBridgeEventWithoutFullRender(event.type)) {
            if (event.type === "status") {
              if (this.activityEntries.length === 0 || isDetailedStatusText(event.text || "")) {
                this.statusText = event.text || this.statusText;
              }
              return;
            }
            if (event.type === "activity" || event.type === "write_trace") {
              if (event.type === "write_trace") {
                this.handleInlineWriteTraceEvent(event);
              }
              this.pushActivityEntry(event);
              const activityText = this.formatActivityText(event);
              if (activityText && event.eventType !== "run.config") {
                this.statusText = activityText;
              }
              return;
            }
            if (event.type === "progress") {
              if (event.text) {
                this.appendInterimAssistantMessage(event.text);
                this.statusText = `\u6B63\u5728\u5904\u7406\uFF1A${formatSelectionPreview(event.text, 72)}`;
              }
              return;
            }
            const target = this.ensureStreamingFinalMessage();
            target.content += event.text || "";
            target.pending = true;
            this.queueStreamingMessageRender(target);
            return;
          }
          if (event.type === "segment_break") {
            this.convertActiveStreamToProgress();
            this.setFallbackStatus("Hermes \u6B63\u5728\u7EE7\u7EED\u5904\u7406");
            this.scrollMessagesToBottom();
            return;
          }
          if (event.type === "final") {
            if (event.sessionId) {
              session.sessionId = event.sessionId;
            }
            this.lastUsage = event.usage;
            this.finalizeActiveStream(event.text);
            this.settleInlineActivityTimeline();
            this.activeStreamingMessageIndex = null;
            hasFinalized = true;
            this.statusText = this.formatConnectionStatus(session.sessionId, event.usage);
            this.scheduleMessagesToBottom();
          }
        }
      });
      this.activeRunCancel = run.cancel;
      const result = await run.promise;
      if (result.sessionId) {
        session.sessionId = result.sessionId;
      }
      this.lastUsage = result.usage;
      if (!hasFinalized) {
        this.finalizeActiveStream(result.text);
        this.settleInlineActivityTimeline();
        this.activeStreamingMessageIndex = null;
        hasFinalized = true;
      }
      this.persistActiveSession();
      this.statusText = this.formatConnectionStatus(session.sessionId, result.usage);
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
        new import_obsidian2.Notice("Hermes request failed. Check the sidebar for details.");
      }
    } finally {
      this.activeTurnUserMessageId = void 0;
      this.activeActivityMessageId = void 0;
      for (const image of turn.images) {
        cleanupAttachmentFile(image.path);
      }
      this.activeRunCancel = void 0;
      this.isSending = false;
      this.settleInlineActivityTimeline();
      this.scheduleMessagesToBottom();
    }
  }
  stopActiveRun() {
    if (!this.isSending || !this.activeRunCancel) {
      return;
    }
    this.statusText = "\u6B63\u5728\u505C\u6B62\u5F53\u524D\u4EFB\u52A1";
    this.activeRunCancel();
  }
  approveInlineWriteReviewFromActivity(requestId) {
    const state = this.activeInlineWriteReview;
    if (!state || state.requestId !== requestId || state.approved) {
      return;
    }
    this.statusText = "\u5DF2\u786E\u8BA4\uFF0C\u6B63\u5728\u5199\u5165\u6587\u4EF6";
    state.decisionSent = true;
    state.resolveResult?.({ approved: true });
    state.resolveResult = void 0;
    this.refreshActiveWriteReviewActivityControls();
  }
  cancelInlineWriteReviewFromActivity(requestId) {
    const state = this.activeInlineWriteReview;
    if (!state || state.requestId !== requestId) {
      return;
    }
    this.statusText = "\u5DF2\u53D6\u6D88\u8FD9\u6B21\u5199\u5165";
    state.decisionSent = true;
    state.appliedInEditor = true;
    state.resolveResult?.({ approved: false });
    state.resolveResult = void 0;
    this.clearInlineWriteReview();
    this.refreshActiveWriteReviewActivityControls();
  }
  refreshActiveWriteReviewActivityControls() {
    const active = this.activeInlineWriteReview;
    const session = this.plugin.getActiveSession();
    const target = (active ? [...session.messages].reverse().find(
      (message) => message.kind === "activity" && message.role === "assistant" && (message.activities ?? []).some(
        (entry) => entry.toolName === "write_trace" && entry.status === "running"
      )
    ) : void 0) ?? this.getActiveActivityMessage();
    if (target) {
      this.refreshActivityMessage(target);
    }
  }
  async confirmChatWriteReview(review) {
    const inlinePreview = buildChatWriteReviewInlinePreview(review);
    const targetFile = inlinePreview ? this.plugin.resolveWriteReviewMarkdownFile(inlinePreview.filePath) : null;
    const validation = await this.buildWriteReviewValidation(review, inlinePreview, targetFile?.path);
    this.rememberPendingWriteReviewReveal(review, targetFile?.path ?? null);
    this.rememberPendingWikiAutoCreateReview(review);
    if (inlinePreview && targetFile) {
      const markdownView = await this.plugin.revealMarkdownFileForReview(targetFile);
      const editorView = markdownView ? findEditorView(markdownView) : null;
      if (markdownView && editorView) {
        return this.confirmInlineChatWriteReview(markdownView, editorView, review, inlinePreview, targetFile.path);
      }
    }
    this.statusText = `\u7B49\u5F85\u786E\u8BA4\u5199\u5165 ${(0, import_node_path.basename)(review.filePath || "\u6587\u4EF6")}`;
    return new Promise((resolve2) => {
      const modal = new HermesWriteReviewModal(this.app, this.plugin, review, validation, (approved) => {
        if (!approved) {
          this.statusText = "\u5DF2\u53D6\u6D88\u8FD9\u6B21\u5199\u5165";
        }
        resolve2({ approved });
      });
      modal.open();
    });
  }
  async buildWriteReviewValidation(review, inlinePreview, resolvedTargetPath) {
    const mermaidProblems = inlinePreview && resolvedTargetPath ? await this.validateMermaidForInlineReview(inlinePreview, resolvedTargetPath) : [];
    return { mermaidProblems };
  }
  async validateMermaidForInlineReview(preview, resolvedTargetPath) {
    const file = this.app.vault.getAbstractFileByPath(resolvedTargetPath);
    if (!(file instanceof import_obsidian2.TFile) || file.extension !== "md") {
      return [];
    }
    const markdownView = this.plugin.resolveWriteReviewMarkdownFile(preview.filePath) ? this.plugin.getActiveMarkdownView() : null;
    const originalText = markdownView?.file?.path === file.path ? markdownView.getViewData() : await this.app.vault.cachedRead(file);
    const nextText = buildChatWriteReviewDocumentFrame(
      preview,
      originalText,
      getChatWriteReviewTotalAddedCharacters(preview)
    ).text;
    return collectMermaidValidationProblems(nextText, async () => (0, import_obsidian2.loadMermaid)());
  }
  async confirmInlineChatWriteReview(markdownView, editorView, review, preview, sourcePath) {
    this.statusText = `\u5728\u539F\u6587\u4E2D\u786E\u8BA4 ${(0, import_node_path.basename)(review.filePath || "\u6587\u4EF6")}`;
    const firstLine = Math.max(1, Math.min(editorView.state.doc.lines, preview.firstLine + 1));
    editorView.dispatch({
      selection: { anchor: editorView.state.doc.line(firstLine).from },
      scrollIntoView: true
    });
    this.startInlineWriteReview(markdownView.editor, editorView, review, preview, sourcePath);
    return new Promise((resolve2) => {
      if (this.activeInlineWriteReview?.requestId === review.requestId) {
        this.activeInlineWriteReview.resolveResult = resolve2;
      }
      this.setInlineWriteReviewPhase(review.requestId, "awaiting_approval");
      this.refreshActiveWriteReviewActivityControls();
    });
  }
  startInlineWriteReview(editor, editorView, review, preview, sourcePath) {
    this.clearInlineWriteReview();
    this.activeInlineWriteReview = {
      requestId: review.requestId,
      review,
      preview,
      sourcePath,
      originalText: editor.getValue(),
      editorView,
      editor,
      phase: "previewing",
      visibleCharacters: 0,
      streamTimer: null,
      clearTimer: null,
      decisionSent: false,
      approved: false,
      appliedInEditor: false,
      ignoreNextBackendDone: false
    };
    this.syncInlineWriteReviewDecorations();
    const streamTimer = window.setInterval(() => {
      this.advanceInlineWriteReviewStream();
    }, 34);
    if (this.activeInlineWriteReview?.requestId === review.requestId) {
      this.activeInlineWriteReview.streamTimer = streamTimer;
      if (getChatWriteReviewTotalAddedCharacters(preview) <= 0) {
        this.stopInlineWriteReviewStream();
        return;
      }
      this.advanceInlineWriteReviewStream();
    } else {
      window.clearInterval(streamTimer);
    }
  }
  advanceInlineWriteReviewStream() {
    const state = this.activeInlineWriteReview;
    if (!state) {
      return;
    }
    const nextVisibleCharacters = advanceChatWriteReviewVisibleCharacters(
      state.preview,
      state.visibleCharacters,
      state.phase === "writing" ? 24 : 14
    );
    if (nextVisibleCharacters === state.visibleCharacters) {
      this.stopInlineWriteReviewStream();
      this.syncInlineWriteReviewDecorations();
      return;
    }
    state.visibleCharacters = nextVisibleCharacters;
    if (state.approved) {
      this.applyInlineWriteReviewDocumentFrame();
    } else {
      this.syncInlineWriteReviewDecorations();
    }
    if (nextVisibleCharacters >= getChatWriteReviewTotalAddedCharacters(state.preview)) {
      this.stopInlineWriteReviewStream();
      if (state.approved && !state.appliedInEditor) {
        state.appliedInEditor = true;
        if (!state.decisionSent) {
          state.decisionSent = true;
          state.ignoreNextBackendDone = true;
          state.resolveResult?.({ approved: true, appliedByClient: true });
          state.resolveResult = void 0;
        }
      }
    }
  }
  stopInlineWriteReviewStream() {
    const state = this.activeInlineWriteReview;
    if (!state?.streamTimer) {
      return;
    }
    window.clearInterval(state.streamTimer);
    state.streamTimer = null;
  }
  setInlineWriteReviewPhase(requestId, phase) {
    if (!this.activeInlineWriteReview || this.activeInlineWriteReview.requestId !== requestId) {
      return;
    }
    this.activeInlineWriteReview.phase = phase;
    if (phase === "writing") {
      this.beginInlineWriteReviewEditorWrite();
      return;
    }
    if (phase === "done") {
      if (this.activeInlineWriteReview.ignoreNextBackendDone) {
        this.activeInlineWriteReview.ignoreNextBackendDone = false;
        this.clearInlineWriteReview();
        return;
      }
      this.stopInlineWriteReviewStream();
      if (this.activeInlineWriteReview.approved) {
        this.activeInlineWriteReview.visibleCharacters = getChatWriteReviewTotalAddedCharacters(
          this.activeInlineWriteReview.preview
        );
        this.applyInlineWriteReviewDocumentFrame();
      } else {
        this.activeInlineWriteReview.visibleCharacters = getChatWriteReviewTotalAddedCharacters(
          this.activeInlineWriteReview.preview
        );
        this.syncInlineWriteReviewDecorations();
      }
      this.scheduleInlineWriteReviewClear(requestId, 420);
    } else if (phase === "cancelled") {
      this.stopInlineWriteReviewStream();
      this.scheduleInlineWriteReviewClear(requestId, 220);
    }
    this.syncInlineWriteReviewDecorations();
  }
  beginInlineWriteReviewEditorWrite() {
    const state = this.activeInlineWriteReview;
    if (!state?.editor) {
      return;
    }
    state.approved = true;
    state.visibleCharacters = 0;
    this.clearInlineWriteReviewDecorations();
    this.applyInlineWriteReviewDocumentFrame();
    this.stopInlineWriteReviewStream();
    const streamTimer = window.setInterval(() => {
      this.advanceInlineWriteReviewStream();
    }, 28);
    state.streamTimer = streamTimer;
    this.advanceInlineWriteReviewStream();
  }
  applyInlineWriteReviewDocumentFrame() {
    const state = this.activeInlineWriteReview;
    if (!state?.editor) {
      return;
    }
    const frame = buildChatWriteReviewDocumentFrame(state.preview, state.originalText, state.visibleCharacters);
    state.editor.setValue(frame.text);
    const cursor = state.editor.offsetToPos(frame.activeOffset);
    state.editor.setCursor(cursor);
    state.editor.scrollIntoView({ from: cursor, to: cursor }, true);
    if (frame.isComplete && !state.appliedInEditor) {
      state.appliedInEditor = true;
      this.stopInlineWriteReviewStream();
      if (!state.decisionSent) {
        state.decisionSent = true;
        state.ignoreNextBackendDone = true;
        state.resolveResult?.({ approved: true, appliedByClient: true });
        state.resolveResult = void 0;
      }
    }
  }
  scheduleInlineWriteReviewClear(requestId, delayMs) {
    const state = this.activeInlineWriteReview;
    if (!state || state.requestId !== requestId) {
      return;
    }
    if (state.clearTimer !== null) {
      window.clearTimeout(state.clearTimer);
    }
    state.clearTimer = window.setTimeout(() => {
      if (this.activeInlineWriteReview?.requestId === requestId) {
        this.clearInlineWriteReview();
      }
    }, delayMs);
  }
  syncInlineWriteReviewDecorations() {
    const state = this.activeInlineWriteReview;
    if (!state) {
      return;
    }
    const payload = {
      review: state.review,
      preview: state.preview,
      sourcePath: state.sourcePath,
      phase: state.phase,
      streamFrame: buildChatWriteReviewStreamFrame(state.preview, state.visibleCharacters),
      app: this.app,
      component: this.plugin
    };
    state.editorView.dispatch({
      effects: setHermesInlineWriteReviewEffect.of(payload)
    });
    this.followInlineWriteCursor();
  }
  clearInlineWriteReviewDecorations() {
    const state = this.activeInlineWriteReview;
    if (!state) {
      return;
    }
    state.editorView.dispatch({
      effects: setHermesInlineWriteReviewEffect.of(null)
    });
  }
  followInlineWriteCursor() {
    if (this.pendingInlineWriteFollowFrame !== null) {
      window.cancelAnimationFrame(this.pendingInlineWriteFollowFrame);
    }
    this.pendingInlineWriteFollowFrame = window.requestAnimationFrame(() => {
      this.pendingInlineWriteFollowFrame = null;
      const editorView = this.activeInlineWriteReview?.editorView;
      if (!editorView) {
        return;
      }
      const activeLine = editorView.dom.querySelector(".hermes-chat-inline-review-add-line.is-active") ?? editorView.dom.querySelector(".hermes-chat-inline-review-addition.is-active") ?? editorView.dom.querySelector(".hermes-chat-inline-review-card");
      activeLine?.scrollIntoView({ block: "center", inline: "nearest" });
    });
  }
  clearInlineWriteReview(skipDispatch = false) {
    const state = this.activeInlineWriteReview;
    if (state && state.streamTimer !== null) {
      window.clearInterval(state.streamTimer);
    }
    if (state && state.clearTimer !== null) {
      window.clearTimeout(state.clearTimer);
    }
    if (state?.approved && !state.appliedInEditor && state.editor) {
      state.editor.setValue(state.originalText);
    }
    if (this.pendingInlineWriteFollowFrame !== null) {
      window.cancelAnimationFrame(this.pendingInlineWriteFollowFrame);
      this.pendingInlineWriteFollowFrame = null;
    }
    if (!skipDispatch && state) {
      state.editorView.dispatch({
        effects: setHermesInlineWriteReviewEffect.of(null)
      });
    }
    this.activeInlineWriteReview = null;
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
var HermesInlineWriteReviewHeaderWidget = class _HermesInlineWriteReviewHeaderWidget extends import_view2.WidgetType {
  constructor(payload) {
    super();
    this.payload = payload;
  }
  eq(other) {
    return other instanceof _HermesInlineWriteReviewHeaderWidget && other.payload.phase === this.payload.phase && other.payload.streamFrame.visibleCharacters === this.payload.streamFrame.visibleCharacters && other.payload.review.filePath === this.payload.review.filePath && other.payload.review.meta === this.payload.review.meta;
  }
  toDOM() {
    const root = document.createElement("div");
    root.className = `hermes-chat-inline-review-card is-${this.payload.phase}`;
    const title = root.createDiv({ cls: "hermes-chat-inline-review-title" });
    title.createSpan({ text: this.payload.review.title?.trim() || "\u786E\u8BA4\u804A\u5929\u5199\u5165" });
    title.createSpan({
      cls: "hermes-chat-inline-review-status",
      text: getInlineWriteReviewPhaseLabel(this.payload.phase)
    });
    const meta = this.payload.review.meta?.trim();
    if (meta) {
      root.createDiv({ cls: "hermes-chat-inline-review-meta", text: meta });
    }
    const path = this.payload.review.filePath?.trim();
    if (path) {
      root.createEl("code", { cls: "hermes-chat-inline-review-path", text: path });
    }
    root.createDiv({
      cls: "hermes-chat-inline-review-caption",
      text: this.payload.phase === "awaiting_approval" ? "\u786E\u8BA4\u6309\u94AE\u5728\u5F39\u7A97\u91CC\uFF0C\u6B63\u6587\u6B63\u5728\u539F\u6587\u533A\u57DF\u9010\u6B65\u5C55\u5F00\u3002" : this.payload.phase === "writing" ? "\u754C\u9762\u4F1A\u81EA\u52A8\u8DDF\u7740\u5F53\u524D\u5199\u5165\u4F4D\u7F6E\u6EDA\u52A8\u3002" : this.payload.phase === "done" ? "\u5199\u5165\u5B8C\u6210\uFF0C\u9A6C\u4E0A\u5207\u56DE\u771F\u5B9E\u6B63\u6587\u3002" : this.payload.phase === "cancelled" ? "\u8FD9\u6B21\u5199\u5165\u5DF2\u53D6\u6D88\u3002" : "\u6B63\u5728\u628A\u6539\u52A8\u76F4\u63A5\u6295\u5F71\u5230\u539F\u6587\u4F4D\u7F6E\u3002"
    });
    return root;
  }
};
var HermesInlineWriteReviewAdditionWidget = class _HermesInlineWriteReviewAdditionWidget extends import_view2.WidgetType {
  constructor(addition, additionIndex, phase, payload) {
    super();
    this.addition = addition;
    this.additionIndex = additionIndex;
    this.phase = phase;
    this.payload = payload;
  }
  eq(other) {
    return other instanceof _HermesInlineWriteReviewAdditionWidget && other.phase === this.phase && other.additionIndex === this.additionIndex && other.addition.isActive === this.addition.isActive && other.addition.isComplete === this.addition.isComplete && other.addition.visibleLines.join("\n") === this.addition.visibleLines.join("\n");
  }
  toDOM() {
    const root = document.createElement("div");
    root.className = [
      "hermes-chat-inline-review-addition",
      this.addition.isActive ? "is-active" : "",
      this.addition.isComplete ? "is-complete" : "",
      this.phase === "done" ? "is-done" : ""
    ].filter(Boolean).join(" ");
    root.createDiv({
      cls: "hermes-chat-inline-review-add-marker",
      text: this.phase === "writing" ? "\u6B63\u5728\u5199\u5165" : this.phase === "done" ? "\u5DF2\u5199\u5165" : "\u5199\u5165\u9884\u89C8"
    });
    const source = root.createDiv({ cls: "hermes-chat-inline-review-add-source" });
    if (this.addition.visibleLines.length === 0) {
      source.createDiv({
        cls: "hermes-chat-inline-review-add-placeholder",
        text: this.addition.isActive ? "\u51C6\u5907\u5199\u5165..." : "\u7B49\u5F85\u8F6E\u5230\u8FD9\u91CC..."
      });
      return root;
    }
    const preview = buildChatWriteReviewRenderedMarkdownPreview(this.payload.preview, this.payload.streamFrame.visibleCharacters);
    const markdownEl = source.createDiv({ cls: "hermes-chat-inline-review-add-markdown markdown-rendered" });
    void import_obsidian2.MarkdownRenderer.render(
      this.payload.app,
      preview.text || "*\uFF08\u7B49\u5F85\u5185\u5BB9\uFF09*",
      markdownEl,
      this.payload.sourcePath,
      this.payload.component
    );
    if (preview.isPartial && this.phase !== "done") {
      source.createDiv({
        cls: "hermes-chat-inline-review-add-partial",
        text: "Markdown \u9884\u89C8\u6B63\u5728\u6D41\u5F0F\u5C55\u5F00..."
      });
    }
    if (this.addition.isActive && this.phase !== "done") {
      source.createDiv({ cls: "hermes-chat-inline-review-caret-line" }).createSpan({
        cls: "hermes-chat-inline-review-caret",
        text: ""
      });
    }
    return root;
  }
};
function buildHermesInlineWriteReviewDecorations(payload, doc) {
  if (!payload) {
    return import_view2.Decoration.none;
  }
  const ranges = [];
  const firstLine = Math.max(1, Math.min(doc.lines, payload.preview.firstLine + 1));
  ranges.push(
    import_view2.Decoration.widget({
      widget: new HermesInlineWriteReviewHeaderWidget(payload),
      block: true,
      side: -1
    }).range(doc.line(firstLine).from)
  );
  for (const deletion of payload.preview.deletions) {
    const fromLine = Math.max(0, deletion.fromLine);
    const toLine = Math.min(doc.lines - 1, deletion.toLine);
    if (toLine < fromLine) {
      continue;
    }
    for (let lineIndex = fromLine; lineIndex <= toLine; lineIndex += 1) {
      const line = doc.line(lineIndex + 1);
      ranges.push(import_view2.Decoration.line({ class: "hermes-chat-inline-review-delete-line" }).range(line.from));
      if (line.from < line.to) {
        ranges.push(import_view2.Decoration.mark({ class: "hermes-chat-inline-review-delete-text" }).range(line.from, line.to));
      }
    }
  }
  for (const addition of payload.preview.additions) {
    const streamAddition = payload.streamFrame.additions.find(
      (candidate) => candidate.afterLine === addition.afterLine && candidate.lines.join("\n") === addition.lines.join("\n")
    ) ?? null;
    if (!streamAddition || !streamAddition.isActive && !streamAddition.isComplete && streamAddition.visibleLines.length === 0) {
      continue;
    }
    const pos = addition.afterLine < 0 ? 0 : doc.line(Math.max(1, Math.min(doc.lines, addition.afterLine + 1))).to;
    ranges.push(
      import_view2.Decoration.widget({
        widget: new HermesInlineWriteReviewAdditionWidget(
          streamAddition,
          payload.streamFrame.additions.indexOf(streamAddition),
          payload.phase,
          payload
        ),
        block: true,
        side: 1
      }).range(pos)
    );
  }
  return import_view2.Decoration.set(ranges, true);
}
function findEditorView(markdownView) {
  try {
    const editorWithCm = markdownView.editor;
    const state = editorWithCm.cm?.state;
    const view = state?.field ? state.field(import_obsidian2.editorEditorField, false) : null;
    if (view instanceof import_view2.EditorView) {
      return view;
    }
  } catch {
  }
  const editorEl = markdownView.containerEl.querySelector(".cm-editor");
  return editorEl instanceof HTMLElement ? import_view2.EditorView.findFromDOM(editorEl) : null;
}
function nextAnimationFrame() {
  return new Promise((resolve2) => window.requestAnimationFrame(() => resolve2()));
}
var HermesImagePreviewModal = class extends import_obsidian2.Modal {
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
var HermesWriteReviewModal = class extends import_obsidian2.Modal {
  constructor(app, component, review, validation, resolve2) {
    super(app);
    this.didResolve = false;
    this.streamTimer = null;
    this.renderedPreviewPath = "";
    this.renderedPreviewSource = "";
    this.keydownHandler = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.dismiss(false);
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        this.dismiss(true);
      }
    };
    this.component = component;
    this.review = review;
    this.validation = validation;
    this.resolve = resolve2;
  }
  onOpen() {
    const { contentEl, modalEl } = this;
    modalEl.addClass("hermes-chat-review-modal-shell");
    contentEl.empty();
    contentEl.addClass("hermes-chat-review-modal");
    const title = this.review.title?.trim() || `\u786E\u8BA4\u5199\u5165 ${(0, import_node_path.basename)(this.review.filePath || "\u6587\u4EF6")}`;
    const meta = this.review.meta?.trim() || `${this.review.toolName || "write"} \xB7 \u804A\u5929\u5199\u5165\u786E\u8BA4`;
    const filePath = this.review.filePath?.trim() ?? "";
    const isMarkdownTarget = filePath.toLowerCase().endsWith(".md");
    const diffText = this.review.diff?.trim() || "(\u6CA1\u6709\u53EF\u663E\u793A\u7684 diff)";
    const header = contentEl.createDiv({ cls: "hermes-chat-review-header" });
    const titleWrap = header.createDiv({ cls: "hermes-chat-review-title-wrap" });
    titleWrap.createEl("h2", { text: title });
    titleWrap.createDiv({ cls: "hermes-chat-review-meta", text: meta });
    if (filePath) {
      titleWrap.createEl("code", { cls: "hermes-chat-review-path", text: filePath });
    }
    if (isMarkdownTarget) {
      const preview = buildChatWriteReviewInlinePreview(this.review);
      if (preview) {
        const previewPanel = contentEl.createDiv({ cls: "hermes-chat-review-rendered" });
        previewPanel.createDiv({ cls: "hermes-chat-review-rendered-label", text: "Markdown \u9884\u89C8" });
        this.renderedPreviewBody = previewPanel.createDiv({
          cls: "hermes-chat-review-rendered-body markdown-rendered"
        });
        const previewHint = previewPanel.createDiv({
          cls: "hermes-chat-review-rendered-hint",
          text: "\u6B63\u5728\u6309\u5199\u5165\u987A\u5E8F\u6D41\u5F0F\u5C55\u5F00..."
        });
        this.renderedPreviewPath = filePath;
        this.renderedPreviewSource = buildChatWriteReviewRenderedMarkdownPreview(preview).text;
        this.startRenderedPreviewStream(previewHint);
      }
    }
    if (this.validation.mermaidProblems.length > 0) {
      const problemPanel = contentEl.createDiv({ cls: "hermes-chat-review-mermaid-warnings" });
      problemPanel.createDiv({
        cls: "hermes-chat-review-rendered-label",
        text: `Mermaid \u8BED\u6CD5\u68C0\u67E5\u53D1\u73B0 ${this.validation.mermaidProblems.length} \u5904\u95EE\u9898`
      });
      for (const problem of this.validation.mermaidProblems) {
        const item = problemPanel.createDiv({ cls: "hermes-chat-review-mermaid-warning-item" });
        item.createDiv({
          cls: "hermes-chat-review-mermaid-warning-title",
          text: `\u56FE\u8868 ${problem.index + 1}: ${problem.message}`
        });
        if (problem.code) {
          item.createEl("pre", {
            cls: "hermes-chat-review-mermaid-warning-code",
            text: problem.code
          });
        }
      }
    }
    if (!isMarkdownTarget) {
      const diffPanel = contentEl.createDiv({ cls: "hermes-chat-review-diff" });
      for (const line of diffText.split("\n")) {
        diffPanel.createDiv({
          cls: `hermes-chat-review-line ${this.getDiffLineClass(line)}`,
          text: line || " "
        });
      }
    }
    const actions = contentEl.createDiv({ cls: "hermes-chat-review-actions" });
    const cancelButton = actions.createEl("button", {
      text: "\u53D6\u6D88",
      attr: { type: "button" }
    });
    const confirmButton = actions.createEl("button", {
      cls: "mod-cta",
      text: "\u786E\u8BA4\u5199\u5165",
      attr: { type: "button" }
    });
    cancelButton.addEventListener("click", () => this.dismiss(false));
    confirmButton.addEventListener("click", () => this.dismiss(true));
    document.addEventListener("keydown", this.keydownHandler, true);
    window.setTimeout(() => confirmButton.focus({ preventScroll: true }), 0);
  }
  onClose() {
    if (this.streamTimer !== null) {
      window.clearInterval(this.streamTimer);
      this.streamTimer = null;
    }
    document.removeEventListener("keydown", this.keydownHandler, true);
    this.modalEl.removeClass("hermes-chat-review-modal-shell");
    this.contentEl.removeClass("hermes-chat-review-modal");
    this.contentEl.empty();
    this.finish(false);
  }
  dismiss(approved) {
    this.finish(approved);
    this.close();
  }
  finish(approved) {
    if (this.didResolve) {
      return;
    }
    this.didResolve = true;
    this.resolve(approved);
  }
  getDiffLineClass(line) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      return "is-file";
    }
    if (line.startsWith("@@")) {
      return "is-hunk";
    }
    if (line.startsWith("+")) {
      return "is-add";
    }
    if (line.startsWith("-")) {
      return "is-remove";
    }
    return "is-context";
  }
  startRenderedPreviewStream(hintEl) {
    if (!this.renderedPreviewBody) {
      return;
    }
    const source = this.renderedPreviewSource.trim();
    if (!source) {
      hintEl.setText("\u6CA1\u6709\u53EF\u6E32\u67D3\u7684 Markdown \u5185\u5BB9\u3002");
      return;
    }
    let visibleCharacters = 0;
    const renderFrame = () => {
      if (!this.renderedPreviewBody) {
        return;
      }
      const nextVisible = Math.min(source.length, visibleCharacters + 24);
      visibleCharacters = nextVisible;
      void this.renderPreviewMarkdown(source.slice(0, visibleCharacters));
      if (visibleCharacters >= source.length) {
        hintEl.setText("Markdown \u9884\u89C8\u5DF2\u5B8C\u6574\u5C55\u5F00\u3002");
        if (this.streamTimer !== null) {
          window.clearInterval(this.streamTimer);
          this.streamTimer = null;
        }
      }
    };
    renderFrame();
    if (visibleCharacters >= source.length) {
      return;
    }
    this.streamTimer = window.setInterval(renderFrame, 34);
  }
  async renderPreviewMarkdown(markdown) {
    if (!this.renderedPreviewBody) {
      return;
    }
    this.renderedPreviewBody.empty();
    await import_obsidian2.MarkdownRenderer.render(
      this.app,
      markdown || "*\uFF08\u7B49\u5F85\u5185\u5BB9\uFF09*",
      this.renderedPreviewBody,
      this.renderedPreviewPath,
      this.component
    );
  }
};
var HermesSidebarSettingTab = class extends import_obsidian2.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Hermes Sidebar Settings" });
    new import_obsidian2.Setting(containerEl).setName("Hermes binary").setDesc("Optional explicit Hermes binary path. If left as 'hermes', the PATH prefix below is used.").addText(
      (text) => text.setPlaceholder("hermes").setValue(this.plugin.settings.hermesBinary).onChange(async (value) => {
        this.plugin.settings.hermesBinary = value.trim() || DEFAULT_HERMES_BINARY;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Provider").setDesc("Primary Hermes provider for Obsidian chat.").addText(
      (text) => text.setValue(this.plugin.settings.provider).onChange(async (value) => {
        this.plugin.settings.provider = value.trim() || DEFAULT_PROVIDER;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Model").setDesc("Primary Hermes model for Obsidian chat.").addText(
      (text) => text.setValue(this.plugin.settings.model).onChange(async (value) => {
        this.plugin.settings.model = value.trim() || DEFAULT_MODEL;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("Reasoning effort").setDesc("Default reasoning strength used by the Obsidian sidebar.").addText(
      (text) => text.setValue(this.plugin.settings.reasoningEffort).onChange(async (value) => {
        this.plugin.settings.reasoningEffort = value.trim() || DEFAULT_REASONING_EFFORT;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("PATH prefix").setDesc("Prepended to PATH so Obsidian can resolve the Hermes Python environment.").addTextArea(
      (text) => text.setValue(this.plugin.settings.pathPrefix).onChange(async (value) => {
        this.plugin.settings.pathPrefix = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian2.Setting(containerEl).setName("System prompt").setDesc("A short instruction injected before each turn.").addTextArea(
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
    TERMINAL_CWD: input.workspaceCwd || input.hermesRoot,
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
    const sendControlMessage = (payload2) => {
      if (!child?.stdin || child.killed) {
        return;
      }
      try {
        child.stdin.write(`${JSON.stringify(payload2)}
`);
      } catch {
      }
    };
    const handleEvent = (event) => {
      if (!event || typeof event !== "object") {
        return;
      }
      if (event.type === "write_trace") {
        input.onEvent?.({
          ...event,
          type: "write_trace",
          toolName: event.toolName || "write_trace"
        });
        return;
      }
      if (event.type === "write_review") {
        const requestId = event.requestId?.trim();
        if (!requestId) {
          return;
        }
        input.onEvent?.({
          type: "status",
          text: `\u7B49\u5F85\u786E\u8BA4\u5199\u5165 ${(0, import_node_path.basename)(event.filePath || "\u6587\u4EF6")}`
        });
        void (async () => {
          const decision = input.onWriteReview ? await input.onWriteReview({
            requestId,
            toolName: event.toolName,
            title: event.title,
            meta: event.meta,
            filePath: event.filePath,
            diff: event.diff
          }) : false;
          const approved = typeof decision === "boolean" ? decision : decision.approved;
          const appliedByClient = typeof decision === "boolean" ? false : Boolean(decision.appliedByClient);
          sendControlMessage({
            type: "write_review_response",
            requestId,
            approved,
            appliedByClient
          });
          input.onEvent?.({
            type: "status",
            text: approved ? "\u5DF2\u786E\u8BA4\u5199\u5165\uFF0CHermes \u7EE7\u7EED\u6267\u884C" : "\u5DF2\u53D6\u6D88\u8FD9\u6B21\u5199\u5165"
          });
        })().catch(() => {
          sendControlMessage({
            type: "write_review_response",
            requestId,
            approved: false
          });
        });
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
          usage: event.usage,
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
      workspaceCwd: input.workspaceCwd,
      conversationHistory: input.conversationHistory
    };
    try {
      child.stdin?.write(`${JSON.stringify(payload)}
`);
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
function runInlineHermesBridge(plugin, input) {
  return runHermesBridge({
    binary: plugin.settings.hermesBinary,
    bridgeScript: resolveBridgeScriptPath(plugin.app, plugin.manifest.dir ?? ""),
    hermesRoot: DEFAULT_HERMES_ROOT,
    prompt: input.prompt,
    conversationHistory: [],
    provider: input.provider,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    systemPrompt: input.systemPrompt,
    pathPrefix: plugin.settings.pathPrefix,
    workspaceCwd: getVaultBasePath(plugin.app)
  });
}
function buildHermesSystemPrompt(basePrompt, runtime) {
  const trimmed = basePrompt.trim();
  const progressInstruction = buildHermesInterimGuidance(runtime);
  const writeInstruction = trimmed.includes("Obsidian \u5199\u5165\u534F\u8BAE\uFF1A") ? "" : buildHermesObsidianWriteGuidance();
  return [trimmed, writeInstruction, progressInstruction].filter(Boolean).join("\n\n");
}
function getVaultBasePath(app) {
  return (app.vault.adapter?.basePath ?? "").trim();
}
function normalizeContextMode(value) {
  const normalized = (value || "").trim();
  return HERMES_CONTEXT_MODE_OPTIONS.some((option) => option.value === normalized) ? normalized : "auto";
}
function resolveBridgeScriptPath(app, manifestDir) {
  if (manifestDir && (0, import_node_path.isAbsolute)(manifestDir)) {
    return (0, import_node_path.resolve)((0, import_node_path.join)(manifestDir, DEFAULT_HERMES_BRIDGE));
  }
  const vaultBasePath = getVaultBasePath(app);
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
  const vaultBasePath = getVaultBasePath(app);
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
  if ("historyContent" in value && value.historyContent !== void 0 && typeof value.historyContent !== "string") {
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
function getInlineWriteReviewPhaseLabel(phase) {
  if (phase === "awaiting_approval") {
    return "\u7B49\u5F85\u786E\u8BA4";
  }
  if (phase === "writing") {
    return "\u6B63\u5728\u5199\u5165";
  }
  if (phase === "done") {
    return "\u5DF2\u5B8C\u6210";
  }
  if (phase === "cancelled") {
    return "\u5DF2\u53D6\u6D88";
  }
  return "\u751F\u6210\u9884\u89C8";
}
function formatActivityTitleForTimeline(entry, index) {
  if (entry.toolName === "run.config") {
    return "Run config";
  }
  if (entry.toolName === "write_trace") {
    return "\u5199\u5165\u8FFD\u8E2A";
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
    "Hermes \u6B63\u5728\u7EE7\u7EED\u5904\u7406"
  ])).has(value);
}
function formatToolDisplayName(toolName) {
  if (toolName === "write_trace") {
    return "\u5199\u5165\u8FFD\u8E2A";
  }
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
  if (toolName === "write_trace") {
    return status === "running" ? "\u6B63\u5728\u8FFD\u8E2A\u5199\u5165" : status === "done" ? "\u5199\u5165\u8FFD\u8E2A\u5B8C\u6210" : "\u5199\u5165\u5DF2\u53D6\u6D88";
  }
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
