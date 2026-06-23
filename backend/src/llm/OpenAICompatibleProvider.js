import { LLMProvider } from './LLMProvider.js';

/** 各阶段 temperature 配置 */
const TEMPERATURE_MAP = {};
export { TEMPERATURE_MAP as LLM_TEMP_MAP };

/** 各阶段 max_tokens 配置 */
const MAX_TOKENS_MAP = {};
export { MAX_TOKENS_MAP as LLM_MAX_TOKENS_MAP };

export class OpenAICompatibleProvider extends LLMProvider {
  constructor({ apiKey, baseUrl, model }) {
    super();
    this.apiKey = apiKey || '';
    this.baseUrl = (baseUrl || 'https://api.deepseek.com').replace(/\/$/, '');
    this.model = model || 'deepseek-chat';
    this.thinkingType = process.env.LLM_THINKING_TYPE || 'adaptive';
  }

  /**
   * 流式生成。
   * @param {Object} assembled - InputAssembler.assemble() 的返回值
   * @param {Function} onChunk
   * @returns {Promise<string>} 完整输出文本
   */
  async generateStream(assembled, onChunk) {
    if (!this.apiKey) {
      throw new Error('LLM API Key 未配置，请在 backend/.env 中设置 LLM_API_KEY');
    }

    const { messages, temperature, maxTokens, thinking, stop } = assembled;
    const url = `${this.baseUrl}/chat/completions`;

    const body = {
      model: this.model,
      messages,
      temperature: temperature ?? 0.7,
      max_tokens: maxTokens ?? 4096,
      stream: true,
      response_format: { type: 'json_object' },
    };

    // thinking 模式：叙事阶段启用
    if (thinking) {
      body.thinking = { type: this.thinkingType };
    }

    // stop 序列：防止 JSON 闭合后继续生成废话
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

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            if (onChunk) onChunk(delta);
          }
        } catch {
          // skip malformed SSE chunks
        }
      }
    }

    return fullText;
  }

  async generate(assembled) {
    return this.generateStream(assembled, null);
  }
}
