import {
  Phase,
  SubState,
  FlowType,
  GameAction,
} from '../domain/enums.js';

export class PhaseManager {
  canPerformAction(session, action) {
    if (session.isInputLocked() && action === GameAction.SEND_MESSAGE) {
      return { allowed: false, reason: '当前输入已锁定' };
    }

    switch (action) {
      case GameAction.ENTER_WORLD_SETTING:
        return { allowed: true };
      case GameAction.ENTER_CHARACTER_SETTING:
        if (!session.worldSettings) {
          return { allowed: false, reason: '请先存档世界观' };
        }
        if (session.phase !== Phase.WORLD_SETTING) {
          return { allowed: false, reason: '当前不在世界设定阶段' };
        }
        return { allowed: true };
      case GameAction.SAVE_WORLD:
        if (session.phase !== Phase.WORLD_SETTING) {
          return { allowed: false, reason: '当前不在世界设定阶段' };
        }
        return { allowed: true };
      case GameAction.SAVE_CHARACTER:
        if (session.phase !== Phase.CHARACTER_SETTING) {
          return { allowed: false, reason: '当前不在人物设定阶段' };
        }
        return { allowed: true };
      case GameAction.OPEN_STORY:
        if (!session.protagonist) {
          return { allowed: false, reason: '请先保存主角设定' };
        }
        if (session.openingDone) {
          return { allowed: false, reason: '故事已开幕' };
        }
        if (session.phase !== Phase.CHARACTER_SETTING) {
          return { allowed: false, reason: '当前不在人物设定阶段' };
        }
        return { allowed: true };
      case GameAction.SEND_MESSAGE:
        if (session.subState !== SubState.AWAITING_INPUT) {
          return { allowed: false, reason: '请等待当前操作完成' };
        }
        return { allowed: true };
      case GameAction.UPDATE_PROTAGONIST:
        return { allowed: true };
      default:
        return { allowed: false, reason: '未知操作' };
    }
  }

  getFlowType(session, context = {}) {
    const { isOpening = false, isDiceResolution = false, isSummary = false } =
      context;

    if (isSummary) return FlowType.HISTORY_SUMMARY;
    if (isDiceResolution) return FlowType.NARRATION_II;

    switch (session.phase) {
      case Phase.WORLD_SETTING:
        return FlowType.WORLD_GEN;
      case Phase.CHARACTER_SETTING:
        return FlowType.CHARACTER_GEN;
      case Phase.STORY_PLAY:
        if (isOpening) return FlowType.STORY_OPENING;
        return FlowType.NARRATION_I;
      default:
        throw new Error(`Unknown phase: ${session.phase}`);
    }
  }

  advancePhase(session, event) {
    switch (event) {
      case 'ENTER_CHARACTER_SETTING':
        session.phase = Phase.CHARACTER_SETTING;
        break;
      case 'OPEN_STORY':
        session.phase = Phase.STORY_PLAY;
        session.openingDone = true;
        break;
      default:
        break;
    }
  }

  setSubState(session, subState) {
    session.subState = subState;
  }
}

export const phaseManager = new PhaseManager();
