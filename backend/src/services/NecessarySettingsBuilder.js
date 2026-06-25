export class NecessarySettingsBuilder {
  build(session) {
    const lines = [
      '故事必要设定如下：',
      `世界观：${session.worldSettings || '（未设定）'}`,
      `玩家：${session.player || '（未设定）'}`,
    ];

    if (session.keyCharacters && session.keyCharacters.length > 0) {
      const keyCharsList = session.keyCharacters
        .map((c) => {
          // 提取角色名（第一行"姓名：xxx"）
          const nameMatch = c.match(/姓名：(.+)/);
          const name = nameMatch ? nameMatch[1] : '未知';
          return `[${name}]\n${c}`;
        })
        .join('\n\n');
      lines.push('关键角色：');
      lines.push(keyCharsList);
    }

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
        `玩家物品栏：${session.inventory.map((i) => `${i.name}（${i.description || ''}）`).join('、')}`
      );
    }

    return lines.join('\n');
  }
}

export const necessarySettingsBuilder = new NecessarySettingsBuilder();
