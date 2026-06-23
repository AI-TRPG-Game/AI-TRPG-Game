import { GameSession } from '../domain/GameSession.js';

export class RequestSessionRepository {
  constructor(initialSession = null) {
    this.sessions = new Map();
    if (initialSession) {
      const session = new GameSession(initialSession);
      session.recoverTransientState();
      this.sessions.set(session.id, session);
    }
  }

  create(title = '新剧本') {
    const now = new Date().toISOString();
    const session = new GameSession({
      id: crypto.randomUUID(),
      title,
      createdAt: now,
      updatedAt: now,
    });
    this.sessions.set(session.id, session);
    return session;
  }

  findById(id) {
    return this.sessions.get(id) ?? null;
  }

  list() {
    return [...this.sessions.values()];
  }

  save(session) {
    session.touch();
    this.sessions.set(session.id, session);
    return session;
  }
}
