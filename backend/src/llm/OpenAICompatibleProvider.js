import { LLMProvider } from './LLMProvider.js';

/**
 * OpenAI-compatible LLM provider.
 *
 * 基于官方文档 https://api-docs.deepseek.com/zh-cn/guides/tool_calls 与
 * https://api-docs.deepseek.com/zh-cn/guides/thinking_mode：
 *
 * - DeepSeek strict 模式使用 /beta；SoCLaaS 使用配置中的 /v1 根路径
 * - 非流式一次性返回（stream:false）
 * - 通过 tools 传入 strict function 定义；**思考模式下不能传 tool_choice**
 *   （官方样例仅传 tools，让模型自主调用；strict 模式 + 措辞强约束保证必调用）
 * - thinking.type 合法值为 'enabled' / 'disabled'（'adaptive' 已废弃）；Flash 未显式配置时默认关闭
 * - reasoning_effort: 'high' / 'max'（思考强度控制，按 FlowType 分层）
 * - 输出从 message.tool_calls[0].function.arguments 解析；若无 tool_calls 则退回 content
 * - reasoning_content 在工具调用场景下必须回传（官方要求），由调用方持久化到 chatRecord
 * - usage 字段含 prompt_cache_hit_tokens / miss_tokens（KV Cache 监控）
 */
export class OpenAICompatibleProvider extends LLMProvider {
  constructor({
    apiKey,
    baseUrl,
    model,
    provider = 'deepseek',
    reasoningEffort,
    timeoutMs,
    maxRetries,
  } = {}) {
    super();
    this.apiKey = apiKey || '';
    this.provider = String(provider || 'deepseek').trim().toLowerCase();
    this.isDeepSeek = this.provider === 'deepseek';

    // DeepSeek strict mode requires /beta. SoCLaaS already exposes the
    // OpenAI-compatible endpoint below /v1 and must not receive /beta.
    const defaultBase = this.isDeepSeek
      ? 'https://api.deepseek.com'
      : (this.provider === 'soclaas' ? 'https://soclaas-api.comp.nus.edu.sg/v1' : 'https://api.openai.com/v1');
    const rawBase = (baseUrl || defaultBase).replace(/\/+$/, '');
    this.baseUrl = this.isDeepSeek && !rawBase.endsWith('/beta')
      ? `${rawBase}/beta`
      : rawBase;
    this.model = model || (this.provider === 'soclaas' ? 'qwen3.8:27b' : 'deepseek-v4-pro');

    const parsedTimeout = Number(timeoutMs ?? process.env.LLM_TIMEOUT_MS ?? 60_000);
    this.timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 60_000;
    const parsedRetries = Number(maxRetries ?? process.env.LLM_MAX_RETRIES ?? 2);
    this.maxRetries = Number.isInteger(parsedRetries) && parsedRetries >= 0 ? parsedRetries : 2;

    // SoCLaaS documents reasoning_effort rather than DeepSeek's thinking
    // object. The default is deliberately "none" to match its quick-start
    // request and to avoid assuming that every hosted model exposes reasoning.
    this.reasoningEffort = this.provider === 'soclaas'
      ? (reasoningEffort || process.env.SOCLAAS_REASONING_EFFORT || 'none')
      : null;
    // 官方文档：thinking.type 合法值为 'enabled' / 'disabled'，'adaptive' 已废弃。
    // Flash 主要用于高频叙事/摘要；未明确配置时关闭思考链，避免每回合把大部分
    // 延迟消耗在 reasoning_content 上。需要严格推理时可在 .env 显式设为 enabled。
    const configuredThinking = this.isDeepSeek ? process.env.LLM_THINKING_TYPE : null;
    this.thinkingTypeExplicit = configuredThinking === 'enabled' || configuredThinking === 'disabled';
    this.thinkingType = this.thinkingTypeExplicit
      ? configuredThinking
      : (this.isDeepSeek && !String(this.model).toLowerCase().includes('flash') ? 'enabled' : 'disabled');
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
      throw new Error('LLM API Key 未配置，请在 backend/.env 中设置 LLM_API_KEY 或 SOCLAAS_API_KEY');
    }

    const { messages, temperature, maxTokens, thinking, stop, tools, toolChoice, reasoningEffort, modelOverride } = assembled;
    const url = `${this.baseUrl}/chat/completions`;

    // thinking 模式：默认按全局开关（this.thinkingType）启用
    // Flash 默认走非思考模式以减少延迟；显式 LLM_THINKING_TYPE=enabled 时仍可启用思考链。
    const effectiveModel = modelOverride || this.model;
    const effectiveThinkingType = this.thinkingTypeExplicit
      ? this.thinkingType
      : (String(effectiveModel).toLowerCase().includes('flash') ? 'disabled' : 'enabled');
    const thinkingEnabled = this.isDeepSeek && thinking !== false && effectiveThinkingType === 'enabled';

    const body = {
      model: effectiveModel,
      messages,
      max_tokens: maxTokens ?? 4096,
      stream: false,                            // ← 关闭流式
      // 移除 response_format —— strict 模式走 tools
      tools,                                    // ← strict function 定义
    };

    if (this.provider === 'soclaas') {
      // SoCLaaS's documented OpenAI-compatible request shape uses
      // reasoning_effort. Do not send DeepSeek's provider-specific thinking
      // object; tool_choice is safe here because the default is "none".
      body.reasoning_effort = this.reasoningEffort;
      if (toolChoice && tools?.length) {
        body.tool_choice = toolChoice;
      }
    } else if (thinkingEnabled) {
      // DeepSeek V4 defaults to thinking; in thinking mode tool_choice is not
      // supported, so only pass the tools list.
      body.thinking = { type: 'enabled' };
      // 思考强度控制（官方文档：思考模式下默认 high，复杂 Agent 任务自动 max）
      if (reasoningEffort && (reasoningEffort === 'high' || reasoningEffort === 'max')) {
        body.reasoning_effort = reasoningEffort;
      }
      // 思考模式下不支持 tool_choice（API 会返回 400），故不透传
      // 即使调用方误传 toolChoice，也在此显式忽略，避免 400 错误
    } else {
      // DeepSeek non-thinking mode:
      // Explicitly disable thinking before sending tool_choice; otherwise
      // DeepSeek V4 treats the request as thinking + tool_choice and rejects it.
      body.thinking = { type: 'disabled' };
      // tool_choice='required' 强制 LLM 调用 strict function，避免 strict 失效时 LLM 走 content
      if (toolChoice && tools?.length) {
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

    const response = await this._fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    // 方案 B+ 诊断日志：打印实际发送的 messages 结构（重点看 tool_calls 历史消息）
    // 用于实测验证 DeepSeek API 是否正常处理 tool_calls 历史消息
    if (process.env.LLM_DEBUG_MESSAGES === '1') {
      console.log('[LLM 诊断] 发送到 API 的 messages 结构:');
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const contentPreview = typeof m.content === 'string'
          ? m.content.slice(0, 100)
          : m.content;
        console.log(`  [${i}] role=${m.role}, content=${JSON.stringify(contentPreview)}`);
        if (m.tool_calls) {
          console.log(`       tool_calls: name=${m.tool_calls[0].function.name}, arguments前80=${m.tool_calls[0].function.arguments.slice(0, 80)}...`);
        }
        if (m.tool_call_id) {
          console.log(`       tool_call_id=${m.tool_call_id}`);
        }
        if (m.reasoning_content) {
          console.log(`       reasoning_content 长度=${m.reasoning_content.length}`);
        }
      }
      console.log(`[LLM 诊断] tools 函数名: ${tools?.[0]?.function?.name || '无'}`);
    }

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
        thinkingEnabled,
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
      thinkingEnabled,
      usage,
      toolCallId: toolCall.id || null,
      hasToolCall: true,
      // 诊断字段：finish_reason 用于排查 tool_calls 也可能被 max_tokens 截断的场景
      _diagnostic: {
        reason: 'tool_call_ok',
        reasoningLen: reasoningContent ? reasoningContent.length : 0,
        contentHead: (toolCall.function.arguments || '').slice(0, 500),
        finishReason: choice?.finish_reason || null,
      },
    };
  }

  /**
   * Retry transient rate-limit/upstream failures while keeping a bounded
   * timeout for every individual request.
   */
  async _fetchWithRetry(url, init) {
    const retryableStatuses = new Set([429, 500, 502, 503, 504]);
    let lastError = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const canTimeout = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function';
        const signal = canTimeout ? AbortSignal.timeout(this.timeoutMs) : undefined;
        const response = await fetch(url, signal ? { ...init, signal } : init);

        if (response.ok || !retryableStatuses.has(response.status) || attempt === this.maxRetries) {
          return response;
        }

        const retryAfterHeader = response.headers?.get?.('retry-after');
        const retryAfterSeconds = Number(retryAfterHeader);
        const retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
          ? Math.min(retryAfterSeconds * 1000, 10_000)
          : Math.min(500 * (2 ** attempt), 4_000);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      } catch (error) {
        lastError = error;
        if (attempt === this.maxRetries) {
          throw new Error(`LLM API request failed after ${attempt + 1} attempt(s): ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, Math.min(500 * (2 ** attempt), 4_000)));
      }
    }

    throw lastError || new Error('LLM API request failed');
  }
}
