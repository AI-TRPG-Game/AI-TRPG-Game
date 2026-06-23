import { GameConfig } from '../config/GameConfig.js';
import { FlowType, SubState } from '../domain/enums.js';
import { conversationHistoryBuilder } from './ConversationHistoryBuilder.js';
import { inputAssembler } from './InputAssembler.js';
import { jsonOutputParser } from './JsonOutputParser.js';
import { entityUpdater } from './EntityUpdater.js';

export class HistorySummarizer {
  constructor({ llmProvider, repository, streamEmitter }) {
    this.llmProvider = llmProvider;
    this.repository = repository;
    this.streamEmitter = streamEmitter;
  }

  shouldSummarize(session) {
    if (session.chatRecord.length <= 2) return false;
    const charCount = conversationHistoryBuilder.estimateCharCount(
      session.chatRecord,
      true
    );
    return charCount > GameConfig.SUMMARY_THRESHOLD_CHARS;
  }

  async checkAndRun(session, streamId) {
    if (!this.shouldSummarize(session)) return false;

    session.subState = SubState.SUMMARIZING;
    this.repository.save(session);

    this._pushDisplay(session, 'system', GameConfig.GUIDANCE.SUMMARIZING);

    if (streamId) {
      this.streamEmitter.emit(streamId, {
        type: 'system',
        content: GameConfig.GUIDANCE.SUMMARIZING,
      });
      this.streamEmitter.emit(streamId, { type: 'input_lock', locked: true });
    }

    const assembled = inputAssembler.assemble(FlowType.HISTORY_SUMMARY, session);

    const raw = await this._callWithSummaryRetry(session, assembled, streamId);

    this._finishSummary(session, streamId);

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

  async _callWithSummaryRetry(session, assembled, streamId) {
    let attemptNum = 0;

    const doCall = async (assembledPrompt) => {
      attemptNum++;
      let raw = '';

      if (streamId) {
        this.streamEmitter.emit(streamId, {
          type: 'debug_prompt',
          flowType: FlowType.HISTORY_SUMMARY,
          attempt: attemptNum,
          systemInstruction: assembledPrompt.messages[0]?.content || '',
          userContent: assembledPrompt.messages.slice(1).map(m =>
            `[${m.role}] ${m.content}`
          ).join('\n'),
        });

        raw = await this.llmProvider.generateStream(assembledPrompt, (_chunk) => {
          // 总结不发射 chunk 到对话框
        });
      } else {
        raw = await this.llmProvider.generate(assembledPrompt);
      }

      if (streamId) {
        this.streamEmitter.emit(streamId, {
          type: 'debug_raw',
          flowType: FlowType.HISTORY_SUMMARY,
          attempt: attemptNum,
          content: raw,
        });
      }

      return raw;
    };

    let raw = await doCall(assembled);

    const parsed = jsonOutputParser.parse(raw);
    if (parsed && jsonOutputParser.hasSummary(parsed)) {
      entityUpdater.applySummary(session, parsed.summary);
      return raw;
    }

    // 第一次重试
    const reminder = '\n\n【请一定只输出合法的 JSON，且必须包含 "summary" 字段】';
    const retryMessages = [...assembled.messages];
    const lastUserIdx = retryMessages.map(m => m.role).lastIndexOf('user');
    if (lastUserIdx >= 0) {
      retryMessages[lastUserIdx] = {
        ...retryMessages[lastUserIdx],
        content: retryMessages[lastUserIdx].content + reminder,
      };
    }
    const retryAssembled = { ...assembled, messages: retryMessages };

    raw = await doCall(retryAssembled);
    const retryParsed = jsonOutputParser.parse(raw);
    if (retryParsed && jsonOutputParser.hasSummary(retryParsed)) {
      entityUpdater.applySummary(session, retryParsed.summary);
      return raw;
    }

    // 第二次仍失败：使用完整 raw 作为总结
    entityUpdater.applySummary(session, raw);
    const fallbackMsg = 'LLM 两次均未输出合法 JSON（缺少 "summary" 字段），已使用完整输出作为备用。';
    this._pushDisplay(session, 'system', fallbackMsg);
    if (streamId) {
      this.streamEmitter.emit(streamId, {
        type: 'system',
        content: fallbackMsg,
      });
    }
    return raw;
  }

  _finishSummary(session, streamId) {
    session.subState = SubState.AWAITING_INPUT;
    this.repository.save(session);

    this._pushDisplay(session, 'system', GameConfig.GUIDANCE.SUMMARY_DONE);

    if (streamId) {
      this.streamEmitter.emit(streamId, {
        type: 'system',
        content: GameConfig.GUIDANCE.SUMMARY_DONE,
      });
      this.streamEmitter.emit(streamId, { type: 'input_lock', locked: false });
    }
  }
}
