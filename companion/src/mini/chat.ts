import { getConfig, type LlmConfig } from "../config"
import { createProvider } from "../llm/provider"
import { modelRecipient } from "../llm/recipient"

type Turn = { role: "user" | "assistant"; content: string }

/** A Mini conversation belongs to its visible host and the selected main model. */
export class MiniChat {
  private turns: Turn[] = []
  private recipient = ""

  constructor(private readonly model: () => LlmConfig = () => getConfig().llm) {}

  async reply(input: string, signal: AbortSignal): Promise<string> {
    const text = input.trim()
    if (!text || text.length > 4000) throw new Error("请输入 1 至 4000 字的消息。")
    const config = this.model()
    const recipient = modelRecipient("mini", config)
    if (!config.model_name || !config.base_url) throw new Error("请先在 CMspark 设置中配置主模型。")
    if (this.recipient !== recipient) {
      this.recipient = recipient
      this.turns = []
    }
    const user: Turn = { role: "user", content: text }
    const result = await createProvider(config).complete({
      model: config.model_name,
      messages: [...this.turns, user],
      rejectRedirects: true,
      signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
    })
    signal.throwIfAborted()
    const answer = result.content.trim().slice(0, 24_000)
    if (!answer) throw new Error("主模型返回了空回复，请重试。")
    this.turns.push(user, { role: "assistant", content: answer })
    let size = this.turns.reduce((length, turn) => length + turn.content.length, 0)
    while (this.turns.length > 12 || (size > 24_000 && this.turns.length > 2)) {
      const oldest = this.turns.splice(0, 2)
      size -= oldest[0].content.length + oldest[1].content.length
    }
    return answer
  }
}
