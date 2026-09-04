// WS message shape validation (layer 1 fail-closed fence).
// Extracted from server.ts (C10-A mechanical split) — zero behavior change.
// Re-exported from server.ts for test/public API stability.
//
// FREEZE: NEW client→server message types MUST register a validator key here
// (keep lockstep with message-router case arms — see ws-router-validator-lockstep.test).

import { STT_MAX_CHUNK_BYTES, STT_MAX_RECORD_MS } from "../voice/session-caps"

// --- WS message validation ---

export interface WsValidationResult {
  valid: boolean
  error?: string
}

export function validateWsMessage(msg: any): WsValidationResult {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return { valid: false, error: "Message must be an object" }
  }
  if (typeof msg.type !== "string" || !msg.type) {
    return { valid: false, error: "Message type must be a non-empty string" }
  }

  // Known message types with required field validation
  const validators: Record<string, (m: any) => WsValidationResult> = {
    "chat.create": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "chat.create requires thread_id" }
      if (typeof m.message !== "string") return { valid: false, error: "chat.create requires message string" }
      if (m.skill_ids !== undefined && !Array.isArray(m.skill_ids)) return { valid: false, error: "skill_ids must be an array" }
      // Optional site-knowledge context (not a security gate)
      if (m.hostname !== undefined && typeof m.hostname !== "string") return { valid: false, error: "hostname must be a string" }
      if (m.url !== undefined && typeof m.url !== "string") return { valid: false, error: "url must be a string" }
      // P1.5 @ thread refs
      if (m.context_refs !== undefined) {
        if (!Array.isArray(m.context_refs)) return { valid: false, error: "context_refs must be an array" }
        if (m.context_refs.length > 8) return { valid: false, error: "context_refs max 8" }
      }
      if (m.enqueue !== undefined && typeof m.enqueue !== "boolean") {
        return { valid: false, error: "enqueue must be a boolean" }
      }
      return { valid: true }
    },
    "chat.steer": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "chat.steer requires thread_id" }
      }
      if (typeof m.message !== "string" || !m.message.trim()) {
        return { valid: false, error: "empty_steer" }
      }
      return { valid: true }
    },
    "chat.abort": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "chat.abort requires thread_id" }
      return { valid: true }
    },
    "chat.regenerate": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "chat.regenerate requires thread_id" }
      if (typeof m.message_id !== "string" || !m.message_id) return { valid: false, error: "chat.regenerate requires message_id" }
      if (m.message !== undefined && typeof m.message !== "string") return { valid: false, error: "chat.regenerate message must be a string" }
      if (m.hostname !== undefined && typeof m.hostname !== "string") return { valid: false, error: "hostname must be a string" }
      if (m.url !== undefined && typeof m.url !== "string") return { valid: false, error: "url must be a string" }
      return { valid: true }
    },
    "composer.lease.get": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "composer.lease.get requires thread_id" }
      }
      return { valid: true }
    },
    "composer.lease.claim": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "composer.lease.claim requires thread_id" }
      }
      if (m.holder !== "overlay" && m.holder !== "panel") {
        return { valid: false, error: 'composer.lease.claim holder must be "overlay" | "panel"' }
      }
      if (typeof m.rev !== "number" || !Number.isInteger(m.rev)) {
        return { valid: false, error: "composer.lease.claim requires rev number" }
      }
      return { valid: true }
    },
    "composer.lease.release": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "composer.lease.release requires thread_id" }
      }
      if (typeof m.rev !== "number" || !Number.isInteger(m.rev)) {
        return { valid: false, error: "composer.lease.release requires rev number" }
      }
      return { valid: true }
    },
    "composer.lease.release_overlay": () => ({ valid: true }),
    "companion.ui.rect": (m) => {
      if (typeof m.surface !== "string" || !m.surface) {
        return { valid: false, error: "companion.ui.rect requires surface" }
      }
      return { valid: true }
    },
    "thread.create": (m) => {
      if (m.alias !== undefined && typeof m.alias !== "string") return { valid: false, error: "alias must be a string" }
      if (m.id !== undefined && typeof m.id !== "string") return { valid: false, error: "id must be a string" }
      return { valid: true }
    },
    "thread.delete": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "thread.delete requires thread_id" }
      if (m.mode !== undefined && m.mode !== "trash" && m.mode !== "hard") {
        return { valid: false, error: "thread.delete mode must be trash|hard" }
      }
      return { valid: true }
    },
    "thread.batch_delete": (m) => {
      if (!Array.isArray(m.thread_ids) || m.thread_ids.length === 0) {
        return { valid: false, error: "thread.batch_delete requires non-empty thread_ids" }
      }
      if (m.thread_ids.length > 50) {
        return { valid: false, error: "thread.batch_delete max 50 threads" }
      }
      if (!m.thread_ids.every((id: unknown) => typeof id === "string" && id.length > 0)) {
        return { valid: false, error: "thread.batch_delete thread_ids must be non-empty strings" }
      }
      if (m.mode !== undefined && m.mode !== "trash" && m.mode !== "hard") {
        return { valid: false, error: "thread.batch_delete mode must be trash|hard" }
      }
      return { valid: true }
    },
    "thread.restore": (m) => {
      const hasOne = typeof m.thread_id === "string" && m.thread_id
      const hasMany = Array.isArray(m.thread_ids) && m.thread_ids.length > 0
      if (!hasOne && !hasMany) {
        return { valid: false, error: "thread.restore requires thread_id or thread_ids" }
      }
      return { valid: true }
    },
    "thread.suggest_cleanup": () => ({ valid: true }),
    "thread.batch_auto_title": (m) => {
      if (m.thread_ids !== undefined) {
        if (!Array.isArray(m.thread_ids)) {
          return { valid: false, error: "thread_ids must be an array" }
        }
        if (m.thread_ids.length > 50) {
          return { valid: false, error: "thread.batch_auto_title max 50 thread_ids" }
        }
      }
      return { valid: true }
    },
    "thread.extract_digest": (m) => {
      const hasOne = typeof m.thread_id === "string" && m.thread_id
      const hasMany = Array.isArray(m.thread_ids) && m.thread_ids.length > 0
      if (!hasOne && !hasMany) {
        return { valid: false, error: "thread.extract_digest requires thread_id or thread_ids" }
      }
      if (hasMany && m.thread_ids.length > 20) {
        return { valid: false, error: "thread.extract_digest max 20 threads" }
      }
      return { valid: true }
    },
    "knowledge.related": (m) => {
      if (typeof m.id !== "string" || !m.id) {
        return { valid: false, error: "knowledge.related requires id" }
      }
      if (m.limit !== undefined && (typeof m.limit !== "number" || m.limit < 1 || m.limit > 3)) {
        return { valid: false, error: "knowledge.related limit must be 1–3" }
      }
      return { valid: true }
    },
    "thread.distill_preview": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "thread.distill_preview requires thread_id" }
      }
      return { valid: true }
    },
    "thread.related": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "thread.related requires thread_id" }
      }
      if (m.limit !== undefined && (typeof m.limit !== "number" || m.limit < 1 || m.limit > 20)) {
        return { valid: false, error: "thread.related limit must be 1–20" }
      }
      return { valid: true }
    },
    "thread.cleanup_empty": () => ({ valid: true }),
    "thread.select": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "thread.select requires thread_id" }
      return { valid: true }
    },
    "thread.fork": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "thread.fork requires thread_id" }
      if (typeof m.message_id !== "string" || !m.message_id) return { valid: false, error: "thread.fork requires message_id" }
      return { valid: true }
    },
    "thread.update": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "thread.update requires thread_id" }
      if (!m.updates || typeof m.updates !== "object") return { valid: false, error: "thread.update requires updates object" }
      return { valid: true }
    },
    "thread.run_progress.toggle": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "thread.run_progress.toggle requires thread_id" }
      }
      if (typeof m.item_id !== "string" || !m.item_id) {
        return { valid: false, error: "thread.run_progress.toggle requires item_id" }
      }
      return { valid: true }
    },
    "overlay.shell.open": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "overlay.shell.open requires thread_id" }
      }
      return { valid: true }
    },
    "ui.open_sidepanel": () => ({ valid: true }),
    "ui.open_sidepanel.result": (m) => {
      if (typeof m.id !== "string" || !m.id) return { valid: false, error: "ui.open_sidepanel.result requires id" }
      if (typeof m.ok !== "boolean") return { valid: false, error: "ui.open_sidepanel.result requires ok boolean" }
      if (m.error !== undefined && typeof m.error !== "string") return { valid: false, error: "error must be a string" }
      return { valid: true }
    },
    "skill.activate": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "skill.activate requires thread_id" }
      if (typeof m.skill_name !== "string" || !m.skill_name) return { valid: false, error: "skill.activate requires skill_name" }
      return { valid: true }
    },
    "skill.deactivate": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "skill.deactivate requires thread_id" }
      if (typeof m.skill_name !== "string" || !m.skill_name) return { valid: false, error: "skill.deactivate requires skill_name" }
      return { valid: true }
    },
    "skill.import": (m) => {
      if (!m.url && !m.content) return { valid: false, error: "skill.import requires url or content" }
      if (m.url !== undefined && typeof m.url !== "string") return { valid: false, error: "url must be a string" }
      if (m.content !== undefined && typeof m.content !== "string") return { valid: false, error: "content must be a string" }
      return { valid: true }
    },
    "skill.delete": (m) => {
      if (typeof m.skill_name !== "string" || !m.skill_name) return { valid: false, error: "skill.delete requires skill_name" }
      return { valid: true }
    },
    "skill.export": (m) => {
      if (typeof m.skill_name !== "string" || !m.skill_name) return { valid: false, error: "skill.export requires skill_name" }
      return { valid: true }
    },
    "skill.craft": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "skill.craft requires thread_id" }
      return { valid: true }
    },
    "config.set": (m) => {
      if (!m.config || typeof m.config !== "object") return { valid: false, error: "config.set requires config object" }
      return { valid: true }
    },
    "history.query": () => ({ valid: true }),
    "history.export": () => ({ valid: true }),
    "security.confirmation.response": (m) => {
      if (typeof m.confirmation_id !== "string" || !m.confirmation_id) return { valid: false, error: "confirmation_id required" }
      if (typeof m.approved !== "boolean") return { valid: false, error: "approved must be a boolean" }
      return { valid: true }
    },
    "computer.task.abort": (m) => {
      if (typeof m.task_id !== "string" || !m.task_id) return { valid: false, error: "computer.task.abort requires task_id (a task id or '*')" }
      return { valid: true }
    },
    "acp.list": () => ({ valid: true }),
    "acp.rediscover": () => ({ valid: true }),
    "acp.adopt_discovered": () => ({ valid: true }),
    "acp.session.cancel": (m) => {
      if (typeof m.session_id !== "string" || !m.session_id) {
        return { valid: false, error: "acp.session.cancel requires session_id" }
      }
      return { valid: true }
    },
    "acp.session.followup": (m) => {
      if (typeof m.session_id !== "string" || !m.session_id) {
        return { valid: false, error: "acp.session.followup requires session_id" }
      }
      if (typeof m.goal !== "string" || !m.goal.trim()) {
        return { valid: false, error: "acp.session.followup requires goal" }
      }
      return { valid: true }
    },
    "acp.session.prompt": (m) => {
      if (typeof m.session_id !== "string" || !m.session_id) {
        return { valid: false, error: "acp.session.prompt requires session_id" }
      }
      const text = m.text ?? m.goal
      if (typeof text !== "string" || !String(text).trim()) {
        return { valid: false, error: "acp.session.prompt requires text" }
      }
      return { valid: true }
    },
    "acp.ui_start": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "acp.ui_start requires thread_id" }
      }
      if (typeof m.agent_id !== "string" || !m.agent_id) {
        return { valid: false, error: "acp.ui_start requires agent_id" }
      }
      if (typeof m.goal !== "string" || !m.goal.trim()) {
        return { valid: false, error: "acp.ui_start requires goal" }
      }
      return { valid: true }
    },
    "acp.apply_diff": (m) => {
      if (typeof m.session_id !== "string" || !m.session_id) {
        return { valid: false, error: "acp.apply_diff requires session_id" }
      }
      return { valid: true }
    },
    // B-lite S1: git one-line — workspace_root or thread_id (handler resolves)
    "coding.git_status": (m) => {
      const hasRoot =
        typeof m.workspace_root === "string" && m.workspace_root.trim().length > 0
      const hasWs =
        typeof m.workspace === "string" && String(m.workspace).trim().length > 0
      const hasThread =
        typeof m.thread_id === "string" && m.thread_id.trim().length > 0
      if (!hasRoot && !hasWs && !hasThread) {
        return {
          valid: false,
          error: "coding.git_status requires workspace_root or thread_id",
        }
      }
      return { valid: true }
    },
    "acp.workspace_status": (m) => {
      const hasRoot =
        typeof m.workspace_root === "string" && m.workspace_root.trim().length > 0
      const hasThread =
        typeof m.thread_id === "string" && m.thread_id.trim().length > 0
      if (!hasRoot && !hasThread) {
        return {
          valid: false,
          error: "acp.workspace_status requires workspace_root or thread_id",
        }
      }
      return { valid: true }
    },
    "shell.exec.abort": (m) => {
      const hasTool =
        typeof m.tool_call_id === "string" && m.tool_call_id.length > 0
      const hasThread = typeof m.thread_id === "string" && m.thread_id.length > 0
      if (!hasTool && !hasThread) {
        return {
          valid: false,
          error: "shell.exec.abort requires tool_call_id and/or thread_id",
        }
      }
      return { valid: true }
    },
    "computer.evidence.open": (m) => {
      if (typeof m.task_id !== "string" || !m.task_id) return { valid: false, error: "computer.evidence.open requires task_id" }
      return { valid: true }
    },
    "computer.model.get_state": () => ({ valid: true }),
    // WP5 I3 登记项③（plan:480 M3）：熔断手动复位仅接受设置页声明来源——
    // 未知类型默认放行（本函数尾部），故此条目是真围栏；handler 层二次核查。
    "computer.model.reset_circuit_breaker": (m) => {
      if (m.source !== "settings") return { valid: false, error: 'computer.model.reset_circuit_breaker requires source:"settings" (settings-page only)' }
      return { valid: true }
    },
    // WP5-I4 WI-4.2 开关族（plan:538）：四路由同样仅设置页来源（双层围栏第一
    // 层；handler belt 为第二层，P6）。set_enabled/license_response 另强制形状。
    "computer.model.set_enabled": (m) => {
      if (typeof m.enabled !== "boolean") return { valid: false, error: "computer.model.set_enabled requires enabled:boolean" }
      if (m.source !== "settings") return { valid: false, error: 'computer.model.set_enabled requires source:"settings" (settings-page only)' }
      return { valid: true }
    },
    "computer.model.license_response": (m) => {
      // D9: reset_decline clears a prior decline without accepting the license text.
      const isReset = m.reset_decline === true || m.resetDecline === true
      if (!isReset && typeof m.accepted !== "boolean") {
        return { valid: false, error: "computer.model.license_response requires accepted:boolean (or reset_decline:true)" }
      }
      if (m.source !== "settings") return { valid: false, error: 'computer.model.license_response requires source:"settings" (settings-page only)' }
      return { valid: true }
    },
    "computer.model.download": (m) => {
      if (m.source !== "settings") return { valid: false, error: 'computer.model.download requires source:"settings" (settings-page only)' }
      return { valid: true }
    },
    "computer.model.delete": (m) => {
      if (m.source !== "settings") return { valid: false, error: 'computer.model.delete requires source:"settings" (settings-page only)' }
      return { valid: true }
    },
    "computer.model.set_variant": (m) => {
      if (m.source !== "settings") return { valid: false, error: 'computer.model.set_variant requires source:"settings" (settings-page only)' }
      if (m.variant !== "2b" && m.variant !== "4b" && m.variant !== "8b") {
        return { valid: false, error: 'computer.model.set_variant requires variant:"2b"|"4b"|"8b"' }
      }
      return { valid: true }
    },
    "computer.model.set_download_source": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'computer.model.set_download_source requires source:"settings" (settings-page only)' }
      }
      const ds = m.downloadSource
      if (ds !== "auto" && ds !== "huggingface" && ds !== "hf-mirror" && ds !== "modelscope") {
        return {
          valid: false,
          error: 'computer.model.set_download_source requires downloadSource:"auto"|"huggingface"|"hf-mirror"|"modelscope"',
        }
      }
      return { valid: true }
    },
    "computer.model.set_model_root": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'computer.model.set_model_root requires source:"settings"' }
      }
      return { valid: true }
    },
    "computer.model.pick_model_root": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'computer.model.pick_model_root requires source:"settings"' }
      }
      return { valid: true }
    },
    "computer.model.set_python_mode": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'computer.model.set_python_mode requires source:"settings"' }
      }
      if (m.mode !== "isolated" && m.mode !== "system") {
        return { valid: false, error: 'computer.model.set_python_mode requires mode:"isolated"|"system"' }
      }
      return { valid: true }
    },
    "computer.model.pick_python_path": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'computer.model.pick_python_path requires source:"settings"' }
      }
      return { valid: true }
    },
    "computer.model.ensure_python_env": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'computer.model.ensure_python_env requires source:"settings"' }
      }
      return { valid: true }
    },
    "computer.model.install_deps": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'computer.model.install_deps requires source:"settings"' }
      }
      return { valid: true }
    },
    // Path B M0 — voice.model.* (ADR-023 L7 dual fence layer 1; handler belt = layer 2)
    "voice.model.get_state": () => ({ valid: true }),
    // #259: system-engine probe (read-only; origin fence in handler)
    "voice.system.state": () => ({ valid: true }),
    "voice.model.download": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'voice.model.download requires source:"settings" (settings-page only)' }
      }
      if (m.modelId !== "small" && m.modelId !== "medium" && m.modelId !== "large-v3-turbo") {
        return { valid: false, error: 'voice.model.download requires modelId:"small"|"medium"|"large-v3-turbo"' }
      }
      return { valid: true }
    },
    "voice.model.cancel": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'voice.model.cancel requires source:"settings" (settings-page only)' }
      }
      if (m.modelId !== "small" && m.modelId !== "medium" && m.modelId !== "large-v3-turbo") {
        return { valid: false, error: 'voice.model.cancel requires modelId:"small"|"medium"|"large-v3-turbo"' }
      }
      return { valid: true }
    },
    "voice.model.delete": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'voice.model.delete requires source:"settings" (settings-page only)' }
      }
      if (m.modelId !== "small" && m.modelId !== "medium" && m.modelId !== "large-v3-turbo") {
        return { valid: false, error: 'voice.model.delete requires modelId:"small"|"medium"|"large-v3-turbo"' }
      }
      return { valid: true }
    },
    // #260 — diarize speaker-embedding model (single pinned model, settings-page only)
    "voice.model.diarize_download": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'voice.model.diarize_download requires source:"settings"' }
      }
      return { valid: true }
    },
    "voice.model.diarize_cancel": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'voice.model.diarize_cancel requires source:"settings"' }
      }
      return { valid: true }
    },
    "voice.model.diarize_delete": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'voice.model.diarize_delete requires source:"settings"' }
      }
      return { valid: true }
    },
    "voice.model.set_active": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'voice.model.set_active requires source:"settings" (settings-page only)' }
      }
      if (m.modelId !== "small" && m.modelId !== "medium" && m.modelId !== "large-v3-turbo") {
        return { valid: false, error: 'voice.model.set_active requires modelId:"small"|"medium"|"large-v3-turbo"' }
      }
      return { valid: true }
    },
    "voice.model.set_engine": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'voice.model.set_engine requires source:"settings" (settings-page only)' }
      }
      if (m.engine !== "browser" && m.engine !== "local" && m.engine !== "system") {
        return { valid: false, error: 'voice.model.set_engine requires engine:"browser"|"local"|"system"' }
      }
      return { valid: true }
    },
    "voice.model.set_prefs": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'voice.model.set_prefs requires source:"settings" (settings-page only)' }
      }
      if (m.autoFallbackToBrowser !== undefined && typeof m.autoFallbackToBrowser !== "boolean") {
        return { valid: false, error: "voice.model.set_prefs autoFallbackToBrowser must be boolean" }
      }
      if (m.modelDownloadEndpoint !== undefined && typeof m.modelDownloadEndpoint !== "string") {
        return { valid: false, error: "voice.model.set_prefs modelDownloadEndpoint must be string" }
      }
      if (m.postprocessFillers !== undefined && typeof m.postprocessFillers !== "boolean") {
        return { valid: false, error: "voice.model.set_prefs postprocessFillers must be boolean" }
      }
      if (m.postprocessLowercase !== undefined && typeof m.postprocessLowercase !== "boolean") {
        return { valid: false, error: "voice.model.set_prefs postprocessLowercase must be boolean" }
      }
      if (m.postprocessStripPunct !== undefined && typeof m.postprocessStripPunct !== "boolean") {
        return { valid: false, error: "voice.model.set_prefs postprocessStripPunct must be boolean" }
      }
      if (m.modelPrewarm !== undefined && typeof m.modelPrewarm !== "boolean") {
        return { valid: false, error: "voice.model.set_prefs modelPrewarm must be boolean" }
      }
      if (
        m.autoFallbackToBrowser === undefined &&
        m.modelDownloadEndpoint === undefined &&
        m.postprocessFillers === undefined &&
        m.postprocessLowercase === undefined &&
        m.postprocessStripPunct === undefined &&
        m.modelPrewarm === undefined &&
        m.postprocessMap === undefined
      ) {
        return { valid: false, error: "voice.model.set_prefs requires at least one field" }
      }
      return { valid: true }
    },
    "voice.binary.download": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'voice.binary.download requires source:"settings" (settings-page only)' }
      }
      return { valid: true }
    },
    "voice.binary.cancel": (m) => {
      if (m.source !== "settings") {
        return { valid: false, error: 'voice.binary.cancel requires source:"settings" (settings-page only)' }
      }
      return { valid: true }
    },
    // Path B M1 — voice.stt.* (runtime Side Panel; NOT source:settings; origin fence in handler)
    "voice.stt.start": (m) => {
      if (m.v !== 1) {
        return { valid: false, error: "voice.stt.start requires v:1" }
      }
      if (typeof m.sessionId !== "string" || !m.sessionId || m.sessionId.length > 128) {
        return { valid: false, error: "voice.stt.start requires sessionId string (1–128)" }
      }
      // #259: engine, when present, must be "system" (per-session SAPI
      // fallback); "system" makes modelId optional (no whisper model involved).
      if (m.engine !== undefined && m.engine !== "system") {
        return { valid: false, error: 'voice.stt.start engine must be "system" when present' }
      }
      if (m.engine === "system") {
        if (m.modelId !== undefined && (typeof m.modelId !== "string" || m.modelId.length > 64)) {
          return { valid: false, error: "voice.stt.start modelId must be a short string for system sessions" }
        }
      } else if (m.modelId !== "small" && m.modelId !== "medium" && m.modelId !== "large-v3-turbo") {
        return { valid: false, error: 'voice.stt.start requires modelId:"small"|"medium"|"large-v3-turbo"' }
      }
      if (m.format !== "pcm_s16le" && m.format !== "wav") {
        return { valid: false, error: 'voice.stt.start requires format:"pcm_s16le"|"wav"' }
      }
      if (m.sampleRate !== 16000) {
        return { valid: false, error: "voice.stt.start requires sampleRate:16000" }
      }
      if (m.channels !== 1) {
        return { valid: false, error: "voice.stt.start requires channels:1" }
      }
      if (m.lang !== undefined && typeof m.lang !== "string") {
        return { valid: false, error: "voice.stt.start lang must be a string when present" }
      }
      if (m.maxMs !== undefined) {
        if (typeof m.maxMs !== "number" || !Number.isFinite(m.maxMs) || m.maxMs <= 0 || m.maxMs > STT_MAX_RECORD_MS) {
          return { valid: false, error: `voice.stt.start maxMs must be 1..${STT_MAX_RECORD_MS}` }
        }
      }
      // P1: privacy_ack_v2 required on the wire (handler also enforces)
      if (m.privacy_ack_v2 !== true) {
        return { valid: false, error: "voice.stt.start requires privacy_ack_v2:true" }
      }
      return { valid: true }
    },
    "voice.stt.chunk": (m) => {
      if (m.v !== 1) {
        return { valid: false, error: "voice.stt.chunk requires v:1" }
      }
      if (typeof m.sessionId !== "string" || !m.sessionId) {
        return { valid: false, error: "voice.stt.chunk requires sessionId string" }
      }
      if (!Number.isInteger(m.seq) || m.seq < 0) {
        return { valid: false, error: "voice.stt.chunk requires seq non-negative integer" }
      }
      if (typeof m.data !== "string") {
        return { valid: false, error: "voice.stt.chunk requires data base64 string" }
      }
      // Cap decoded size without logging audio contents
      let decodedLen: number
      try {
        decodedLen = Buffer.from(m.data, "base64").length
      } catch {
        return { valid: false, error: "voice.stt.chunk data is not valid base64" }
      }
      if (decodedLen > STT_MAX_CHUNK_BYTES) {
        return {
          valid: false,
          error: `voice.stt.chunk decoded size exceeds ${STT_MAX_CHUNK_BYTES} bytes`,
        }
      }
      return { valid: true }
    },
    "voice.stt.end": (m) => {
      if (m.v !== 1) {
        return { valid: false, error: "voice.stt.end requires v:1" }
      }
      if (typeof m.sessionId !== "string" || !m.sessionId) {
        return { valid: false, error: "voice.stt.end requires sessionId string" }
      }
      if (!Number.isInteger(m.totalSeq) || m.totalSeq < 0) {
        return { valid: false, error: "voice.stt.end requires totalSeq non-negative integer" }
      }
      return { valid: true }
    },
    "voice.stt.abort": (m) => {
      if (m.v !== 1) {
        return { valid: false, error: "voice.stt.abort requires v:1" }
      }
      if (typeof m.sessionId !== "string" || !m.sessionId) {
        return { valid: false, error: "voice.stt.abort requires sessionId string" }
      }
      return { valid: true }
    },
    // Path B M2 — progressive hypothesis (re-decode cumulative audio; no fake tokens)
    "voice.stt.partial_request": (m) => {
      if (m.v !== 1) {
        return { valid: false, error: "voice.stt.partial_request requires v:1" }
      }
      if (typeof m.sessionId !== "string" || !m.sessionId || m.sessionId.length > 128) {
        return {
          valid: false,
          error: "voice.stt.partial_request requires sessionId string (1–128)",
        }
      }
      return { valid: true }
    },
    // Dictation+ D1b — ASR Refiner (text-only; origin fence in handler)
    "voice.refine.request": (m) => {
      if (m.v !== 1) {
        return { valid: false, error: "voice.refine.request requires v:1" }
      }
      if (typeof m.sessionId !== "string" || !m.sessionId || m.sessionId.length > 128) {
        return { valid: false, error: "voice.refine.request requires sessionId string (1–128)" }
      }
      if (!Number.isInteger(m.refineGen) || m.refineGen < 0) {
        return { valid: false, error: "voice.refine.request requires refineGen non-negative integer" }
      }
      if (typeof m.text !== "string" || !m.text) {
        return { valid: false, error: "voice.refine.request requires text string" }
      }
      if (m.text.length > 12_000) {
        return { valid: false, error: "voice.refine.request text exceeds 12000 chars" }
      }
      // Optional prior transcript for meeting live STT disambiguation (≤2k)
      if (m.priorContext != null && typeof m.priorContext !== "string") {
        return { valid: false, error: "voice.refine.request priorContext must be string" }
      }
      if (typeof m.priorContext === "string" && m.priorContext.length > 2_000) {
        return { valid: false, error: "voice.refine.request priorContext exceeds 2000 chars" }
      }
      return { valid: true }
    },
    "voice.refine.abort": (m) => {
      if (m.v !== 1) {
        return { valid: false, error: "voice.refine.abort requires v:1" }
      }
      if (typeof m.sessionId !== "string" || !m.sessionId) {
        return { valid: false, error: "voice.refine.abort requires sessionId string" }
      }
      if (!Number.isInteger(m.refineGen) || m.refineGen < 0) {
        return { valid: false, error: "voice.refine.abort requires refineGen non-negative integer" }
      }
      return { valid: true }
    },
    // Dictation+ D2 hold indicator (control plane; no audio)
    "voice.dictation.hold_state": (m) => {
      if (m.v !== 1) return { valid: false, error: "voice.dictation.hold_state requires v:1" }
      if (typeof m.active !== "boolean") {
        return { valid: false, error: "voice.dictation.hold_state requires active boolean" }
      }
      return { valid: true }
    },
    // Meeting minutes scene (Mtg0/Mtg1)
    "meeting.create": (m) => {
      if (m.v !== 1) return { valid: false, error: "meeting.create requires v:1" }
      return { valid: true }
    },
    "meeting.start": (m) => {
      if (m.v !== 1) return { valid: false, error: "meeting.start requires v:1" }
      if (m.privacy_ack_v1 !== true) {
        return { valid: false, error: "meeting.start requires privacy_ack_v1:true" }
      }
      return { valid: true }
    },
    "meeting.end": (m) => {
      if (m.v !== 1) return { valid: false, error: "meeting.end requires v:1" }
      if (typeof m.id !== "string" || !m.id) return { valid: false, error: "meeting.end requires id" }
      return { valid: true }
    },
    "meeting.list": (m) => {
      if (m.v !== 1) return { valid: false, error: "meeting.list requires v:1" }
      return { valid: true }
    },
    "meeting.delete": (m) => {
      if (m.v !== 1) return { valid: false, error: "meeting.delete requires v:1" }
      if (typeof m.id !== "string" || !m.id) return { valid: false, error: "meeting.delete requires id" }
      return { valid: true }
    },
    "meeting.get": (m) => {
      if (m.v !== 1) return { valid: false, error: "meeting.get requires v:1" }
      if (typeof m.id !== "string" || !m.id) return { valid: false, error: "meeting.get requires id" }
      return { valid: true }
    },
    "meeting.set_transcript": (m) => {
      if (m.v !== 1) return { valid: false, error: "meeting.set_transcript requires v:1" }
      if (typeof m.id !== "string" || !m.id) return { valid: false, error: "meeting.set_transcript requires id" }
      if (typeof m.text !== "string") return { valid: false, error: "meeting.set_transcript requires text" }
      // P2 multi-hour meetings — keep in lock-step with MEETING_MINUTES_MAX_INPUT_CHARS
      if (m.text.length > 200_000) return { valid: false, error: "meeting.set_transcript text too long" }
      return { valid: true }
    },
    "meeting.append_transcript": (m) => {
      if (m.v !== 1) return { valid: false, error: "meeting.append_transcript requires v:1" }
      if (typeof m.id !== "string" || !m.id) return { valid: false, error: "meeting.append_transcript requires id" }
      if (typeof m.text !== "string" || !m.text.trim()) {
        return { valid: false, error: "meeting.append_transcript requires text" }
      }
      if (m.text.length > 16_000) {
        return { valid: false, error: "meeting.append_transcript text too long" }
      }
      return { valid: true }
    },
    "meeting.apply_silence_cut": (m) => {
      if (m.v !== 1) return { valid: false, error: "meeting.apply_silence_cut requires v:1" }
      if (typeof m.id !== "string" || !m.id) {
        return { valid: false, error: "meeting.apply_silence_cut requires id" }
      }
      return { valid: true }
    },
    "meeting.set_speakers": (m) => {
      if (m.v !== 1) return { valid: false, error: "meeting.set_speakers requires v:1" }
      if (typeof m.id !== "string" || !m.id) return { valid: false, error: "meeting.set_speakers requires id" }
      if (!Array.isArray(m.assignments)) {
        return { valid: false, error: "meeting.set_speakers requires assignments array" }
      }
      return { valid: true }
    },
    "meeting.bulk_speaker": (m) => {
      if (m.v !== 1) return { valid: false, error: "meeting.bulk_speaker requires v:1" }
      if (typeof m.id !== "string" || !m.id) return { valid: false, error: "meeting.bulk_speaker requires id" }
      return { valid: true }
    },
    "meeting.import_text": (m) => {
      if (m.v !== 1) return { valid: false, error: "meeting.import_text requires v:1" }
      if (m.privacy_ack_v1 !== true) {
        return { valid: false, error: "meeting.import_text requires privacy_ack_v1:true" }
      }
      if (typeof m.text !== "string" || !m.text.trim()) {
        return { valid: false, error: "meeting.import_text requires text" }
      }
      if (m.text.length > 200_000) return { valid: false, error: "meeting.import_text text too long" }
      return { valid: true }
    },
    // #260 — PCM upload pipeline for embedding diarize (in-memory only)
    "meeting.diarize.upload_start": (m) => {
      if (m.v !== 1) {
        return { valid: false, error: "meeting.diarize.upload_start requires v:1" }
      }
      if (m.privacy_ack_v1 !== true) {
        return { valid: false, error: "meeting.diarize.upload_start requires privacy_ack_v1:true" }
      }
      if (!Number.isInteger(m.segments) || m.segments < 1 || m.segments > 2000) {
        return { valid: false, error: "meeting.diarize.upload_start requires segments integer 1..2000" }
      }
      if (m.sample_rate !== 16000) {
        return { valid: false, error: "meeting.diarize.upload_start requires sample_rate:16000" }
      }
      if (m.format !== "pcm_s16le") {
        return { valid: false, error: 'meeting.diarize.upload_start requires format:"pcm_s16le"' }
      }
      return { valid: true }
    },
    "meeting.diarize.upload_chunk": (m) => {
      if (m.v !== 1) {
        return { valid: false, error: "meeting.diarize.upload_chunk requires v:1" }
      }
      if (typeof m.session_id !== "string" || !m.session_id || m.session_id.length > 64) {
        return { valid: false, error: "meeting.diarize.upload_chunk requires session_id string" }
      }
      if (!Number.isInteger(m.index) || m.index < 0 || m.index > 2000) {
        return { valid: false, error: "meeting.diarize.upload_chunk requires index non-negative integer" }
      }
      if (!Number.isInteger(m.seq) || m.seq < 0) {
        return { valid: false, error: "meeting.diarize.upload_chunk requires seq non-negative integer" }
      }
      if (typeof m.data !== "string" || !m.data) {
        return { valid: false, error: "meeting.diarize.upload_chunk requires data base64 string" }
      }
      let decodedLen: number
      try {
        decodedLen = Buffer.from(m.data, "base64").length
      } catch {
        return { valid: false, error: "meeting.diarize.upload_chunk data is not valid base64" }
      }
      if (decodedLen > 2 * 1024 * 1024) {
        return {
          valid: false,
          error: "meeting.diarize.upload_chunk decoded size exceeds 2MB",
        }
      }
      return { valid: true }
    },
    "meeting.diarize.upload_end": (m) => {
      if (m.v !== 1) {
        return { valid: false, error: "meeting.diarize.upload_end requires v:1" }
      }
      if (typeof m.session_id !== "string" || !m.session_id || m.session_id.length > 64) {
        return { valid: false, error: "meeting.diarize.upload_end requires session_id string" }
      }
      if (
        !Array.isArray(m.total_seqs) ||
        m.total_seqs.length < 1 ||
        m.total_seqs.length > 2000 ||
        !m.total_seqs.every((t: unknown) => Number.isInteger(t) && (t as number) >= 0)
      ) {
        return {
          valid: false,
          error: "meeting.diarize.upload_end requires total_seqs array of non-negative integers (1..2000)",
        }
      }
      return { valid: true }
    },
    "meeting.auto_diarize": (m) => {
      if (m.v !== 1) return { valid: false, error: "meeting.auto_diarize requires v:1" }
      if (m.privacy_ack_v1 !== true) {
        return { valid: false, error: "meeting.auto_diarize requires privacy_ack_v1:true" }
      }
      if (typeof m.id !== "string" || !m.id) {
        return { valid: false, error: "meeting.auto_diarize requires id" }
      }
      if (
        m.mode != null &&
        m.mode !== "audio_cluster" &&
        m.mode !== "text_gap" &&
        m.mode !== "embedding"
      ) {
        return {
          valid: false,
          error: "meeting.auto_diarize mode must be audio_cluster|text_gap|embedding",
        }
      }
      if (m.mode === "embedding") {
        if (typeof m.pcm_session !== "string" || !m.pcm_session || m.pcm_session.length > 64) {
          return { valid: false, error: "meeting.auto_diarize embedding requires pcm_session string" }
        }
      }
      if (m.pcm_session != null && (typeof m.pcm_session !== "string" || m.pcm_session.length > 64)) {
        return { valid: false, error: "meeting.auto_diarize pcm_session must be string (≤64)" }
      }
      if (m.features != null && !Array.isArray(m.features)) {
        return { valid: false, error: "meeting.auto_diarize features must be array" }
      }
      if (Array.isArray(m.features) && m.features.length > 2000) {
        return { valid: false, error: "meeting.auto_diarize features too long" }
      }
      if (m.text != null) {
        if (typeof m.text !== "string") {
          return { valid: false, error: "meeting.auto_diarize text must be string" }
        }
        if (m.text.length > 200_000) {
          return { valid: false, error: "meeting.auto_diarize text too long" }
        }
      }
      return { valid: true }
    },
    "meeting.generate_minutes": (m) => {
      if (m.v !== 1) return { valid: false, error: "meeting.generate_minutes requires v:1" }
      const hasId = typeof m.id === "string" && m.id
      const hasText = typeof m.text === "string" && m.text.trim()
      if (!hasId && !hasText) {
        return { valid: false, error: "meeting.generate_minutes requires id and/or text" }
      }
      if (m.template_md !== undefined) {
        if (typeof m.template_md !== "string") {
          return { valid: false, error: "template_md must be string" }
        }
        if (m.template_md.length > 16_384) {
          return { valid: false, error: "template_md too long" }
        }
      }
      return { valid: true }
    },
    "meeting.set_status": (m) => {
      if (m.v !== 1) return { valid: false, error: "meeting.set_status requires v:1" }
      if (typeof m.id !== "string" || !m.id) return { valid: false, error: "meeting.set_status requires id" }
      return { valid: true }
    },
    "tool.result": (m) => {
      if (typeof m.tool_call_id !== "string" || !m.tool_call_id) return { valid: false, error: "tool.result requires tool_call_id" }
      return { valid: true }
    },
    "log.event": (m) => {
      if (typeof m.event !== "string" || !m.event) return { valid: false, error: "log.event requires event string" }
      return { valid: true }
    },
    "system.ping": () => ({ valid: true }),
    // P0-2B: the ONLY message an unauthenticated peer may send. proof is verified
    // against HMAC-SHA256(sharedSecret, nonce) in the connection handler.
    "auth.handshake": (m) => {
      if (typeof m.proof !== "string" || !m.proof) {
        return { valid: false, error: "auth.handshake requires proof string" }
      }
      if (m.surface !== undefined && m.surface !== "tray" && m.surface !== "summoner") {
        return { valid: false, error: 'auth.handshake surface must be "tray" | "summoner"' }
      }
      return { valid: true }
    },
    "executeQuickAction": (m) => {
      const aid = m.actionId || m.id
      if (typeof aid !== "string" || !aid) return { valid: false, error: "executeQuickAction requires actionId" }
      return { valid: true }
    },
    "file.upload": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "file.upload requires thread_id" }
      if (!Array.isArray(m.files) || m.files.length === 0) return { valid: false, error: "files array required" }
      if (m.files.length > 10) return { valid: false, error: "最多上传 10 个文件" }
      for (const f of m.files) {
        if (!f.name || !f.type || !f.content) return { valid: false, error: "每个文件需要 name, type, content 字段" }
        if (typeof f.name !== "string" || typeof f.type !== "string" || typeof f.content !== "string") return { valid: false, error: "文件字段均为 string 类型" }
      }
      if (m.message !== undefined && typeof m.message !== "string") return { valid: false, error: "message 必须为字符串" }
      if (m.hostname !== undefined && typeof m.hostname !== "string") return { valid: false, error: "hostname must be a string" }
      if (m.url !== undefined && typeof m.url !== "string") return { valid: false, error: "url must be a string" }
      return { valid: true }
    },
    "file.query_chunks": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "file.query_chunks requires thread_id" }
      if (typeof m.query !== "string" || !m.query) return { valid: false, error: "query required" }
      return { valid: true }
    },
    "mcp.list": () => ({ valid: true }),
    "mcp.toggle_enabled": (m) => {
      if (typeof m.enabled !== "boolean") return { valid: false, error: "mcp.toggle_enabled requires boolean enabled" }
      return { valid: true }
    },
    "mcp.add": (m) => {
      if (typeof m.name !== "string" || !m.name) return { valid: false, error: "mcp.add requires name" }
      if (!m.server || typeof m.server !== "object") return { valid: false, error: "mcp.add requires server config object" }
      return { valid: true }
    },
    "mcp.update": (m) => {
      if (typeof m.name !== "string" || !m.name) return { valid: false, error: "mcp.update requires name" }
      if (!m.patch || typeof m.patch !== "object") return { valid: false, error: "mcp.update requires patch object" }
      return { valid: true }
    },
    "mcp.delete": (m) => {
      if (typeof m.name !== "string" || !m.name) return { valid: false, error: "mcp.delete requires name" }
      return { valid: true }
    },
    "mcp.toggle_server": (m) => {
      if (typeof m.name !== "string" || !m.name) return { valid: false, error: "mcp.toggle_server requires name" }
      if (typeof m.enabled !== "boolean") return { valid: false, error: "mcp.toggle_server requires boolean enabled" }
      return { valid: true }
    },
    "mcp.set_selection": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "mcp.set_selection requires thread_id" }
      return { valid: true }
    },
    // Mission Pack / enterprise modules
    "pack.list": () => ({ valid: true }),
    "pack.install": (m) => {
      if (!m.dir && !m.zip_path) return { valid: false, error: "pack.install requires dir or zip_path" }
      return { valid: true }
    },
    "pack.apply": (m) => {
      if (typeof m.pack_id !== "string" || !m.pack_id) return { valid: false, error: "pack.apply requires pack_id" }
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "pack.apply requires thread_id" }
      if (m.user_gesture !== true) {
        return { valid: false, error: "pack.apply requires user_gesture:true (Side Panel only)" }
      }
      // force_takeover is optional boolean (UI one-click Trust unlock); only with user_gesture above.
      if (m.force_takeover !== undefined && m.force_takeover !== true && m.force_takeover !== false) {
        return { valid: false, error: "pack.apply force_takeover must be boolean when set" }
      }
      return { valid: true }
    },
    "pack.unapply": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "pack.unapply requires thread_id" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "pack.unapply requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    "pack.uninstall": (m) => {
      if (typeof m.pack_id !== "string" || !m.pack_id) return { valid: false, error: "pack.uninstall requires pack_id" }
      return { valid: true }
    },
    "pack.get": (m) => {
      if (typeof m.pack_id !== "string" || !m.pack_id) return { valid: false, error: "pack.get requires pack_id" }
      return { valid: true }
    },
    "pack.save_user": (m) => {
      if (typeof m.name !== "string" || !m.name.trim()) {
        return { valid: false, error: "pack.save_user requires name" }
      }
      if (typeof m.system_prompt_append !== "string" || !m.system_prompt_append.trim()) {
        return { valid: false, error: "pack.save_user requires system_prompt_append" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "pack.save_user requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    "pack.delete_user": (m) => {
      if (typeof m.pack_id !== "string" || !m.pack_id) {
        return { valid: false, error: "pack.delete_user requires pack_id" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "pack.delete_user requires user_gesture:true" }
      }
      return { valid: true }
    },
    "pack.suggest_config": (m) => {
      if (m.user_gesture !== true) {
        return { valid: false, error: "pack.suggest_config requires user_gesture:true" }
      }
      const hasBrief = typeof m.brief === "string" && m.brief.trim().length > 0
      const hasName = typeof m.name === "string" && m.name.trim().length > 0
      const hasPrompt =
        typeof m.system_prompt_append === "string" && m.system_prompt_append.trim().length > 0
      if (!hasBrief && !hasName && !hasPrompt) {
        return {
          valid: false,
          error: "pack.suggest_config requires brief, name, or system_prompt_append",
        }
      }
      return { valid: true }
    },
    "modules.list": () => ({ valid: true }),
    "modules.set_enabled": (m) => {
      if (typeof m.module !== "string" || !m.module) return { valid: false, error: "modules.set_enabled requires module" }
      if (typeof m.enabled !== "boolean") return { valid: false, error: "modules.set_enabled requires enabled boolean" }
      return { valid: true }
    },
    "modules.update": (m) => {
      if (typeof m.module !== "string" || !m.module) return { valid: false, error: "modules.update requires module" }
      if (!m.patch || typeof m.patch !== "object") return { valid: false, error: "modules.update requires patch object" }
      return { valid: true }
    },
    "modules.set_profile": (m) => {
      if (m.profile !== "community" && m.profile !== "enterprise") {
        return { valid: false, error: "modules.set_profile requires profile community|enterprise" }
      }
      return { valid: true }
    },
    "outbound_mcp.grants.list": () => ({ valid: true }),
    "outbound_mcp.grants.issue": (m) => {
      if (typeof m.caller_id !== "string" || !m.caller_id.trim()) {
        return { valid: false, error: "outbound_mcp.grants.issue requires caller_id" }
      }
      if (m.allow_page_export !== undefined && typeof m.allow_page_export !== "boolean") {
        return { valid: false, error: "outbound_mcp.grants.issue allow_page_export must be a boolean" }
      }
      return { valid: true }
    },
    "outbound_mcp.grants.revoke": (m) => {
      if (typeof m.grant_id !== "string" || !m.grant_id.trim()) {
        return { valid: false, error: "outbound_mcp.grants.revoke requires grant_id" }
      }
      return { valid: true }
    },
    "outbound_mcp.grants.revoke_all": () => ({ valid: true }),
    "outbound_mcp.set_require_grant": (m) => {
      if (typeof m.require_grant !== "boolean") {
        return { valid: false, error: "outbound_mcp.set_require_grant requires require_grant boolean" }
      }
      return { valid: true }
    },
    // ADR-015 multi-agent fleet / Confirm Center
    "fleet.status": () => ({ valid: true }),
    "fleet.stop_all": () => ({ valid: true }),
    "worker.pause": (m) => {
      if (typeof m.worker_id !== "string" || !m.worker_id) return { valid: false, error: "worker.pause requires worker_id" }
      return { valid: true }
    },
    "worker.resume": (m) => {
      if (typeof m.worker_id !== "string" || !m.worker_id) return { valid: false, error: "worker.resume requires worker_id" }
      return { valid: true }
    },
    "tab.force_release": (m) => {
      if (typeof m.tab_id !== "number") return { valid: false, error: "tab.force_release requires tab_id number" }
      return { valid: true }
    },
    "board.get": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "board.get requires thread_id" }
      return { valid: true }
    },
    "board.add_hint": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "board.add_hint requires thread_id" }
      if (typeof m.text !== "string" || !m.text.trim()) return { valid: false, error: "board.add_hint requires text" }
      return { valid: true }
    },
    "workspace.pick": () => ({ valid: true }),
    "workspace.clear": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "workspace.clear requires thread_id" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "workspace.clear requires user_gesture:true" }
      }
      return { valid: true }
    },
    "workspace.set": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "workspace.set requires thread_id" }
      if (typeof m.path !== "string" || !m.path) return { valid: false, error: "workspace.set requires path" }
      return { valid: true }
    },
    "netsec.authorize_task": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) return { valid: false, error: "netsec.authorize_task requires thread_id" }
      if (m.authorized !== true) return { valid: false, error: "netsec.authorize_task requires authorized:true" }
      if (m.user_gesture !== true) return { valid: false, error: "netsec.authorize_task requires user_gesture:true" }
      if (!Array.isArray(m.targets) || m.targets.length === 0) return { valid: false, error: "netsec.authorize_task requires targets[]" }
      return { valid: true }
    },
    "apps.list": () => ({ valid: true }),
    "apps.enumerate": () => ({ valid: true }),
    "apps.add": (m) => {
      const hasPath = typeof m.path === "string" && m.path.length > 0
      const hasAumid = typeof m.aumid === "string" && m.aumid.length > 0
      const hasBundleId = typeof m.bundleId === "string" && m.bundleId.length > 0
      // At least one identifier: path (Windows), aumid (UWP), or bundleId (macOS)
      if (!hasPath && !hasAumid && !hasBundleId) {
        return { valid: false, error: "apps.add requires at least one of path / aumid / bundleId" }
      }
      if (m.policy !== undefined && !["auto", "ai", "manual"].includes(m.policy)) {
        return { valid: false, error: "apps.add policy must be auto, ai, or manual" }
      }
      if (m.display_name !== undefined && typeof m.display_name !== "string") {
        return { valid: false, error: "apps.add display_name must be a string" }
      }
      return { valid: true }
    },
    "apps.remove": (m) => {
      if (typeof m.token !== "string" || !m.token) return { valid: false, error: "apps.remove requires token" }
      return { valid: true }
    },
    "apps.set_policy": (m) => {
      if (typeof m.token !== "string" || !m.token) return { valid: false, error: "apps.set_policy requires token" }
      if (!["auto", "ai", "manual"].includes(m.policy)) return { valid: false, error: "apps.set_policy policy must be auto, ai, or manual" }
      return { valid: true }
    },
    "apps.set_enabled": (m) => {
      if (typeof m.token !== "string" || !m.token) return { valid: false, error: "apps.set_enabled requires token" }
      if (typeof m.enabled !== "boolean") return { valid: false, error: "apps.set_enabled requires boolean enabled" }
      return { valid: true }
    },
    "apps.set_coordinate_allowed": (m) => {
      if (typeof m.token !== "string" || !m.token) {
        return { valid: false, error: "apps.set_coordinate_allowed requires token" }
      }
      if (typeof m.allowed !== "boolean") {
        return { valid: false, error: "apps.set_coordinate_allowed requires boolean allowed" }
      }
      return { valid: true }
    },
    // --- Core lists / config (must be registered under production WS fail-closed) ---
    // P2 ARCH-PROTO-2 enabled strict unknown-type rejection but several high-traffic
    // router cases were never added here → SEA/production treated config.get/thread.list
    // as unknown (looks like Companion "crash"/dead connection). Keep in lock-step with
    // message-router.ts case arms.
    "config.get": () => ({ valid: true }),
    "config.test": () => ({ valid: true }),
    "config.testVision": () => ({ valid: true }),
    "llm.oneshot": (m: any) => {
      if (m.id != null && typeof m.id !== "string") {
        return { valid: false, error: "llm.oneshot id must be string when set" }
      }
      if (typeof m.user_content !== "string" || !m.user_content.trim()) {
        return { valid: false, error: "llm.oneshot requires user_content string" }
      }
      if (m.system_prompt != null && typeof m.system_prompt !== "string") {
        return { valid: false, error: "llm.oneshot system_prompt must be string when set" }
      }
      return { valid: true }
    },
    "settings.get": () => ({ valid: true }),
    "settings.set": (m) => {
      if (m.settings !== undefined && (typeof m.settings !== "object" || m.settings === null || Array.isArray(m.settings))) {
        return { valid: false, error: "settings.set settings must be an object" }
      }
      return { valid: true }
    },
    "settings.test": () => ({ valid: true }),
    "thread.list": () => ({ valid: true }),
    "thread.generate_title": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "thread.generate_title requires thread_id" }
      }
      return { valid: true }
    },
    "thread.export_obsidian": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "thread.export_obsidian requires thread_id" }
      }
      return { valid: true }
    },
    "skill.list": () => ({ valid: true }),
    "skill.refresh": () => ({ valid: true }),
    "skill.import-folder": () => ({ valid: true }),
    "skill.import-path": (m) => {
      if (typeof m.dir_path !== "string" || !m.dir_path) {
        return { valid: false, error: "skill.import-path requires dir_path string" }
      }
      return { valid: true }
    },
    "skill.import-files": (m) => {
      if (!Array.isArray(m.files) || m.files.length === 0) {
        return { valid: false, error: "skill.import-files requires non-empty files array" }
      }
      return { valid: true }
    },
    "knowledge.list": () => ({ valid: true }),
    // #296: llm_labels / regen_labels 是可选布尔（面板开关随请求传入）
    "knowledge.graph": (m) => {
      if (m.llm_labels !== undefined && typeof m.llm_labels !== "boolean") {
        return { valid: false, error: "knowledge.graph llm_labels must be boolean when set" }
      }
      if (m.regen_labels !== undefined && typeof m.regen_labels !== "boolean") {
        return { valid: false, error: "knowledge.graph regen_labels must be boolean when set" }
      }
      return { valid: true }
    },
    "knowledge.set_active": (m) => {
      if (typeof m.thread_id !== "string" || !m.thread_id) {
        return { valid: false, error: "knowledge.set_active requires thread_id" }
      }
      if (!Array.isArray(m.ids)) return { valid: false, error: "knowledge.set_active requires ids array" }
      return { valid: true }
    },
    "knowledge.preview": (m) => {
      if (!m.url && !m.content && !m.file) {
        return { valid: false, error: "knowledge.preview requires url, content, or file" }
      }
      return { valid: true }
    },
    "knowledge.import": (m) => {
      if (!m.url && !m.content && !m.file && !m.path) {
        return { valid: false, error: "knowledge.import requires url, content, or file" }
      }
      // #293: force (仍导入) is optional boolean — mirrors pack.apply force_takeover.
      if (m.force !== undefined && m.force !== true && m.force !== false) {
        return { valid: false, error: "knowledge.import force must be boolean when set" }
      }
      return { valid: true }
    },
    "knowledge.get": (m) => {
      if (typeof m.id !== "string" || !m.id) {
        return { valid: false, error: "knowledge.get requires id" }
      }
      return { valid: true }
    },
    "knowledge.update": (m) => {
      if (typeof m.id !== "string" || !m.id) {
        return { valid: false, error: "knowledge.update requires id" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "knowledge.update requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    "knowledge.export": (m) => {
      if (typeof m.id !== "string" || !m.id) {
        return { valid: false, error: "knowledge.export requires id" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "knowledge.export requires user_gesture:true (Side Panel only)" }
      }
      if (m.ids !== undefined) {
        return { valid: false, error: "knowledge.export v1 rejects id[]" }
      }
      return { valid: true }
    },
    "knowledge.import_directory": (m) => {
      if (m.user_gesture !== true) {
        return { valid: false, error: "knowledge.import_directory requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    "knowledge.import_local_file": (m) => {
      if (m.user_gesture !== true) {
        return { valid: false, error: "knowledge.import_local_file requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    "knowledge.preview_cancel": (m) => {
      if (typeof m.id !== "string" || !m.id) {
        return { valid: false, error: "knowledge.preview_cancel requires id" }
      }
      return { valid: true }
    },
    "knowledge.suggest": (m) => {
      if (typeof m.id !== "string" || !m.id) {
        return { valid: false, error: "knowledge.suggest requires id" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "knowledge.suggest requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    "knowledge.delete": (m) => {
      if (typeof m.id !== "string" || !m.id) {
        return { valid: false, error: "knowledge.delete requires id" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "knowledge.delete requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    // --- #274: knowledge folders — all six verbs are user_gesture-only ---
    "knowledge.folder_create": (m) => {
      if (m.bucket !== "global" && m.bucket !== "sites") {
        return { valid: false, error: 'knowledge.folder_create requires bucket: "global" | "sites"' }
      }
      if (typeof m.path !== "string" || !m.path.trim()) {
        return { valid: false, error: "knowledge.folder_create requires path" }
      }
      if (m.description !== undefined && typeof m.description !== "string") {
        return { valid: false, error: "knowledge.folder_create description must be a string" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "knowledge.folder_create requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    "knowledge.folder_rename": (m) => {
      if (m.bucket !== "global" && m.bucket !== "sites") {
        return { valid: false, error: 'knowledge.folder_rename requires bucket: "global" | "sites"' }
      }
      if (typeof m.path !== "string" || !m.path.trim()) {
        return { valid: false, error: "knowledge.folder_rename requires path" }
      }
      if (typeof m.new_path !== "string" || !m.new_path.trim()) {
        return { valid: false, error: "knowledge.folder_rename requires new_path" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "knowledge.folder_rename requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    "knowledge.folder_update": (m) => {
      if (m.bucket !== "global" && m.bucket !== "sites") {
        return { valid: false, error: 'knowledge.folder_update requires bucket: "global" | "sites"' }
      }
      if (typeof m.path !== "string" || !m.path.trim()) {
        return { valid: false, error: "knowledge.folder_update requires path" }
      }
      if (typeof m.description !== "string") {
        return { valid: false, error: "knowledge.folder_update requires description string" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "knowledge.folder_update requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    "knowledge.folder_suggest": (m) => {
      if (m.bucket !== "global" && m.bucket !== "sites") {
        return { valid: false, error: 'knowledge.folder_suggest requires bucket: "global" | "sites"' }
      }
      if (typeof m.path !== "string" || !m.path.trim()) {
        return { valid: false, error: "knowledge.folder_suggest requires path" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "knowledge.folder_suggest requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    "knowledge.folder_delete": (m) => {
      if (m.bucket !== "global" && m.bucket !== "sites") {
        return { valid: false, error: 'knowledge.folder_delete requires bucket: "global" | "sites"' }
      }
      if (typeof m.path !== "string" || !m.path.trim()) {
        return { valid: false, error: "knowledge.folder_delete requires path" }
      }
      if (m.mode !== undefined && m.mode !== "reject_if_docs" && m.mode !== "move_to_parent") {
        return { valid: false, error: 'knowledge.folder_delete mode must be "reject_if_docs" | "move_to_parent"' }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "knowledge.folder_delete requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    "knowledge.move": (m) => {
      if (typeof m.id !== "string" || !m.id) {
        return { valid: false, error: "knowledge.move requires id" }
      }
      if (typeof m.folder !== "string") {
        return { valid: false, error: "knowledge.move requires folder (\"\" = 桶根)" }
      }
      if (m.user_gesture !== true) {
        return { valid: false, error: "knowledge.move requires user_gesture:true (Side Panel only)" }
      }
      return { valid: true }
    },
    "user_env.list": () => ({ valid: true }),
    "user_env.set": (m) => {
      if (!m.entries || typeof m.entries !== "object" || Array.isArray(m.entries)) {
        return { valid: false, error: "user_env.set requires entries object" }
      }
      return { valid: true }
    },
    "user_env.delete": (m) => {
      if (!Array.isArray(m.keys) || m.keys.length === 0) {
        return { valid: false, error: "user_env.delete requires non-empty keys array" }
      }
      return { valid: true }
    },
    "security.unattended.status": () => ({ valid: true }),
    "security.unattended.arm": (m) => {
      if (m.confirmation_phrase === undefined) {
        return { valid: false, error: "security.unattended.arm requires confirmation_phrase" }
      }
      return { valid: true }
    },
    "security.unattended.disarm": () => ({ valid: true }),
    "computer.get_state": () => ({ valid: true }),
    "computer.set_enabled": (m) => {
      if (typeof m.enabled !== "boolean") {
        return { valid: false, error: "computer.set_enabled requires boolean enabled" }
      }
      return { valid: true }
    },
    "enterprise.session_trust.status": () => ({ valid: true }),
    "enterprise.session_trust.revoke": () => ({ valid: true }),
    "obsidian.pick_vault_folder": () => ({ valid: true }),
    "obsidian.refresh_profile": () => ({ valid: true }),
    // Host tool reply path (extension → companion); body validated in tool pipeline.
    "osascript_eval": () => ({ valid: true }),
    "tab.navigated": (m) => {
      if (typeof m.tabId !== "number") return { valid: false, error: "tab.navigated requires tabId number" }
      if (typeof m.url !== "string" || !m.url) return { valid: false, error: "tab.navigated requires url string" }
      return { valid: true }
    },
  }

  const validator = validators[msg.type]
  if (validator) {
    return validator(msg)
  }

  // P2 ARCH-PROTO-2: fail-closed for unknown types by default.
  // Opt out only with CMSPARK_WS_STRICT=0 (local experiments). NODE_ENV=test keeps
  // allow-through unless STRICT=1 so unit suites can probe experimental types.
  const strictWs =
    process.env.CMSPARK_WS_STRICT === "1" ||
    (process.env.CMSPARK_WS_STRICT !== "0" &&
      process.env.NODE_ENV !== "test" &&
      process.env.NODE_ENV !== "development")
  if (strictWs) {
    return {
      valid: false,
      error: `Unknown message type: ${msg.type}`,
    }
  }
  // Unknown types allowed only when explicitly non-strict (dev/test/STRICT=0)
  return { valid: true }
}
