import { ChatRole, ChatEntryType } from '../domain/enums.js';

export class ConversationHistoryBuilder {
  formatSetupHistory(entries) {
    if (!entries || entries.length === 0) return '';
    const lines = entries.map((entry) => {
      const label = entry.role === ChatRole.PLAYER ? 'Player' : 'KP';
      return `${label}：${entry.content}`;
    });
    return `以下为我们的对话历史：\n${lines.join('\n')}`;
  }

  formatChatRecord(chatRecord) {
    if (!chatRecord || chatRecord.length === 0) return '';
    let seenNarration = false;
    const lines = [];

    for (const entry of chatRecord) {
      if (entry.type === ChatEntryType.SUMMARY) {
        lines.push(`[历史总结] ${entry.content}`);
      } else if (entry.role === ChatRole.PLAYER) {
        lines.push(`Player：${entry.content}`);
      } else if (entry.type === ChatEntryType.NARRATION) {
        if (!seenNarration) {
          lines.push(`[故事开幕叙述] ${entry.content}`);
          seenNarration = true;
        } else {
          lines.push(`[KP叙述] ${entry.content}`);
        }
      } else if (entry.role === ChatRole.SYSTEM) {
        // 跳过系统消息（如投掷结果），不写入历史记录
        continue;
      } else if (entry.type === ChatEntryType.RAW) {
        // 防御：raw 类型不应出现在 chatRecord 中，跳过
        continue;
      } else {
        lines.push(`KP：${entry.content}`);
      }
    }

    return `历史记录如下：\n${lines.join('\n\n')}`;
  }

  estimateCharCount(chatRecord, excludeLatest = true) {
    const records = excludeLatest ? chatRecord.slice(0, -1) : chatRecord;
    return records.reduce((sum, entry) => sum + (entry.content?.length ?? 0), 0);
  }
}

export const conversationHistoryBuilder = new ConversationHistoryBuilder();
