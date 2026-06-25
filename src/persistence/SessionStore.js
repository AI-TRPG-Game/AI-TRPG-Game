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
    player: session.player || '',
    keyCharacters: session.keyCharacters || [],
    keyCharacterIndex: session.keyCharacterIndex ?? 0,
    keyCharSetupHistory: session.keyCharSetupHistory || [],
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
    sortOrder: session.sortOrder ?? Date.now(),
  };
}

export class SessionStore {
  async listSessions() {
    const sessions = await runStore('readonly', store => store.getAll());
    return sessions
      .map(normalizeSession)
      .sort((a, b) => b.sortOrder - a.sortOrder);
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

  /**
   * 交换两个会话的 sortOrder，持久化排序变更。
   * @param {string} idA 被拖拽的会话 id
   * @param {string} idB 目标位置的会话 id
   */
  async swapSessionOrder(idA, idB) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const reqA = store.get(idA);
      reqA.onsuccess = () => {
        const reqB = store.get(idB);
        reqB.onsuccess = () => {
          const sessionA = reqA.result;
          const sessionB = reqB.result;
          if (!sessionA || !sessionB) {
            db.close();
            return reject(new Error('Session not found'));
          }
          const tmp = sessionA.sortOrder ?? Date.now();
          sessionA.sortOrder = sessionB.sortOrder ?? Date.now();
          sessionB.sortOrder = tmp;
          store.put(sessionA);
          store.put(sessionB);
        };
        reqB.onerror = () => { db.close(); reject(reqB.error); };
      };
      reqA.onerror = () => { db.close(); reject(reqA.error); };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
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
