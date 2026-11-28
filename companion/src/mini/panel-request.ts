import { getActivityService } from '../activity'
import { languageOf } from '../activity/image'
import { activityModelTarget, activityVisionConfig } from '../activity/model-config'
import { createRecorder } from '../activity/platform'
import { DEFAULT_ACTIVITY_CONFIG } from '../activity/types'
import { getConfig } from '../config'
import { analyzeImage } from '../llm/vision-pipeline'
import type { WorkspaceSession } from '../message-router/handlers/personal-workspace'
import type { SkillEngine } from '../skills/skill-engine'
import { knowledgeSearchRows, normalizeSearchQuery } from '../summoner/read-search'
import { isChromeExtensionWsOrigin } from '../ws/handshake-surface'
import { miniCaptures, miniPng } from './capture-handoff'
import { readMiniPassage, searchMiniPassages, type MiniHistory } from './passage-search'

const screenshotVision = { ...DEFAULT_ACTIVITY_CONFIG, extraction_mode: 'vision' as const }

export async function miniPanelRequest(request: Record<string, unknown>, session: WorkspaceSession | undefined, knowledge: Pick<SkillEngine, 'listKnowledge' | 'getKnowledge'>, history?: MiniHistory) {
  const reply = { type: 'mini.result', id: request.id }
  try {
    if (session?.surface !== 'panel' || !isChromeExtensionWsOrigin(session.origin) || !session.panelId || !session.isCurrentSession?.()) {
      throw new Error('请从已连接的 Chrome 快速操作窗口打开')
    }
    switch (request.op) {
      case 'claim': {
        const bytes = miniCaptures.claim(request.action, request.ticket, session.panelId)
        return { ...reply, ok: true, image_base64: bytes.toString('base64'), ...(request.action === 'ask' ? { target: activityModelTarget(screenshotVision) } : {}) }
      }
      case 'target':
        return { ...reply, ok: true, target: activityModelTarget(screenshotVision) }
      case 'ocr': {
        const bytes = miniPng(request.image_base64)
        const store = getActivityService().store
        const recorder = createRecorder(store.root)
        if (!recorder.ocrImage) throw new Error('本平台未提供截图 OCR')
        const text = await recorder.ocrImage(bytes, languageOf(store.config()), AbortSignal.timeout(40_000))
        return { ...reply, ok: true, text }
      }
      case 'ask': {
        const question = typeof request.question === 'string' ? request.question.trim() : ''
        if (!question || question.length > 4000) throw new Error('请输入 1 至 4000 字的问题')
        const app = getConfig()
        const target = activityModelTarget(screenshotVision, app)
        if (target.unavailable || target.id !== request.expected_target) {
          return { ...reply, ok: false, target, error: target.unavailable || '图像模型已变更，请核对新目标后再次发送' }
        }
        const bytes = miniPng(request.image_base64)
        const image = { base64: bytes.toString('base64'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), title: '用户框选的截图', url: '' }
        const config = activityVisionConfig(screenshotVision, app)
        const result = await analyzeImage(image, config, question, AbortSignal.timeout(config.timeout_ms || 120_000), { requireComplete: true,
          consent: { main: app.llm, current: () => session.isCurrentSession?.() === true && activityModelTarget(screenshotVision).id === target.id } })
        if (result.error || !result.description.trim()) throw new Error(result.error || '模型未返回回答')
        return { ...reply, ok: true, text: result.description, model: result.model_used }
      }
      case 'search': {
        const query = normalizeSearchQuery(request.query)
        if (!query) throw new Error('请输入搜索关键词')
        if (request.scope === 'passages') {
          if (!history) throw new Error('对话历史暂不可用')
          const offset = request.offset === undefined ? 0 : Number(request.offset)
          const page = await searchMiniPassages(knowledge, history, query, offset)
          if (!session.isCurrentSession()) throw new Error('连接已切换，请重新搜索')
          return { ...reply, ok: true, ...page }
        }
        return { ...reply, ok: true, hits: knowledgeSearchRows(knowledge.listKnowledge(), query, 25) }
      }
      case 'read': {
        if (request.scope === 'passages') {
          const query = normalizeSearchQuery(request.query)
          if (!history || !query) throw new Error('请重新搜索后打开结果')
          return { ...reply, ok: true, doc: readMiniPassage(knowledge, history, request, query) }
        }
        const doc = typeof request.doc_id === 'string' && knowledge.getKnowledge(request.doc_id)
        if (!doc) throw new Error('这份资料已不存在，请重新搜索')
        return { ...reply, ok: true, doc: { title: doc.title, body: doc.body, truncated: doc.truncated } }
      }
      default: throw new Error('未知快速操作')
    }
  } catch (error) {
    return { ...reply, ok: false, error: error instanceof Error ? error.message : '快速操作失败' }
  }
}
