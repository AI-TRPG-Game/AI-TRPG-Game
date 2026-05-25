const KEY = 'ai_trpg_sessions_v3';

function nowIso() {
  return new Date().toISOString();
}

function uid() {
  return Math.random().toString(16).slice(2) + '-' + Date.now().toString(16);
}

function getAll() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function setAll(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

function ensureWorldState(session) {
  session.state = session.state || {};

  if (!('world_background' in session.state)) {
    session.state.world_background = session.state.world || '默认世界观：小镇与一座废弃教堂。';
  }

  if (!('world_settings' in session.state)) {
    session.state.world_settings = session.state.world_background || '';
  }

  if (!('pc_history' in session.state)) session.state.pc_history = [];

  if (!('pc' in session.state)) {
    const ch = session.state.character || { name: '调查员', hp: 10, san: 10 };
    session.state.pc = {
      name: ch.name,
      age: '',
      gender: '',
      occupation: '',
      race: '',
      personality: '',
      appearance: '',
      background: '',
      other: '',
      hp: ch.hp,
      san: ch.san,
      raw: '',
    };
  }

  if (!('npcs' in session.state)) session.state.npcs = [];
  if (!('inventory' in session.state)) session.state.inventory = session.state.inventory || [];

  if (!('quest_core' in session.state)) session.state.quest_core = '';
  if (!('quest_current' in session.state)) {
    session.state.quest_current = session.state.quest || '';
  }

  if (!('rulesets' in session.state)) session.state.rulesets = {};

  if (!('world_history' in session.state)) session.state.world_history = [];

  if (!('diceLog' in session.state)) session.state.diceLog = session.state.diceLog || [];
  if (!('lastRoll' in session.state)) session.state.lastRoll = session.state.lastRoll || null;

  session.summary = session.summary || '';
}

export function listSessions() {
  return getAll()
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function createSession() {
  const session = {
    id: uid(),
    title: '新剧本',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    mode: 'normal',
    phase: 'setup_world',
    messages: [],
    summary: '',
    state: {
      world_background: '默认世界观：小镇与一座废弃教堂。',
      world_settings: '默认世界观：小镇与一座废弃教堂。',
      pc_history: [],
      pc: {
        name: '调查员',
        age: '',
        gender: '',
        occupation: '',
        race: '',
        personality: '',
        appearance: '',
        background: '',
        other: '',
        hp: 10,
        san: 10,
        raw: '',
      },
      npcs: [],
      quest_core: '',
      quest_current: '当前任务：调查教堂的怪声。',
      inventory: [],
      rulesets: {},
      world_history: [],
      diceLog: [],
      lastRoll: null,
    },
  };

  const all = getAll();
  all.unshift(session);
  setAll(all);
  return session;
}

export function loadSession(id) {
  const s = getAll().find((x) => x.id === id) ?? null;
  if (s) ensureWorldState(s);
  return s;
}

export function saveSession(session) {
  ensureWorldState(session);
  session.updatedAt = nowIso();
  const all = getAll();
  const idx = all.findIndex((s) => s.id === session.id);
  if (idx >= 0) all[idx] = session;
  else all.unshift(session);
  setAll(all);
}

export function updateSession(id, mutator) {
  const session = loadSession(id);
  if (!session) throw new Error('session not found');
  mutator(session);
  saveSession(session);
  return session;
}
