export class LLMProvider {
  /**
   * 非流式生成（strict 模式下一次性返回）。
   * @param {Object} assembledPrompt - InputAssembler.assemble() 的返回值
   * @returns {Promise<LLMResult>} LLM 输出结果对象
   *
   * LLMResult 字段：
   * - content: string —— LLM 输出主体（strict 模式下来自 tool_calls[0].function.arguments，否则来自 message.content）
   * - reasoningContent: string | null —— 思考模式的思维链（官方要求工具调用场景下后续轮次必须回传）
   * - usage: { prompt_tokens, completion_tokens, prompt_cache_hit_tokens, prompt_cache_miss_tokens } | null
   * - toolCallId: string | null —— tool_calls[0].id（用于多轮工具调用的 tool_call_id 关联）
   * - hasToolCall: boolean —— 是否走了 tool_calls 路径（用于诊断 strict 模式是否生效）
   */
  async generate(_assembledPrompt) {
    throw new Error('LLMProvider.generate must be implemented');
  }
}

/**
 * @typedef {Object} LLMResult
 * @property {string} content
 * @property {string|null} reasoningContent
 * @property {Object|null} usage
 * @property {string|null} toolCallId
 * @property {boolean} hasToolCall
 */
