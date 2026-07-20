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

  async updatePlayer(session, player) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/player`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, player }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return res.json();
  }

  // ── 关键角色 ──

  async enterKeyCharacterSetting(session) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/enter-key-character`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return res.json();
  }

  async saveKeyCharacter(session) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/save-key-character`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return res.json();
  }

  async inviteNextKeyCharacter(session) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/invite-next-key-character`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return res.json();
  }

  async getStoryOpenConfirm(session) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/open-story-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return res.json();
  }

  // ── 设定增删改 ──

  async updateWorldSettings(session, worldSettings) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/world-settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, worldSettings }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return res.json();
  }

  async _patchEntity(session, path, index, data) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, index, data }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return res.json();
  }

  async _deleteEntity(session, path, index) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/${path}/${index}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return res.json();
  }

  async upsertLocation(session, index, data) { return this._patchEntity(session, 'locations', index, data); }
  async deleteLocation(session, index) { return this._deleteEntity(session, 'locations', index); }
  async upsertNpc(session, index, data) { return this._patchEntity(session, 'npcs', index, data); }
  async deleteNpc(session, index) { return this._deleteEntity(session, 'npcs', index); }
  async upsertItem(session, index, data) { return this._patchEntity(session, 'items', index, data); }
  async deleteItem(session, index) { return this._deleteEntity(session, 'items', index); }
  async upsertKeyCharacter(session, index, data) { return this._patchEntity(session, 'key-characters', index, data); }
  async deleteKeyCharacter(session, index) { return this._deleteEntity(session, 'key-characters', index); }

  async openStory(session, { onDebug } = {}) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/open-story`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return this._consumeSseStream(res, onDebug);
  }

  async sendMessage(session, text, { onDebug } = {}) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, text }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return this._consumeSseStream(res, onDebug);
  }

  async confirmDice(session, { onDebug } = {}) {
    const res = await fetch(`${API_BASE}/sessions/${session.id}/dice-confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
    });
    if (!res.ok) throw new Error(await this._errorText(res));
    return this._consumeSseStream(res, onDebug);
  }

  /**
   * 消费 SSE 流：解析 event:debug / event:done / event:error 三类事件。
   * - debug：调用 onDebug(log) 实时推送到 god's eye 面板
   * - done：resolve 最终结果
   * - error：reject 错误
   *
   * 实现要点：
   *   - 使用 ReadableStream 逐 chunk 读取，避免一次性缓冲整个响应
   *   - SSE 事件以 \n\n 分隔，事件内 event:/data: 行用 \n 分隔
   *   - data 字段可能跨多行（这里后端单行写入，但兼容多行拼接）
   */
  async _consumeSseStream(res, onDebug) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult = null;
    let errorMsg = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 事件之间以空行（\n\n）分隔
      let sepIdx;
      while ((sepIdx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);

        const parsed = this._parseSseChunk(chunk);
        if (!parsed) continue;

        if (parsed.event === 'debug' && onDebug) {
          try { onDebug(parsed.data); } catch { /* 回调异常不影响流消费 */ }
        } else if (parsed.event === 'done') {
          finalResult = parsed.data;
        } else if (parsed.event === 'error') {
          errorMsg = parsed.data?.message || '未知错误';
        }
      }
    }

    if (errorMsg) throw new Error(errorMsg);
    if (!finalResult) throw new Error('SSE 流意外结束：未收到 done 事件');
    return finalResult;
  }

  /**
   * 解析单个 SSE 事件块（不含尾部的 \n\n）。
   * 返回 { event, data } 或 null（无效块）。
   */
  _parseSseChunk(chunk) {
    if (!chunk) return null;
    const lines = chunk.split('\n');
    let event = 'message';
    let dataStr = '';
    for (const line of lines) {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        if (dataStr) dataStr += '\n';
        dataStr += line.slice(5).trim();
      }
    }
    if (!dataStr) return null;
    try {
      return { event, data: JSON.parse(dataStr) };
    } catch {
      return { event, data: { raw: dataStr } };
    }
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
