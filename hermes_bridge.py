#!/usr/bin/env python3
from __future__ import annotations

import json
import logging
import os
import sys
import copy
import asyncio
import difflib
import threading
import uuid
from pathlib import Path
from typing import Any, Callable

DEFAULT_HERMES_AGENT_ROOT = "/Users/lijiahao/.hermes/hermes-agent"
DEFAULT_HERMES_HOME = str(Path.home() / ".hermes")
WRITE_REVIEW_DIFF_MAX_CHARACTERS = 40000


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def resolve_hermes_home() -> Path:
    raw = os.environ.get("HERMES_HOME") or DEFAULT_HERMES_HOME
    home = Path(raw).expanduser()
    active_profile = home / "active_profile"
    try:
        if active_profile.exists():
            name = active_profile.read_text(encoding="utf-8").strip()
            if name and name != "default":
                profile_dir = home / "profiles" / name
                if profile_dir.exists():
                    return profile_dir
    except Exception:
        pass
    return home


def ensure_hermes_agent_root_on_path() -> Path:
    hermes_agent_root = Path(os.environ.get("HERMES_AGENT_ROOT", DEFAULT_HERMES_AGENT_ROOT)).expanduser()
    if str(hermes_agent_root) not in sys.path:
        sys.path.insert(0, str(hermes_agent_root))
    return hermes_agent_root


class BridgeControlChannel:
    def __init__(self, stream: Any):
        self._stream = stream
        self._responses: dict[str, dict[str, bool]] = {}
        self._closed = False
        self._condition = threading.Condition()
        self._reader = threading.Thread(target=self._read_loop, name="hermes-bridge-control", daemon=True)
        self._reader.start()

    def _read_loop(self) -> None:
        try:
            while True:
                line = self._stream.readline()
                if not line:
                    break
                try:
                    payload = json.loads(line)
                except Exception:
                    continue
                if str(payload.get("type") or "").strip() != "write_review_response":
                    continue
                request_id = str(payload.get("requestId") or "").strip()
                if not request_id:
                    continue
                approved = bool(payload.get("approved"))
                applied_by_client = bool(payload.get("appliedByClient"))
                with self._condition:
                    self._responses[request_id] = {"approved": approved, "applied_by_client": applied_by_client}
                    self._condition.notify_all()
        finally:
            with self._condition:
                self._closed = True
                self._condition.notify_all()

    def wait_for_write_review(self, request_id: str) -> dict[str, bool]:
        with self._condition:
            while request_id not in self._responses and not self._closed:
                self._condition.wait(timeout=0.25)
            if request_id in self._responses:
                return self._responses.pop(request_id)
            return {"approved": False, "applied_by_client": False}


def clamp_write_review_diff(diff_text: str, *, max_length: int = WRITE_REVIEW_DIFF_MAX_CHARACTERS) -> str:
    if len(diff_text) <= max_length:
        return diff_text
    head = diff_text[: max_length // 2].rstrip()
    tail = diff_text[-max_length // 2 :].lstrip()
    omitted = len(diff_text) - len(head) - len(tail)
    return f"{head}\n...\n[omitted {omitted} chars from diff preview]\n...\n{tail}"


def build_unified_diff(path_label: str, old_content: str, new_content: str) -> str:
    return "".join(
        difflib.unified_diff(
            old_content.splitlines(keepends=True),
            new_content.splitlines(keepends=True),
            fromfile=f"a/{path_label}",
            tofile=f"b/{path_label}",
        )
    )


def count_diff_changes(diff_text: str) -> tuple[int, int]:
    additions = 0
    deletions = 0
    for line in diff_text.splitlines():
        if line.startswith("+++") or line.startswith("---"):
            continue
        if line.startswith("+"):
            additions += 1
        elif line.startswith("-"):
            deletions += 1
    return additions, deletions


def extract_added_markdown_preview(diff_text: str, *, max_lines: int = 16) -> str:
    lines: list[str] = []
    for line in str(diff_text or "").splitlines():
        if line.startswith("+++") or line.startswith("---") or line.startswith("@@"):
            continue
        if line.startswith("+"):
            lines.append(line[1:])
        if len(lines) >= max_lines:
            break
    return "\n".join(lines).strip()


def build_write_trace_events(review: dict[str, Any], *, phase: str = "preview") -> list[dict[str, Any]]:
    tool_name = str(review.get("toolName") or "write").strip()
    file_path = str(review.get("filePath") or "").strip()
    meta = str(review.get("meta") or "").strip()
    added_preview = extract_added_markdown_preview(str(review.get("diff") or ""))
    target = Path(file_path).name if file_path and "," not in file_path else file_path or "文件"
    events = [
        {
            "type": "write_trace",
            "eventType": f"write.{phase}.start",
            "toolName": "write_trace",
            "status": "running",
            "text": f"正在生成修改预览：{target}",
            "preview": "\n".join(
                part for part in [f"目标：{file_path}" if file_path else "", meta, added_preview] if part
            ),
        }
    ]
    events.append(
        {
            "type": "write_trace",
            "eventType": f"write.{phase}.review",
            "toolName": "write_trace",
            "status": "running",
            "text": f"等待确认写入：{target}",
            "preview": f"{tool_name} · {meta}" if meta else tool_name,
        }
    )
    return events


def format_write_review_meta(*, tool_name: str, file_count: int, additions: int, deletions: int) -> str:
    file_label = "1 file" if file_count == 1 else f"{file_count} files"
    return f"{tool_name} · {file_label} · -{deletions} +{additions}"


class PreviewFileOperations:
    def __init__(self):
        self._virtual_files: dict[str, str] = {}
        self._missing_paths: set[str] = set()

    def _expand_path(self, path: str) -> str:
        return str(resolve_preview_target_path(path))

    def read_file_raw(self, path: str) -> Any:
        ensure_hermes_agent_root_on_path()
        from tools.file_operations import ReadResult

        resolved = self._expand_path(path)
        if resolved in self._virtual_files:
            return ReadResult(content=self._virtual_files[resolved], file_size=len(self._virtual_files[resolved].encode("utf-8")))
        if resolved in self._missing_paths:
            return ReadResult(error=f"Failed to read file: {resolved}")
        target = Path(resolved)
        if not target.exists():
            self._missing_paths.add(resolved)
            return ReadResult(error=f"Failed to read file: {resolved}")
        content = target.read_text(encoding="utf-8")
        self._virtual_files[resolved] = content
        return ReadResult(content=content, file_size=len(content.encode("utf-8")))

    def write_file(self, path: str, content: str) -> Any:
        ensure_hermes_agent_root_on_path()
        from tools.file_operations import WriteResult

        resolved = self._expand_path(path)
        self._virtual_files[resolved] = content
        self._missing_paths.discard(resolved)
        return WriteResult(bytes_written=len(content.encode("utf-8")))

    def delete_file(self, path: str) -> Any:
        ensure_hermes_agent_root_on_path()
        from tools.file_operations import WriteResult

        resolved = self._expand_path(path)
        self._virtual_files.pop(resolved, None)
        self._missing_paths.add(resolved)
        return WriteResult()

    def move_file(self, src: str, dst: str) -> Any:
        ensure_hermes_agent_root_on_path()
        from tools.file_operations import WriteResult

        src_resolved = self._expand_path(src)
        dst_resolved = self._expand_path(dst)
        src_result = self.read_file_raw(src)
        if src_result.error:
            return WriteResult(error=src_result.error)
        self._virtual_files[dst_resolved] = src_result.content
        self._missing_paths.discard(dst_resolved)
        self._virtual_files.pop(src_resolved, None)
        self._missing_paths.add(src_resolved)
        return WriteResult()

    def _check_lint(self, _path: str) -> Any:
        ensure_hermes_agent_root_on_path()
        from tools.file_operations import LintResult

        return LintResult(success=True, skipped=True, message="preview")


def resolve_preview_target_path(path: str) -> Path:
    candidate = Path(str(path or "").strip()).expanduser()
    if candidate.is_absolute():
        return candidate
    base_dir = Path(os.environ.get("TERMINAL_CWD") or os.getcwd()).expanduser()
    return (base_dir / candidate).resolve()


def build_write_review_request(tool_name: str, args: dict[str, Any], *, task_id: str = "default") -> dict[str, Any] | None:
    ensure_hermes_agent_root_on_path()
    from tools.fuzzy_match import fuzzy_find_and_replace
    from tools.patch_parser import apply_v4a_operations, parse_v4a_patch

    if tool_name == "write_file":
        path = str(args.get("path") or "").strip()
        if not path:
            return None
        content = str(args.get("content") or "")
        resolved_path = resolve_preview_target_path(path)
        old_content = resolved_path.read_text(encoding="utf-8") if resolved_path.exists() else ""
        diff = build_unified_diff(str(resolved_path), old_content, content) or f"# No textual changes for {resolved_path}"
        additions, deletions = count_diff_changes(diff)
        return {
            "toolName": tool_name,
            "filePath": str(resolved_path),
            "title": f"确认写入 {resolved_path.name}",
            "meta": format_write_review_meta(tool_name=tool_name, file_count=1, additions=additions, deletions=deletions),
            "diff": clamp_write_review_diff(diff),
        }

    if tool_name != "patch":
        return None

    mode = str(args.get("mode") or "replace").strip().lower()
    if mode == "replace":
        path = str(args.get("path") or "").strip()
        old_string = args.get("old_string")
        new_string = args.get("new_string")
        replace_all = bool(args.get("replace_all"))
        if not path or old_string is None or new_string is None:
            return None
        resolved_path = resolve_preview_target_path(path)
        if not resolved_path.exists():
            return {"error": f"Failed to read file: {resolved_path}"}
        original = resolved_path.read_text(encoding="utf-8")
        updated, match_count, _strategy, error = fuzzy_find_and_replace(
            original,
            str(old_string),
            str(new_string),
            replace_all,
        )
        if error or match_count == 0:
            return {"error": error or f"Could not find match for old_string in {resolved_path}"}
        diff = build_unified_diff(str(resolved_path), original, updated) or f"# No textual changes for {resolved_path}"
        additions, deletions = count_diff_changes(diff)
        return {
            "toolName": tool_name,
            "filePath": str(resolved_path),
            "title": f"确认修改 {resolved_path.name}",
            "meta": format_write_review_meta(tool_name=tool_name, file_count=1, additions=additions, deletions=deletions),
            "diff": clamp_write_review_diff(diff),
        }

    if mode == "patch":
        patch_content = str(args.get("patch") or "")
        operations, parse_error = parse_v4a_patch(patch_content)
        if parse_error:
            return {"error": f"Failed to parse patch: {parse_error}"}
        preview_ops = PreviewFileOperations()
        preview_result = apply_v4a_operations(operations, preview_ops)
        if preview_result.error:
            return {"error": preview_result.error}
        diff = str(preview_result.diff or "").strip()
        target_paths = [
            *[str(path) for path in preview_result.files_modified],
            *[str(path) for path in preview_result.files_created],
            *[str(path) for path in preview_result.files_deleted],
        ]
        file_path = ", ".join(target_paths) if target_paths else "multiple files"
        additions, deletions = count_diff_changes(diff)
        return {
            "toolName": tool_name,
            "filePath": file_path,
            "title": f"确认应用补丁 ({len(target_paths) or len(operations)} files)",
            "meta": format_write_review_meta(
                tool_name=tool_name,
                file_count=max(len(target_paths), 1),
                additions=additions,
                deletions=deletions,
            ),
            "diff": clamp_write_review_diff(diff or "# Patch produced no textual diff"),
        }

    return None


def snapshot_write_review_files(review: dict[str, Any] | None) -> list[dict[str, str | None]]:
    if not review or review.get("error"):
        return []
    snapshots: list[dict[str, str | None]] = []
    seen: set[str] = set()
    candidates = [str(review.get("filePath") or "")]
    for line in str(review.get("diff") or "").splitlines():
        if not line.startswith(("--- ", "+++ ")):
            continue
        label = line[4:].strip()
        if label == "/dev/null":
            continue
        if label.startswith(("a/", "b/")):
            label = label[2:]
        candidates.append(label)
    for candidate in candidates:
        for raw_path in str(candidate or "").split(","):
            raw_path = raw_path.strip()
            if not raw_path or raw_path == "multiple files" or " -> " in raw_path:
                continue
            try:
                resolved_path = resolve_preview_target_path(raw_path)
            except Exception:
                continue
            key = str(resolved_path)
            if key in seen:
                continue
            seen.add(key)
            if resolved_path.exists():
                try:
                    content: str | None = resolved_path.read_text(encoding="utf-8")
                except Exception:
                    content = None
            else:
                content = None
            snapshots.append({"path": key, "content": content})
    return snapshots


def result_has_error(result: str) -> bool:
    try:
        parsed = json.loads(result)
    except Exception:
        return False
    return bool(isinstance(parsed, dict) and parsed.get("error"))


def install_write_review_handlers(control_channel: BridgeControlChannel | None) -> None:
    ensure_hermes_agent_root_on_path()
    from tools.registry import registry

    for tool_name in ("write_file", "patch"):
        entry = registry.get_entry(tool_name)
        if entry is None:
            continue
        if getattr(entry.handler, "_is_write_review_wrapper", False):
            continue
        original_handler = entry.handler

        def _wrapped(args: dict[str, Any], __original: Callable[..., str] = original_handler, __tool_name: str = tool_name, **kwargs: Any) -> str:
            review = build_write_review_request(__tool_name, args, task_id=str(kwargs.get("task_id") or "default"))
            if review is not None and review.get("error"):
                return json.dumps({"error": review["error"]}, ensure_ascii=False)
            snapshots = snapshot_write_review_files(review)
            result = __original(args, **kwargs)
            if review is not None and not result_has_error(result):
                request_id = f"write-review-{uuid.uuid4().hex}"
                emit(
                    {
                        "type": "write_review",
                        "phase": "applied",
                        "requestId": request_id,
                        "toolName": review.get("toolName"),
                        "filePath": review.get("filePath"),
                        "title": review.get("title"),
                        "meta": review.get("meta"),
                        "diff": review.get("diff"),
                        "snapshots": snapshots,
                    }
                )
            return result

        setattr(_wrapped, "_is_write_review_wrapper", True)
        entry.handler = _wrapped


def humanize_status(event_type: str, message: str) -> str:
    text = f"{event_type}: {message}".lower()
    if any(token in text for token in ("compression", "compact", "compress")):
        return "正在整理上下文"
    if any(token in text for token in ("tool", "execute", "execution")):
        return "正在调用工具中"
    if any(token in text for token in ("thinking", "reasoning", "reflect")):
        return "正在思考中"
    if any(token in text for token in ("connect", "connection", "stale")):
        return "正在连接 Hermes"
    if "warn" in event_type.lower():
        return "Hermes 正在处理"
    return "Hermes 正在处理"


def format_tool_status(tool_name: str, status: str) -> str:
    if tool_name == "thinking":
        if status == "running":
            return "正在思考"
        if status == "done":
            return "已完成思考"
        if status == "error":
            return "思考失败"
        return "thinking"

    skill_labels = {
        "skill_view": ("正在读取 skill", "已读取 skill", "skill 读取失败"),
        "skills_list": ("正在列出 skills", "已列出 skills", "skills 列表读取失败"),
        "skill_manage": ("正在管理 skill", "已管理 skill", "skill 管理失败"),
    }
    if tool_name in skill_labels:
        running, done, error = skill_labels[tool_name]
        if status == "running":
            return running
        if status == "done":
            return done
        if status == "error":
            return error
        return tool_name

    label = tool_name or "工具"

    if status == "running":
        return f"正在调用 {label}"
    if status == "error":
        return f"{label} 调用失败"
    if status == "done":
        return f"已完成 {label}"
    return label


def compact_preview(value: Any, *, max_length: int = 96) -> str:
    text = str(value or "")
    text = " ".join(text.split())
    if len(text) <= max_length:
        return text
    return text[: max(0, max_length - 3)].rstrip() + "..."


def should_emit_reasoning_activity(event_type: str, preview: Any) -> bool:
    """Only true reasoning-stream events belong in the visible thinking row."""
    return event_type == "_thinking" and bool(str(preview or "").strip())


def should_display_reasoning_delta(text: Any) -> bool:
    value = str(text or "").strip()
    if len(value) < 2:
        return False
    normalized = value.lower()
    tool_markers = (
        "tool.started",
        "tool.completed",
        "tool.error",
        "正在调用",
        "已完成",
        "调用失败",
        "search_files",
        "read_file",
        "write_file",
        "patch",
        "terminal",
        "skill_view",
        "skills_list",
    )
    if any(marker in normalized for marker in tool_markers):
        return False
    if normalized in {"thinking", "running", "done", "info"}:
        return False
    return True


def looks_like_internal_reasoning_text(text: Any) -> bool:
    value = str(text or "").strip()
    if not value:
        return False
    normalized = value.lower()
    markers = (
        "必须用 file 工具",
        "没有 file toolset",
        "让我看看子代理",
        "我可以给子代理",
        "让我先直接处理",
        "让我重新扫描",
        "chain-of-thought",
        "hidden reasoning",
    )
    if any(marker.lower() in normalized for marker in markers):
        return True

    lines = [line.strip() for line in value.splitlines() if line.strip()]
    first_person_planning = sum(
        1
        for line in lines
        if any(token in line for token in ("我先", "我再", "我会", "让我", "接下来", "然后", "同时"))
    )
    tool_references = sum(
        1
        for line in lines
        if any(token in line.lower() for token in ("tool", "工具", "toolset", "read_file", "write_file", "execute_code", "terminal", "file"))
    )
    return len(lines) >= 3 and first_person_planning >= 2 and tool_references >= 1


def append_reasoning_delta_preview(
    buffer: list[str],
    text: Any,
    *,
    max_length: int = 2000,
    replace: bool = False,
) -> str:
    chunk = str(text or "")
    if not chunk:
        return ""
    if replace:
        buffer.clear()
    buffer.append(chunk)
    return compact_preview("".join(buffer), max_length=max_length)


def append_reasoning_activity_preview(
    buffer: list[str],
    previous_text: str,
    text: Any,
    *,
    max_length: int = 2000,
) -> tuple[str, str]:
    delta, next_reasoning_text, should_replace = extract_new_reasoning_delta(previous_text, text)
    if not should_display_reasoning_delta(delta):
        return "", next_reasoning_text
    return append_reasoning_delta_preview(buffer, delta, max_length=max_length, replace=should_replace), next_reasoning_text


def extract_new_reasoning_delta(previous_text: str, text: Any) -> tuple[str, str, bool]:
    """Return only newly exposed reasoning text, tolerating cumulative snapshots."""
    chunk = str(text or "")
    if not chunk:
        return "", previous_text, False
    if previous_text:
        if chunk == previous_text or chunk in previous_text or previous_text.endswith(chunk):
            return "", previous_text, False
        if chunk.startswith(previous_text):
            return chunk[len(previous_text):], chunk, False
        max_overlap = min(len(previous_text), len(chunk))
        for size in range(max_overlap, 0, -1):
            if previous_text.endswith(chunk[:size]):
                return chunk[size:], f"{previous_text}{chunk[size:]}", False
        if looks_like_rewritten_reasoning_snapshot(previous_text, chunk):
            return chunk, chunk, True
    return chunk, f"{previous_text}{chunk}", False


def looks_like_rewritten_reasoning_snapshot(previous_text: str, text: str) -> bool:
    value = str(text or "").strip()
    previous = str(previous_text or "").strip()
    if not previous or not value:
        return False
    if value.startswith(previous) or previous in value or value in previous or previous.endswith(value):
        return False
    rewrite_markers = ("重新", "修正", "改为", "更准确", "换个", "重来", "revis", "rewrite", "restart")
    if any(marker in value.lower() for marker in rewrite_markers):
        return True
    return len(previous) >= 24 and len(value) >= 24 and difflib.SequenceMatcher(None, previous, value).ratio() >= 0.45


def is_xiaomi_runtime(provider: str | None, base_url: str | None) -> bool:
    normalized_provider = str(provider or "").strip().lower()
    normalized_base_url = str(base_url or "").strip().lower()
    return normalized_provider in {"xiaomi", "mimo", "xiaomi-mimo"} or "xiaomimimo.com" in normalized_base_url


def is_deepseek_runtime(provider: str | None, base_url: str | None) -> bool:
    normalized_provider = str(provider or "").strip().lower()
    normalized_base_url = str(base_url or "").strip().lower()
    return normalized_provider == "deepseek" or "api.deepseek.com" in normalized_base_url


def apply_runtime_reasoning_to_api_kwargs(
    api_kwargs: dict[str, Any],
    *,
    provider: str | None,
    base_url: str | None,
    reasoning_config: dict | None,
) -> None:
    is_xiaomi = is_xiaomi_runtime(provider, base_url)
    is_deepseek = is_deepseek_runtime(provider, base_url)
    if not is_xiaomi and not is_deepseek:
        return
    if not isinstance(reasoning_config, dict):
        return

    if is_deepseek:
        extra_body = api_kwargs.setdefault("extra_body", {})
        if not isinstance(extra_body, dict):
            extra_body = {}
            api_kwargs["extra_body"] = extra_body

        if reasoning_config.get("enabled") is False:
            api_kwargs.pop("reasoning_effort", None)
            extra_body["thinking"] = {"type": "disabled"}
            return

        effort = str(reasoning_config.get("effort") or "").strip().lower()
        api_kwargs["reasoning_effort"] = "max" if effort == "xhigh" else "high"
        extra_body["thinking"] = {"type": "enabled"}
        return

    if reasoning_config.get("enabled") is False:
        api_kwargs["reasoning_effort"] = "none"
        return
    effort = str(reasoning_config.get("effort") or "").strip().lower()
    if effort in {"minimal", "low", "medium", "high", "xhigh"}:
        api_kwargs["reasoning_effort"] = effort


def summarize_tool_args(tool_name: str, args: Any, preview: str) -> str:
    preview_text = compact_preview(preview)
    if preview_text:
        return preview_text
    if not isinstance(args, dict):
        return compact_preview(args)

    if tool_name in {"skill_view", "skill_manage"}:
        skill_name = args.get("name") or args.get("skill") or args.get("skill_name")
        if skill_name:
            return f"skill={compact_preview(skill_name, max_length=72)}"

    if tool_name == "skills_list":
        query = args.get("query") or args.get("filter")
        return f"filter={compact_preview(query, max_length=72)}" if query else "读取可用 skills"

    if tool_name == "patch":
        path = args.get("path")
        if path:
            return f"准备修改 {compact_preview(path, max_length=96)}"
        return "准备生成修改预览"

    if tool_name == "write_file":
        path = args.get("path")
        return f"准备写入 {compact_preview(path, max_length=96)}" if path else "准备写入文件"

    for key in ("query", "path", "file", "name", "command", "url", "image_url", "prompt"):
        value = args.get(key)
        if value:
            return f"{key}={compact_preview(value)}"

    try:
        return compact_preview(json.dumps(args, ensure_ascii=False), max_length=120)
    except Exception:
        return compact_preview(args)


def extract_skill_name(tool_name: str, args: Any) -> str:
    if tool_name not in {"skill_view", "skill_manage"}:
        return ""
    if not isinstance(args, dict):
        return ""
    skill_name = args.get("name") or args.get("skill") or args.get("skill_name")
    return compact_preview(skill_name, max_length=120) if skill_name else ""


def emit_activity(
    *,
    event_type: str,
    tool_name: str = "",
    skill_name: str = "",
    preview: str = "",
    status: str = "info",
    duration: float | None = None,
    is_error: bool | None = None,
) -> None:
    preview_text = compact_preview(preview, max_length=2000 if tool_name == "thinking" else 140)
    payload: dict[str, Any] = {
        "type": "activity",
        "eventType": event_type,
        "toolName": tool_name,
        "preview": preview_text,
        "status": status,
        "text": format_tool_status(tool_name, status),
    }
    if skill_name:
        payload["skillName"] = skill_name
    if duration is not None:
        payload["duration"] = duration
    if is_error is not None:
        payload["isError"] = is_error
    emit(payload)


def pick_bridge_final_text(
    *,
    final_text: str | None,
    streamed_text: str | None,
    progress_texts: list[str] | None,
    reasoning_previews: list[str] | None,
    message_contents: list[str] | None,
) -> str:
    candidates: list[str] = []
    seen: set[str] = set()
    reasoning_preview_texts = [
        str(item or "").strip()
        for item in (reasoning_previews or [])
        if str(item or "").strip()
    ]

    def is_reasoning_preview_text(text: str) -> bool:
        return any(preview == text or preview in text or text in preview for preview in reasoning_preview_texts)

    for group in (
        [final_text or "", streamed_text or ""],
        progress_texts or [],
        message_contents or [],
    ):
        for item in group:
            text = str(item or "").strip()
            if not text or text in seen or looks_like_internal_reasoning_text(text) or is_reasoning_preview_text(text):
                continue
            seen.add(text)
            candidates.append(text)
    return candidates[0] if candidates else ""


def build_usage_summary(result: dict[str, Any]) -> dict[str, int | float | None]:
    input_tokens = int(result.get("input_tokens") or 0)
    cache_read_tokens = int(result.get("cache_read_tokens") or 0)
    last_prompt_tokens = int(result.get("last_prompt_tokens") or 0)
    context_length = int(result.get("context_length") or 0)
    context_percent = min(100, round((last_prompt_tokens / context_length) * 100)) if context_length > 0 else None
    return {
        "apiCalls": int(result.get("api_calls") or 0),
        "inputTokens": input_tokens,
        "lastPromptTokens": last_prompt_tokens,
        "contextLength": context_length if context_length > 0 else None,
        "contextPercent": context_percent,
        "cacheReadTokens": cache_read_tokens,
        "cacheWriteTokens": int(result.get("cache_write_tokens") or 0),
        "cacheHitRate": round((cache_read_tokens / input_tokens) * 100) if input_tokens > 0 else None,
    }


def preprocess_bridge_images(agent: Any, prompt: str, image_paths: list[str]) -> str:
    valid_paths = [Path(path).expanduser() for path in image_paths if str(path or "").strip()]
    if not valid_paths:
        return prompt

    try:
        from tools.vision_tools import vision_analyze_tool
    except Exception:
        return prompt or ""

    analysis_prompt = (
        "Describe everything visible in this image in thorough detail. "
        "Include any text, code, data, objects, people, layout, colors, "
        "and any other notable visual information."
    )
    enriched_parts: list[str] = []

    for img_path in valid_paths:
        if not img_path.exists():
            continue
        try:
            result_json = asyncio.run(
                vision_analyze_tool(image_url=str(img_path), user_prompt=analysis_prompt)
            )
            result = json.loads(result_json) if isinstance(result_json, str) else {}
            if result.get("success"):
                description = str(result.get("analysis") or "").strip()
                if description:
                    enriched_parts.append(
                        f"[The user attached an image. Here's what it contains:\n{description}]\n"
                        f"[If you need a closer look, use vision_analyze with image_url: {img_path}]"
                    )
                    continue
            enriched_parts.append(
                f"[The user attached an image but it couldn't be analyzed. "
                f"You can try examining it with vision_analyze using image_url: {img_path}]"
            )
        except Exception as exc:
            enriched_parts.append(
                f"[The user attached an image but analysis failed ({exc}). "
                f"You can try examining it with vision_analyze using image_url: {img_path}]"
            )

    user_text = str(prompt or "").strip()
    if not enriched_parts:
        return user_text
    prefix = "\n\n".join(enriched_parts)
    return f"{prefix}\n\n{user_text}" if user_text else prefix


def prepare_messages_for_non_vision_model(agent: Any, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prepare = getattr(agent, "_prepare_messages_for_non_vision_model", None)
    if not callable(prepare):
        return messages
    try:
        return prepare(messages)
    except Exception:
        return messages


def main() -> int:
    logging.disable(logging.CRITICAL)

    hermes_agent_root = ensure_hermes_agent_root_on_path()

    hermes_home = resolve_hermes_home()
    os.environ["HERMES_HOME"] = str(hermes_home)
    os.environ.setdefault("HERMES_YOLO_MODE", "1")
    os.environ.setdefault("HERMES_ACCEPT_HOOKS", "1")

    try:
        from hermes_cli.env_loader import load_hermes_dotenv

        load_hermes_dotenv(project_env=hermes_agent_root / ".env")
    except Exception:
        pass

    try:
        payload = json.loads((sys.stdin.readline() or "").strip() or "{}")
    except Exception as exc:
        emit({"type": "error", "message": f"Invalid bridge payload: {exc}"})
        return 1
    control_channel = BridgeControlChannel(sys.stdin)

    prompt = str(payload.get("prompt") or "").strip()
    system_prompt = str(payload.get("systemPrompt") or "").strip()
    provider = str(payload.get("provider") or "").strip() or None
    model = str(payload.get("model") or "").strip() or None
    reasoning_effort = str(payload.get("reasoningEffort") or "").strip() or ""
    session_id = str(payload.get("sessionId") or "").strip() or None
    conversation_history = payload.get("conversationHistory") or []
    image_paths = payload.get("imagePaths") or []
    if not isinstance(conversation_history, list):
        conversation_history = []
    if not isinstance(image_paths, list):
        image_paths = []

    try:
        from hermes_cli.config import load_config
        from hermes_cli.models import detect_provider_for_model
        from hermes_cli.runtime_provider import resolve_runtime_provider
        from hermes_cli.tools_config import _get_platform_tools
        from hermes_constants import parse_reasoning_effort
        from hermes_state import SessionDB
        from run_agent import AIAgent
    except Exception as exc:
        emit({"type": "error", "message": f"Failed to import Hermes internals: {exc}"})
        return 1

    cfg = load_config()
    install_write_review_handlers(control_channel)

    model_cfg = cfg.get("model") or {}
    if isinstance(model_cfg, str):
        cfg_model = model_cfg
    else:
        cfg_model = model_cfg.get("default") or model_cfg.get("model") or ""

    effective_model = model or cfg_model
    effective_provider = provider
    explicit_base_url_from_alias = None

    if effective_model:
        try:
            from hermes_cli import model_switch as _ms

            _ms._ensure_direct_aliases()
            direct = _ms.DIRECT_ALIASES.get(effective_model.strip().lower())
        except Exception:
            direct = None
        if direct is not None:
            effective_model = direct.model
            effective_provider = direct.provider
            if direct.base_url:
                explicit_base_url_from_alias = direct.base_url.rstrip("/")
        elif not effective_provider:
            cfg_provider = ""
            if isinstance(model_cfg, dict):
                cfg_provider = str(model_cfg.get("provider") or "").strip().lower()
            current_provider = cfg_provider or os.getenv("HERMES_INFERENCE_PROVIDER", "").strip().lower() or "auto"
            detected = detect_provider_for_model(effective_model, current_provider)
            if detected:
                effective_provider, effective_model = detected

    runtime = resolve_runtime_provider(
        requested=effective_provider,
        target_model=effective_model or None,
        explicit_base_url=explicit_base_url_from_alias,
    )

    toolsets_list = sorted(_get_platform_tools(cfg, "cli"))
    fallback_chain = cfg.get("fallback_providers") or cfg.get("fallback_model")
    reasoning_config = parse_reasoning_effort(reasoning_effort)
    resolved_provider = str(runtime.get("provider") or effective_provider or "").strip()
    resolved_model = str(effective_model or "").strip()
    resolved_reasoning = str(reasoning_effort or "").strip() or "default"

    session_db = None
    try:
        session_db = SessionDB()
    except Exception:
        session_db = None

    emit({"type": "status", "text": "Hermes 已收到这条消息"})
    emit({
        "type": "activity",
        "eventType": "run.config",
        "status": "info",
        "text": f"本轮使用：{resolved_provider}/{resolved_model} · 思考 {resolved_reasoning}",
        "toolName": "run.config",
        "preview": f"provider={resolved_provider}, model={resolved_model}, reasoning={resolved_reasoning}",
    })

    streamed_chunks: list[str] = []
    progress_texts: list[str] = []
    reasoning_previews: list[str] = []
    reasoning_delta_parts: list[str] = []
    last_reasoning_delta_text = ""
    last_emitted_reasoning_preview = ""

    def on_interim(text: str, *, already_streamed: bool = False) -> None:
        visible = str(text or "").strip()
        if not visible or already_streamed:
            return
        progress_texts.append(visible)
        emit({"type": "progress", "text": visible})

    def on_stream_delta(text: str | None) -> None:
        if text is None:
            emit({"type": "segment_break"})
            return
        visible = str(text or "")
        if visible:
            streamed_chunks.append(visible)
            emit({"type": "delta", "text": visible})

    def on_tool_progress(
        event_type: str,
        tool_name: str,
        preview: str,
        args: Any,
        **metadata: Any,
    ) -> None:
        nonlocal last_reasoning_delta_text, last_emitted_reasoning_preview
        is_reasoning_event = event_type in {"_thinking", "reasoning.available"}
        raw_preview_text = str(preview or args or "")
        if is_reasoning_event:
            preview_text = compact_preview(raw_preview_text, max_length=2000)
        else:
            preview_text = summarize_tool_args(str(tool_name or ""), args, preview)

        if event_type == "reasoning.available" and preview_text:
            reasoning_previews.append(preview_text)
        if should_emit_reasoning_activity(event_type, preview_text):
            preview_text, next_reasoning_text = append_reasoning_activity_preview(
                reasoning_delta_parts,
                last_reasoning_delta_text,
                raw_preview_text,
                max_length=2000,
            )
            last_reasoning_delta_text = next_reasoning_text
            if not preview_text:
                return
            if preview_text == last_emitted_reasoning_preview:
                return
            last_emitted_reasoning_preview = preview_text
            emit_activity(
                event_type=event_type,
                tool_name="thinking",
                preview=preview_text,
                status="running",
            )
            return
        if is_reasoning_event:
            emit({"type": "status", "text": "正在思考中"})
            return
        if event_type == "tool.started":
            emit_activity(
                event_type=event_type,
                tool_name=str(tool_name or ""),
                skill_name=extract_skill_name(str(tool_name or ""), args),
                preview=preview_text,
                status="running",
            )
            return
        if event_type in {"tool.completed", "tool.error"}:
            is_error = bool(metadata.get("is_error")) or event_type == "tool.error"
            emit_activity(
                event_type=event_type,
                tool_name=str(tool_name or ""),
                skill_name=extract_skill_name(str(tool_name or ""), args),
                preview=preview_text,
                status="error" if is_error else "done",
                duration=metadata.get("duration"),
                is_error=is_error,
            )
            return
        emit({"type": "status", "text": humanize_status(event_type, preview or tool_name or "")})

    def on_status(event_type: str, message: str) -> None:
        emit({"type": "status", "text": humanize_status(event_type, message)})

    def on_reasoning_delta(text: str) -> None:
        nonlocal last_reasoning_delta_text, last_emitted_reasoning_preview
        preview_text, next_reasoning_text = append_reasoning_activity_preview(
            reasoning_delta_parts,
            last_reasoning_delta_text,
            text,
            max_length=2000,
        )
        last_reasoning_delta_text = next_reasoning_text
        if not preview_text:
            return
        if preview_text == last_emitted_reasoning_preview:
            return
        last_emitted_reasoning_preview = preview_text
        emit_activity(
            event_type="_thinking",
            tool_name="thinking",
            preview=preview_text,
            status="running",
        )

    def clarify_callback(question: str, choices=None) -> str:
        if choices:
            return (
                f"[bridge mode: no user available. Pick the best option from "
                f"{choices} using your own judgment and continue.]"
            )
        return "[bridge mode: no user available. Make the most reasonable assumption you can and continue.]"

    agent = AIAgent(
        api_key=runtime.get("api_key"),
        base_url=runtime.get("base_url"),
        provider=runtime.get("provider"),
        api_mode=runtime.get("api_mode"),
        model=effective_model,
        enabled_toolsets=toolsets_list,
        quiet_mode=True,
        platform="cli",
        session_id=session_id,
        session_db=session_db,
        credential_pool=runtime.get("credential_pool"),
        clarify_callback=clarify_callback,
        fallback_model=fallback_chain,
        reasoning_config=reasoning_config,
        reasoning_callback=on_reasoning_delta,
        load_soul_identity=True,
    )

    agent.suppress_status_output = True
    agent.tool_progress_callback = on_tool_progress
    agent.interim_assistant_callback = on_interim
    agent.stream_delta_callback = on_stream_delta
    agent.status_callback = on_status

    prompt = preprocess_bridge_images(agent, prompt, image_paths)

    original_build_api_kwargs = getattr(agent, "_build_api_kwargs", None)
    if callable(original_build_api_kwargs):
        def _bridge_safe_build_api_kwargs(self, api_messages):
            safe_messages = prepare_messages_for_non_vision_model(self, copy.deepcopy(api_messages))
            api_kwargs = original_build_api_kwargs(safe_messages)
            apply_runtime_reasoning_to_api_kwargs(
                api_kwargs,
                provider=getattr(self, "provider", None),
                base_url=getattr(self, "base_url", None),
                reasoning_config=getattr(self, "reasoning_config", None),
            )
            return api_kwargs

        agent._build_api_kwargs = _bridge_safe_build_api_kwargs.__get__(agent, agent.__class__)

    try:
        result = agent.run_conversation(
            prompt,
            system_message=system_prompt or None,
            conversation_history=conversation_history,
        )
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        return 1

    streamed_text = "".join(streamed_chunks).strip()
    message_contents = [
        str(message.get("content") or "").strip()
        for message in (result.get("messages") or [])
        if isinstance(message, dict) and message.get("role") == "assistant"
    ]
    final_text = pick_bridge_final_text(
        final_text=result.get("final_response"),
        streamed_text=streamed_text,
        progress_texts=progress_texts,
        reasoning_previews=reasoning_previews,
        message_contents=message_contents,
    )

    emit({
        "type": "final",
        "text": final_text,
        "sessionId": agent.session_id,
        "usage": build_usage_summary(result),
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
