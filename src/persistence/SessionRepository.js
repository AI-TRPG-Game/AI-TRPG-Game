import crypto from 'crypto';
import { GameSession } from '../domain/GameSession.js';
import { Phase, SubState } from '../domain/enums.js';

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function rowToSession(row) {
  if (!row) return null;
  return new GameSession({
    id: row.id,
    title: row.title,
    phase: row.phase,
    subState: row.sub_state,
    openingDone: Boolean(row.opening_done),
    worldSettings: row.world_settings,
    protagonist: row.protagonist,
    chatRecord: parseJson(row.chat_record, []),
    setupHistory: parseJson(row.setup_history, { world: [], character: [] }),
    optionBuffer: row.option_buffer,
    locations: parseJson(row.locations, []),
    npcs: parseJson(row.npcs, []),
    inventory: parseJson(row.inventory, []),
    pendingDiceFlow: row.pending_dice_flow
      ? parseJson(row.pending_dice_flow, null)
      : null,
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
          world_settings, protagonist, chat_record, setup_history,
          option_buffer, locations, npcs, inventory,
          pending_dice_flow, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, 0,
          '', '', '[]', '{"world":[],"character":[]}',
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
