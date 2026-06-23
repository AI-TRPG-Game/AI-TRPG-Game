const API_BASE = '/api';

export class ApiClient {
  async createSession(title = '新剧本') {
    const res = await fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return res.json();
  }

  async getSession(sessionId) {
    throw new Error(`Session ${sessionId} is stored in IndexedDB`);
  }

  async enterWorldSetting(session) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/enter-world`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return res.json();
  }

  async enterCharacterSetting(session) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/enter-character`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return res.json();
  }

  async saveWorld(session) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/save-world`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return res.json();
  }

  async saveCharacter(session) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/save-character`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return res.json();
  }

  async updateProtagonist(session, protagonist) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/protagonist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, protagonist }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return res.json();
  }

  async openStory(session, handlers) {
    return this._streamRequest(
      `${API_BASE}/sessions/${session.id}/open-story`,
      handlers,
      { session }
    );
  }

  async sendMessage(session, text, handlers) {
    return this._streamRequest(
      `${API_BASE}/sessions/${session.id}/message`,
      handlers,
      { session, text }
    );
  }

  async confirmDice(session, handlers) {
    return this._streamRequest(
      `${API_BASE}/sessions/${session.id}/dice-confirm`,
      handlers,
      { session }
    );
  }

  async cancelDice(session) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/dice-cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return res.json();
  }

  async _streamRequest(url, handlers, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(await this._errorText(res));

    const { streamId } = await res.json();

    return new Promise((resolve, reject) => {
      const eventSource = new EventSource(`${API_BASE}/streams/${streamId}`);
      let botMessageEl = null;

      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'chunk':
            if (!botMessageEl && handlers.onBotStart) {
              botMessageEl = handlers.onBotStart();
            }
            if (handlers.onChunk) handlers.onChunk(data.content, botMessageEl);
            break;
          case 'system':
            if (handlers.onSystem) handlers.onSystem(data.content);
            break;
          case 'input_lock':
            if (handlers.onInputLock) handlers.onInputLock(data.locked);
            break;
          case 'llm_complete':
            if (handlers.onLlmComplete) handlers.onLlmComplete(data.content);
            break;
          case 'retry_clear':
            botMessageEl = null;
            if (handlers.onRetryClear) handlers.onRetryClear(data.content);
            break;
          case 'dice_confirm':
            botMessageEl = null;
            if (handlers.onDiceConfirm) handlers.onDiceConfirm(data.diceNotation);
            break;
          case 'bot_break':
            botMessageEl = null;
            if (handlers.onBotBreak) handlers.onBotBreak();
            break;
          case 'debug_prompt':
            if (handlers.onDebugPrompt) handlers.onDebugPrompt(data);
            break;
          case 'debug_raw':
            if (handlers.onDebugRaw) handlers.onDebugRaw(data);
            break;
          case 'done':
            if (handlers.onDone) handlers.onDone(data.session, data.result);
            resolve({ session: data.session, result: data.result });
            break;
          case 'error':
            if (handlers.onError) handlers.onError(data.error);
            reject(new Error(data.error));
            break;
          case 'end':
            eventSource.close();
            break;
          default:
            break;
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        reject(new Error('SSE connection failed'));
      };
    });
  }

  async _errorText(res) {
    try {
      const data = await res.json();
      return data.error || res.statusText;
    } catch {
      return res.statusText;
    }
  }
}

export const apiClient = new ApiClient();
