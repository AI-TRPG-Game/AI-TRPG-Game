import crypto from 'crypto';
import { GameSession } from '../domain/GameSession.js';
import { Phase, SubState, ChatRole, FlowType } from '../domain/enums.js';
import { jsonOutputParser } from '../services/JsonOutputParser.js';
import { textRefiner } from '../services/TextRefiner.js';

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function refineRaw(flowType, raw) {
  const parsed = jsonOutputParser.parse(raw);
  if (!parsed) return raw;
  return textRefiner.refine(flowType, parsed).html;
}

function appendSetupLog(log, entries, flowType) {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    if (!entry?.content) continue;
    log.push({
      role: entry.role === ChatRole.PLAYER ? 'player' : 'kp',
      content:
        entry.role === ChatRole.PLAYER
          ? entry.content
          : refineRaw(flowType, entry.content),
      timestamp: entry.timestamp,
    });
  }
}

function rebuildDisplayLog(row, setupHistory, chatRecord, pendingDiceFlow) {
  const log = [];

  appendSetupLog(log, setupHistory.world, FlowType.WORLD_GEN);
  appendSetupLog(log, setupHistory.character, FlowType.CHARACTER_GEN);

  for (const entry of chatRecord) {
    if (!entry?.content) continue;
    log.push({
      role: entry.role || ChatRole.KP,
      content: entry.content,
      timestamp: entry.timestamp,
    });
  }

  if (pendingDiceFlow?.pendingRaw) {
    log.push({
      role: ChatRole.KP,
      content: refineRaw(FlowType.NARRATION_I, pendingDiceFlow.pendingRaw),
      timestamp: row.updated_at,
    });
  }

  return log;
}

function rowToSession(row) {
  if (!row) return null;
  const setupHistory = parseJson(row.setup_history, { world: [], character: [] });
  const chatRecord = parseJson(row.chat_record, []);
  const pendingDiceFlow = row.pending_dice_flow
    ? parseJson(row.pending_dice_flow, null)
    : null;
  const displayLog = parseJson(row.display_log, []);

  return new GameSession({
    id: row.id,
    title: row.title,
    phase: row.phase,
    subState: row.sub_state,
    openingDone: Boolean(row.opening_done),
    worldSettings: row.world_settings,
    protagonist: row.protagonist,
    chatRecord,
    setupHistory,
    displayLog: displayLog.length > 0
      ? displayLog
      : rebuildDisplayLog(row, setupHistory, chatRecord, pendingDiceFlow),
    optionBuffer: row.option_buffer,
    locations: parseJson(row.locations, []),
    npcs: parseJson(row.npcs, []),
    inventory: parseJson(row.inventory, []),
    pendingDiceFlow,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class SessionRepository {
  constructor(database) {
    this.db = database;
  }

  create(title = '新剧本') {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (
          id, title, phase, sub_state, opening_done,
          world_settings, protagonist, chat_record, setup_history, display_log,
          option_buffer, locations, npcs, inventory,
          pending_dice_flow, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, 0,
          '', '', '[]', '{"world":[],"character":[]}', '[]',
          '', '[]', '[]', '[]',
          NULL, ?, ?
        )`
      )
      .run(id, title, Phase.WORLD_SETTING, SubState.AWAITING_INPUT, now, now);
    return this.findById(id);
  }

  findById(id) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
    return rowToSession(row);
  }

  list() {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
      .all();
    return rows.map(rowToSession);
  }

  save(session) {
    session.touch();
    this.db
      .prepare(
        `UPDATE sessions SET
          title = ?,
          phase = ?,
          sub_state = ?,
          opening_done = ?,
          world_settings = ?,
          protagonist = ?,
          chat_record = ?,
          setup_history = ?,
          display_log = ?,
          option_buffer = ?,
          locations = ?,
          npcs = ?,
          inventory = ?,
          pending_dice_flow = ?,
          updated_at = ?
        WHERE id = ?`
      )
      .run(
        session.title,
        session.phase,
        session.subState,
        session.openingDone ? 1 : 0,
        session.worldSettings,
        session.protagonist,
        JSON.stringify(session.chatRecord),
        JSON.stringify(session.setupHistory),
        JSON.stringify(session.displayLog),
        session.optionBuffer,
        JSON.stringify(session.locations),
        JSON.stringify(session.npcs),
        JSON.stringify(session.inventory),
        session.pendingDiceFlow
          ? JSON.stringify(session.pendingDiceFlow)
          : null,
        session.updatedAt,
        session.id
      );
    return session;
  }

  updateProtagonist(id, protagonist) {
    const session = this.findById(id);
    if (!session) throw new Error('Session not found');
    session.protagonist = protagonist;
    return this.save(session);
  }
}
