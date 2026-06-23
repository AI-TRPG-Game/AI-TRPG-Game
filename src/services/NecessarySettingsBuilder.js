export class NecessarySettingsBuilder {
  build(session) {
    const lines = [
      '故事必要设定如下：',
      `世界观：${session.worldSettings || '（未设定）'}`,
      `主角：${session.protagonist || '（未设定）'}`,
    ];

    if (session.locations.length > 0) {
      lines.push(
        `已解锁地点：${session.locations.map((l) => l.name).join('、')}`
      );
    }

    if (session.npcs.length > 0) {
      lines.push(
        `已知NPC：${session.npcs.map((n) => `${n.name}（${n.description}）`).join('、')}`
      );
    }

    if (session.inventory.length > 0) {
      lines.push(
        `主角物品栏：${session.inventory.map((i) => i.name).join('、')}`
      );
    }

    return lines.join('\n');
  }
}

export const necessarySettingsBuilder = new NecessarySettingsBuilder();
