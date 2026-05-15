#!/usr/bin/env python3
from __future__ import annotations

import json
import logging
import os
import sys
import copy
import asyncio
from pathlib import Path
from typing import Any

DEFAULT_HERMES_AGENT_ROOT = "/Users/lijiahao/.hermes/hermes-agent"
DEFAULT_HERMES_HOME = str(Path.home() / ".hermes")


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


def append_reasoning_delta_preview(buffer: list[str], text: Any, *, max_length: int = 2000) -> str:
    chunk = str(text or "")
    if not chunk:
        return ""
    buffer.append(chunk)
    return compact_preview("".join(buffer), max_length=max_length)


def extract_new_reasoning_delta(previous_text: str, text: Any) -> tuple[str, str]:
    """Return only newly exposed reasoning text, tolerating cumulative snapshots."""
    chunk = str(text or "")
    if not chunk:
        return "", previous_text
    if previous_text:
        if chunk == previous_text or chunk in previous_text or previous_text.endswith(chunk):
            return "", previous_text
        if chunk.startswith(previous_text):
            return chunk[len(previous_text):], chunk
    return chunk, f"{previous_text}{chunk}"


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

    for key in ("query", "path", "file", "name", "command", "url", "image_url", "prompt"):
        value = args.get(key)
        if value:
            return f"{key}={compact_preview(value)}"

    try:
        return compact_preview(json.dumps(args, ensure_ascii=False), max_length=120)
    except Exception:
        return compact_preview(args)


def emit_activity(
    *,
    event_type: str,
    tool_name: str = "",
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
    for group in (
        [final_text or "", streamed_text or ""],
        reasoning_previews or [],
        progress_texts or [],
        message_contents or [],
    ):
        for item in group:
            text = str(item or "").strip()
            if not text or text in seen:
                continue
            seen.add(text)
            candidates.append(text)
    return candidates[0] if candidates else ""


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

    hermes_agent_root = Path(os.environ.get("HERMES_AGENT_ROOT", DEFAULT_HERMES_AGENT_ROOT)).expanduser()
    if str(hermes_agent_root) not in sys.path:
        sys.path.insert(0, str(hermes_agent_root))

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
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception as exc:
        emit({"type": "error", "message": f"Invalid bridge payload: {exc}"})
        return 1

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
        nonlocal last_reasoning_delta_text
        is_reasoning_event = event_type in {"_thinking", "reasoning.available"}
        if is_reasoning_event:
            preview_text = compact_preview(preview or args, max_length=2000)
        else:
            preview_text = summarize_tool_args(str(tool_name or ""), args, preview)

        if event_type == "reasoning.available" and preview_text:
            reasoning_previews.append(preview_text)
        if should_emit_reasoning_activity(event_type, preview_text):
            delta, next_reasoning_text = extract_new_reasoning_delta(last_reasoning_delta_text, preview_text)
            last_reasoning_delta_text = next_reasoning_text
            if not should_display_reasoning_delta(delta):
                return
            preview_text = append_reasoning_delta_preview(reasoning_delta_parts, delta, max_length=2000)
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
                preview=preview_text,
                status="running",
            )
            return
        if event_type in {"tool.completed", "tool.error"}:
            is_error = bool(metadata.get("is_error")) or event_type == "tool.error"
            emit_activity(
                event_type=event_type,
                tool_name=str(tool_name or ""),
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
        nonlocal last_reasoning_delta_text
        delta, next_reasoning_text = extract_new_reasoning_delta(last_reasoning_delta_text, text)
        last_reasoning_delta_text = next_reasoning_text
        if not should_display_reasoning_delta(delta):
            return
        preview_text = append_reasoning_delta_preview(reasoning_delta_parts, delta, max_length=2000)
        if not preview_text:
            return
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
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
