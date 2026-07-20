import { GameConfig } from '../config/GameConfig.js';
import { FlowType, SubState } from '../domain/enums.js';
import { conversationHistoryBuilder } from './ConversationHistoryBuilder.js';
import { inputAssembler } from './InputAssembler.js';
import { jsonOutputParser } from './JsonOutputParser.js';
import { entityUpdater } from './EntityUpdater.js';
import { SUMMARY } from '../domain/NarrativeSchema.js';

export class HistorySummarizer {
  constructor({ llmProvider, repository }) {
    this.llmProvider = llmProvider;
    this.repository = repository;
  }

  shouldSummarize(session) {
    if (session.chatRecord.length <= 2) return false;
    const charCount = conversationHistoryBuilder.estimateCharCount(
      session.chatRecord,
      true
    );
    return charCount > GameConfig.SUMMARY_THRESHOLD_CHARS;
  }

  async checkAndRun(session) {
    if (!this.shouldSummarize(session)) return false;

    session.subState = SubState.SUMMARIZING;
    this.repository.save(session);

    this._pushDisplay(session, 'system', GameConfig.GUIDANCE.SUMMARIZING);

    const assembled = inputAssembler.assemble(FlowType.HISTORY_SUMMARY, session);

    await this._callWithSummaryRetry(session, assembled);

    this._finishSummary(session);

    return true;
  }

  _pushDisplay(session, role, content) {
    if (!session.displayLog) session.displayLog = [];
    session.displayLog.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });
  }

  async _callWithSummaryRetry(session, assembled) {
    let result = await this.llmProvider.generate(assembled);
    let raw = result.content;

    const parsed = jsonOutputParser.parse(raw);
    if (parsed && jsonOutputParser.hasSummary(parsed)) {
      entityUpdater.applySummary(session, parsed[SUMMARY]);
      return raw;
    }

    // 第一次重试：追加 reminder 提示
    const reminder = `\n\n【请务必通过调用指定函数返回合法 JSON，且必须包含 "${SUMMARY}" 字段；不要直接输出文本、markdown 或代码块】`;
    const retryMessages = [...assembled.messages];
    const lastUserIdx = retryMessages.map(m => m.role).lastIndexOf('user');
    if (lastUserIdx >= 0) {
      retryMessages[lastUserIdx] = {
        ...retryMessages[lastUserIdx],
        content: retryMessages[lastUserIdx].content + reminder,
      };
    }
    const retryAssembled = { ...assembled, messages: retryMessages };

    result = await this.llmProvider.generate(retryAssembled);
    raw = result.content;
    const retryParsed = jsonOutputParser.parse(raw);
    if (retryParsed && jsonOutputParser.hasSummary(retryParsed)) {
      entityUpdater.applySummary(session, retryParsed[SUMMARY]);
      return raw;
    }

    // 第二次重试：继续用思考模式 high + 更强的 reminder（与 GameOrchestrator 简化策略一致）
    // 不再切换到非思考模式 + tool_choice='required'：strict: true 已强制调用 function，且思考模式与 tool_choice 冲突
    const strongerReminder = `\n\n【重要提醒】上一次响应未通过解析（缺少 "${SUMMARY}" 字段）。请务必通过调用指定函数返回合法 JSON，且必须包含 "${SUMMARY}" 字段；不要直接输出文本、markdown 或代码块。`;
    const retryMessages2 = [...assembled.messages];
    const lastUserIdx2 = retryMessages2.map(m => m.role).lastIndexOf('user');
    if (lastUserIdx2 >= 0) {
      retryMessages2[lastUserIdx2] = {
        ...retryMessages2[lastUserIdx2],
        content: retryMessages2[lastUserIdx2].content + strongerReminder,
      };
    }
    const retryAssembled2 = { ...assembled, messages: retryMessages2 };

    result = await this.llmProvider.generate(retryAssembled2);
    raw = result.content;
    const finalParsed = jsonOutputParser.parse(raw);
    if (finalParsed && jsonOutputParser.hasSummary(finalParsed)) {
      entityUpdater.applySummary(session, finalParsed[SUMMARY]);
      return raw;
    }

    // 三次仍失败：使用完整 raw 作为总结
    entityUpdater.applySummary(session, raw);
    const fallbackMsg = `LLM 三次均未输出合法 JSON（缺少 "${SUMMARY}" 字段），已使用完整输出作为备用。`;
    this._pushDisplay(session, 'system', fallbackMsg);
    return raw;
  }

  _finishSummary(session) {
    session.subState = SubState.AWAITING_INPUT;
    this.repository.save(session);

    this._pushDisplay(session, 'system', GameConfig.GUIDANCE.SUMMARY_DONE);
  }
}
