export class LLMProvider {
  async generateStream(_assembledPrompt, _onChunk) {
    throw new Error('LLMProvider.generateStream must be implemented');
  }
}
