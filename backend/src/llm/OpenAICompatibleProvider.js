import { LLMProvider } from './LLMProvider.js';

/**
 * OpenAI-compatible LLM provider（DeepSeek strict 模式 + 思考模式）。
 *
 * 基于官方文档 https://api-docs.deepseek.com/zh-cn/guides/tool_calls 与
 * https://api-docs.deepseek.com/zh-cn/guides/thinking_mode：
 *
 * - base_url 使用 /beta（strict 模式要求）
 * - 非流式一次性返回（stream:false）
 * - 通过 tools 传入 strict function 定义；**思考模式下不能传 tool_choice**
 *   （官方样例仅传 tools，让模型自主调用；strict 模式 + 措辞强约束保证必调用）
 * - thinking.type 合法值为 'enabled' / 'disabled'（'adaptive' 已废弃）
 * - reasoning_effort: 'high' / 'max'（思考强度控制，按 FlowType 分层）
 * - 输出从 message.tool_calls[0].function.arguments 解析；若无 tool_calls 则退回 content
 * - reasoning_content 在工具调用场景下必须回传（官方要求），由调用方持久化到 chatRecord
 * - usage 字段含 prompt_cache_hit_tokens / miss_tokens（KV Cache 监控）
 */
export class OpenAICompatibleProvider extends LLMProvider {
  constructor({ apiKey, baseUrl, model }) {
    super();
    this.apiKey = apiKey || '';
    // strict 模式要求 base_url 以 /beta 结尾
    // 允许 .env 中配置 https://api.deepseek.com 或 https://api.deepseek.com/beta
    const rawBase = (baseUrl || 'https://api.deepseek.com').replace(/\/$/, '');
    this.baseUrl = rawBase.endsWith('/beta') ? rawBase : `${rawBase}/beta`;
    this.model = model || 'deepseek-v4-pro';
    // 官方文档：thinking.type 合法值为 'enabled' / 'disabled'，'adaptive' 已废弃
    this.thinkingType = process.env.LLM_THINKING_TYPE === 'disabled' ? 'disabled' : 'enabled';
  }

  /**
   * 非流式生成（strict 模式 + 思考模式）。
   * @param {Object} assembled - InputAssembler.assemble() 的返回值
   *   新增字段：
   *   - reasoningEffort?: 'high' | 'max' —— 思考强度（思考模式下生效）
   *   - modelOverride?: string —— 单次调用覆盖默认模型（分层路由用）
   * @returns {Promise<LLMResult>} LLM 输出结果对象
   */
  async generate(assembled) {
    if (!this.apiKey) {
      throw new Error('LLM API Key 未配置，请在 backend/.env 中设置 LLM_API_KEY');
    }

    const { messages, temperature, maxTokens, thinking, stop, tools, toolChoice, reasoningEffort, modelOverride } = assembled;
    const url = `${this.baseUrl}/chat/completions`;

    // thinking 模式：默认按全局开关（this.thinkingType）启用
    // 当前项目重试策略已统一为"思考模式 high"，不再降级到非思考模式 + tool_choice
    // 但仍保留 thinking=false 走非思考模式的能力（防御性冷备份，目前调用方不会用到）
    const thinkingEnabled = thinking !== false && this.thinkingType === 'enabled';

    const body = {
      model: modelOverride || this.model,
      messages,
      max_tokens: maxTokens ?? 4096,
      stream: false,                            // ← 关闭流式
      // 移除 response_format —— strict 模式走 tools
      tools,                                    // ← strict function 定义
    };

    if (thinkingEnabled) {
      body.thinking = { type: 'enabled' };
      // 思考强度控制（官方文档：思考模式下默认 high，复杂 Agent 任务自动 max）
      if (reasoningEffort && (reasoningEffort === 'high' || reasoningEffort === 'max')) {
        body.reasoning_effort = reasoningEffort;
      }
      // 思考模式下不支持 tool_choice（API 会返回 400），故不透传
      // 即使调用方误传 toolChoice，也在此显式忽略，避免 400 错误
    } else {
      // 非思考模式（冷备份路径，目前调用方不会走到）：
      // tool_choice='required' 强制 LLM 调用 strict function，避免 strict 失效时 LLM 走 content
      if (toolChoice) {
        body.tool_choice = toolChoice;
      }
    }

    // 思考模式不支持 temperature/top_p 等（不报错但不生效），非思考模式下可设置
    if (temperature !== undefined && temperature !== null && !thinkingEnabled) {
      body.temperature = temperature;
    }

    // stop 序列在 strict 模式下通常不需要（tool_calls 自然结束）
    if (stop && Array.isArray(stop) && stop.length > 0) {
      body.stop = stop;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error: ${response.status} ${errorText}`);
    }

    const json = await response.json();
    const choice = json.choices?.[0];
    const msg = choice?.message;
    if (!msg) {
      throw new Error(`LLM API 返回异常：缺少 choices[0].message，完整响应: ${JSON.stringify(json).slice(0, 500)}`);
    }

    // KV Cache 监控：usage 字段含 prompt_cache_hit_tokens / prompt_cache_miss_tokens
    const usage = json.usage || null;

    // 思考模式：思维链通过 reasoning_content 返回（官方要求工具调用场景下后续轮次必须回传）
    const reasoningContent = msg.reasoning_content || null;

    // strict 模式下输出在 tool_calls[0].function.arguments（JSON 字符串）
    const toolCall = msg.tool_calls?.[0];
    if (!toolCall || !toolCall.function || !toolCall.function.arguments) {
      // 兜底：若 LLM 未按预期调用 function，退回 content 字段（可能为空或文本）
      const fallback = msg.content || '';
      if (!fallback) {
        // 思考截断诊断：finish_reason='length' 表示 max_tokens 不足
        // 思考模式下 reasoning_content 也消耗 max_tokens，若思考过长会被截断，
        // 导致 LLM 无法进入输出阶段（content + tool_calls 都为空）
        const finishReason = choice?.finish_reason;
        if (finishReason === 'length') {
          const reasoningLen = reasoningContent ? reasoningContent.length : 0;
          throw new Error(
            `LLM 思考被 max_tokens 截断（finish_reason=length）。\n` +
            `可能原因：思考模式 + reasoning_effort 过高，reasoning_content 消耗了全部 token 配额。\n` +
            `诊断信息：reasoning_content 长度=${reasoningLen}，usage=${JSON.stringify(usage)}\n` +
            `解决建议：增大 FLOW_MAX_TOKENS 或降低 FLOW_REASONING_EFFORT。`
          );
        }
        throw new Error(
          `LLM 未返回 tool_calls 也没有 content（finish_reason=${finishReason || 'unknown'}）。\n` +
          `完整 message: ${JSON.stringify(msg).slice(0, 500)}`
        );
      }
      // 诊断信息：LLM 走了 content 而非 tool_calls（strict 模式失效）
      // 通过 reasoning_content 长度和 content 前 500 字符帮助排查
      const reasoningLen = reasoningContent ? reasoningContent.length : 0;
      const contentHead = fallback.slice(0, 500);
      // 通过 console.warn 输出诊断，GameOrchestrator 的 debug 日志会另记 hasToolCall=false
      console.warn(`[LLM 诊断] strict 失效，走 content 兜底 | reasoning_content 长度=${reasoningLen} | content 前 500 字符:\n${contentHead}`);
      return {
        content: fallback,
        reasoningContent,
        usage,
        toolCallId: null,
        hasToolCall: false,
        // 诊断字段（仅供 GameOrchestrator 记录到 debug 日志，不参与业务逻辑）
        _diagnostic: {
          reason: 'strict_fallback',
          reasoningLen,
          contentHead,
          finishReason: choice?.finish_reason || null,
        },
      };
    }

    return {
      content: toolCall.function.arguments,
      reasoningContent,
      usage,
      toolCallId: toolCall.id || null,
      hasToolCall: true,
    };
  }
}
