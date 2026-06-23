export class ParsedLLMOutput {
  constructor(data = {}) {
    this.raw = data.raw ?? '';
    this.worldDescription = data.worldDescription ?? null;
    this.characterCard = data.characterCard ?? null;
    this.narration = data.narration ?? null;
    this.locations = data.locations ?? [];
    this.npcs = data.npcs ?? [];
    this.items = data.items ?? [];
    this.option = data.option ?? null;
    this.dice = data.dice ?? null;
    this.hp = data.hp ?? null;
    this.san = data.san ?? null;
    this.summary = data.summary ?? null;
  }

  hasDice() {
    return Boolean(this.dice && this.dice.trim());
  }

  hasSummary() {
    return Boolean(this.summary && this.summary.trim());
  }
}
