const DB_NAME = 'ai-trpg-game';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const RECOVERABLE_SUB_STATES = new Set(['LLM_STREAMING', 'SUMMARIZING']);

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runStore(mode, fn) {
  return openDb().then(
    db =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const request = fn(store);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
  );
}

function normalizeSession(session) {
  const now = new Date().toISOString();
  const recoveredSubState = RECOVERABLE_SUB_STATES.has(session.subState)
    ? 'AWAITING_INPUT'
    : session.subState || 'AWAITING_INPUT';

  return {
    id: session.id,
    title: session.title || '新剧本',
    phase: session.phase || 'WORLD_SETTING',
    subState: recoveredSubState,
    openingDone: Boolean(session.openingDone),
    worldSettings: session.worldSettings || '',
    protagonist: session.protagonist || '',
    chatRecord: session.chatRecord || [],
    setupHistory: session.setupHistory || { world: [], character: [] },
    displayLog: session.displayLog || [],
    optionBuffer: session.optionBuffer || '',
    locations: session.locations || [],
    npcs: session.npcs || [],
    inventory: session.inventory || [],
    pendingDiceFlow: recoveredSubState === 'AWAITING_INPUT'
      ? null
      : session.pendingDiceFlow || null,
    createdAt: session.createdAt || now,
    updatedAt: session.updatedAt || now,
  };
}

export class SessionStore {
  async listSessions() {
    const sessions = await runStore('readonly', store => store.getAll());
    return sessions
      .map(normalizeSession)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getSession(id) {
    const session = await runStore('readonly', store => store.get(id));
    return session ? normalizeSession(session) : null;
  }

  async saveSession(session) {
    const normalized = normalizeSession({
      ...session,
      updatedAt: new Date().toISOString(),
    });
    await runStore('readwrite', store => store.put(normalized));
    localStorage.setItem('ai-trpg-current-session-id', normalized.id);
    return normalized;
  }

  async createSession(title = '新剧本') {
    const now = new Date().toISOString();
    const session = normalizeSession({
      id: crypto.randomUUID(),
      title,
      createdAt: now,
      updatedAt: now,
    });
    return this.saveSession(session);
  }

  async deleteSession(id) {
    await runStore('readwrite', store => store.delete(id));
    if (localStorage.getItem('ai-trpg-current-session-id') === id) {
      localStorage.removeItem('ai-trpg-current-session-id');
    }
  }

  getCurrentSessionId() {
    return localStorage.getItem('ai-trpg-current-session-id');
  }
}

export const sessionStore = new SessionStore();
