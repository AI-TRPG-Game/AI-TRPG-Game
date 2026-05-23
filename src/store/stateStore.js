const KEY = "ai_trpg_sessions_v1";

function nowIso() {
  return new Date().toISOString();
}

function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
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

export function listSessions() {
  return getAll()
    .map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function createSession() {
  const session = {
    id: uid(),
    title: "新剧本",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    mode: "normal", // normal | meta
    phase: "setup_world",
    messages: [],
    summary: "",
    state: {
      world_background: "默认世界观：小镇与一座废弃教堂。",
      quest_core: "核心任务：调查教堂的怪声。",
      quest_current: "当前任务：前往教堂入口并寻找线索。",
      pc: { name: "调查员", hp: 10, san: 10 },
      npcs: [],
      inventory: [],
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
  return getAll().find((s) => s.id === id) ?? null;
}

export function saveSession(session) {
  session.updatedAt = nowIso();
  const all = getAll();
  const idx = all.findIndex((s) => s.id === session.id);
  if (idx >= 0) all[idx] = session;
  else all.unshift(session);
  setAll(all);
}

export function updateSession(id, mutator) {
  const session = loadSession(id);
  if (!session) throw new Error("session not found");
  mutator(session);
  saveSession(session);
  return session;
}
