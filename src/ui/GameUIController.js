import { apiClient } from '../api/ApiClient.js';
import { sessionStore } from '../persistence/SessionStore.js';

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// 旧数据兼容：将 LLM raw 输出渲染为带分隔线的 HTML
// 注意：新数据已由后端 TextRefiner 预渲染，不再经过此函数
function renderBotContent(raw) {
  if (!raw) return '';

  // 1. 尝试 JSON 解析
  try {
    let text = raw.trim();
    text = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return renderJsonBot(parsed);
    }
  } catch {
    // 不是 JSON，尝试 XML 兼容解析
  }

  // 2. XML 兼容解析（旧数据）
  const narRegex = /<narration>([\s\S]*?)<\/narration>/gi;
  let hasNarration = narRegex.test(raw);

  if (hasNarration) {
    narRegex.lastIndex = 0;
    const parts = [];

    const nMatch = raw.match(/<narration>([\s\S]*?)<\/narration>/i);
    if (nMatch) {
      parts.push(escapeHtml(nMatch[1]));
    }

    const metaRegex = /<(location|npc|item|HP|SAN)>([\s\S]*?)<\/\1>/gi;
    let mMatch;
    while ((mMatch = metaRegex.exec(raw)) !== null) {
      parts.push(escapeHtml(mMatch[2]));
    }

    const oMatch = raw.match(/<option>([\s\S]*?)<\/option>/i);
    if (oMatch) {
      parts.push(escapeHtml(oMatch[1]));
    }

    const dMatch = raw.match(/<dice>([\s\S]*?)<\/dice>/i);
    if (dMatch) {
      parts.push(escapeHtml(dMatch[1]));
    }

    if (parts.length > 0) {
      return parts
        .map(h => `<div class="kp-block">${h}</div>`)
        .join('<div class="kp-divider"></div>');
    }
  }

  // 3. 兜底：纯文本
  return escapeHtml(raw);
}

function renderJsonBot(parsed) {
  const parts = [];

  if (parsed.narration) {
    parts.push(escapeHtml(parsed.narration));
  }

  if (parsed.dice) {
    parts.push(escapeHtml(`【判定：${parsed.dice.skill_name || ''}（${parsed.dice.skill_point ?? ''}），${parsed.dice.notation || ''}，成功率${parsed.dice.success_rate ?? ''}%】`));
  }

  if (Array.isArray(parsed.locations) && parsed.locations.length > 0) {
    for (const l of parsed.locations) {
      parts.push(escapeHtml(`【地点】${l.name}：${l.description}`));
    }
  }

  if (Array.isArray(parsed.npcs) && parsed.npcs.length > 0) {
    for (const n of parsed.npcs) {
      parts.push(escapeHtml(`【NPC】${n.name}：${n.description}`));
    }
  }

  if (Array.isArray(parsed.items) && parsed.items.length > 0) {
    for (const i of parsed.items) {
      parts.push(escapeHtml(`【物品】${i.name}：${i.status || '已获得'}，${i.description}`));
    }
  }

  if (parsed.hp !== null && parsed.hp !== undefined) {
    parts.push(escapeHtml(`HP：${parsed.hp}`));
  }
  if (parsed.san !== null && parsed.san !== undefined) {
    parts.push(escapeHtml(`SAN：${parsed.san}`));
  }

  if (Array.isArray(parsed.options) && parsed.options.length > 0) {
    parts.push(escapeHtml('【请选择你接下来的行动】\n' + parsed.options.join('\n')));
  }

  // world_description / character_card / summary（非叙事阶段）
  if (!parsed.narration && !parsed.options) {
    if (parsed.world_description) return escapeHtml(parsed.world_description);
    if (parsed.summary) return escapeHtml(parsed.summary);
    return escapeHtml(JSON.stringify(parsed, null, 2));
  }

  if (parts.length === 0) return '';

  return parts
    .map(h => `<div class="kp-block">${h.replace(/\n/g, '<br>')}</div>`)
    .join('<div class="kp-divider"></div>');
}

export class GameUIController {
  constructor() {
    this.sessionId = null;
    this.session = null;
    this.selectedOptions = new Set();
    this.inputLocked = false;
    this._botEl = null;
    this._waitingEl = null;
    this._botText = '';
    this._dicePendingBotEl = null;   // dice 确认阶段的 bot 气泡引用
    this._diceConfirmEl = null;

    this.messagesEl = document.getElementById('messages');
    this.promptInput = document.getElementById('prompt-input');
    this.sendButton = document.getElementById('send-button');
    this.optionsBar = document.getElementById('options-bar');
    this.phaseLabel = document.getElementById('phase-label');
    this.worldPanel = document.getElementById('world-settings');
    this.protagonistPanel = document.getElementById('protagonist-settings');
    this.locationsPanel = document.getElementById('locations-panel');
    this.npcsPanel = document.getElementById('npcs-panel');
    this.inventoryPanel = document.getElementById('inventory-panel');
    this.actionButtons = document.getElementById('action-buttons');
    this.addNpcButton = document.getElementById('btn-add-npc');
    this.npcModalBackdrop = document.getElementById('npc-modal-backdrop');
    this.npcModalTitle = document.getElementById('npc-modal-title');
    this.npcForm = document.getElementById('npc-form');
    this.npcNameInput = document.getElementById('npc-name-input');
    this.npcDescriptionInput = document.getElementById('npc-description-input');
    this.editingNpcIndex = null;
    this.sessionSidebar = document.getElementById('session-sidebar');
    this.sessionToggleButton = document.getElementById('btn-session-toggle');
    this.newSessionButton = document.getElementById('btn-new-session');
    this.sessionListPanel = null;

    this.godseyePanel = document.getElementById('godseye-panel');
    this.godseyeContent = document.getElementById('godseye-content');
    this._godseyeOpen = false;

    this._restoreTheme();
    this._buildSessionPanel();
    this._bindEvents();
    this._init();
  }

  // ── 主题 ──
  _restoreTheme() {
    const saved = localStorage.getItem('ai-trpg-theme');
    if (saved === 'light') {
      document.body.classList.add('light');
    }
  }

  _toggleTheme() {
    const isLight = document.body.classList.toggle('light');
    localStorage.setItem('ai-trpg-theme', isLight ? 'light' : 'dark');
    document.getElementById('btn-theme').textContent = isLight ? '\u2600' : '\u263E';
  }

  // ── 初始化 ──
  async _init() {
    try {
      const hash = window.location.hash.slice(1);
      const storedId = hash || sessionStore.getCurrentSessionId();
      const storedSession = storedId ? await sessionStore.getSession(storedId) : null;

      if (storedSession) {
        await this._loadSession(storedSession);
        return;
      }

      await this._createNewSession();
    } catch (err) {
      this._appendMessage(`初始化失败: ${err.message}`, 'error');
    }
  }

  _bindEvents() {
    this.sendButton.addEventListener('click', () => this._sendMessage());
    this.promptInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !this._isInputBlocked()) this._sendMessage();
    });

    document.getElementById('btn-theme').addEventListener('click', () =>
      this._toggleTheme()
    );
    document.getElementById('btn-save-world').addEventListener('click', () =>
      this._saveWorld()
    );
    document.getElementById('btn-enter-character').addEventListener('click', () =>
      this._enterCharacter()
    );
    document.getElementById('btn-save-character').addEventListener('click', () =>
      this._saveCharacter()
    );
    document.getElementById('btn-open-story').addEventListener('click', () =>
      this._openStory()
    );
    document.getElementById('btn-save-protagonist').addEventListener('click', () =>
      this._saveProtagonistEdit()
    );
    document.getElementById('btn-godseye').addEventListener('click', () =>
      this._toggleGodseye()
    );
    document.getElementById('btn-godseye-close').addEventListener('click', () =>
      this._closeGodseye()
    );
    this.addNpcButton.addEventListener('click', () => this._openNpcModal());
    document.getElementById('btn-npc-close').addEventListener('click', () =>
      this._closeNpcModal()
    );
    document.getElementById('btn-npc-cancel').addEventListener('click', () =>
      this._closeNpcModal()
    );
    this.npcModalBackdrop.addEventListener('click', (event) => {
      if (event.target === this.npcModalBackdrop) this._closeNpcModal();
    });
    this.npcForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this._saveNpcFromModal();
    });
    this.npcsPanel.addEventListener('click', (event) => {
      const button = event.target.closest('[data-npc-index]');
      if (!button) return;
      this._openNpcModal(Number(button.dataset.npcIndex));
    });
  }

  _buildSessionPanel() {
    this.sessionListPanel = document.getElementById('session-list');

    const collapsed = localStorage.getItem('ai-trpg-session-sidebar') === 'collapsed';
    this.sessionSidebar.classList.toggle('collapsed', collapsed);
    this.sessionToggleButton.setAttribute('aria-expanded', String(!collapsed));

    this.sessionToggleButton.addEventListener('click', () => {
      this._toggleSessionSidebar();
    });
    this.newSessionButton.addEventListener('click', () => {
      this._createNewSession();
    });
    document.addEventListener('keydown', (event) => {
      if (event.altKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        this._toggleSessionSidebar();
      }
    });
  }

  _toggleSessionSidebar() {
    const collapsed = this.sessionSidebar.classList.toggle('collapsed');
    this.sessionToggleButton.setAttribute('aria-expanded', String(!collapsed));
    localStorage.setItem(
      'ai-trpg-session-sidebar',
      collapsed ? 'collapsed' : 'expanded'
    );
  }

  async _createNewSession() {
    const { session } = await apiClient.createSession();
    const worldResult = await apiClient.enterWorldSetting(session);
    await this._loadSession(worldResult.session);
  }

  async _loadSession(session) {
    this.sessionId = session.id;
    this.session = await sessionStore.saveSession(session);
    window.location.hash = this.sessionId;
    this.messagesEl.innerHTML = '';
    this.selectedOptions.clear();
    this._botEl = null;
    this._waitingEl = null;
    this._botText = '';
    this._dicePendingBotEl = null;
    this._removeDiceConfirm();
    this._restoreUI();
    await this._renderSessionList();
  }

  async _persistSession() {
    if (!this.session) return;
    this.session = await sessionStore.saveSession(this.session);
    await this._renderSessionList();
  }

  async _renderSessionList() {
    if (!this.sessionListPanel) return;
    const sessions = await sessionStore.listSessions();
    this.sessionListPanel.innerHTML = '';
    for (const session of sessions) {
      const item = document.createElement('div');
      item.className = 'session-item';
      if (session.id === this.sessionId) item.classList.add('active');

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'session-main';
      openBtn.innerHTML = `
        <span class="session-title">${escapeHtml(session.title || '新剧本')}</span>
        <span class="session-meta">${escapeHtml(session.phase)} · ${escapeHtml(session.subState)}</span>
      `;
      openBtn.addEventListener('click', () => this._loadSession(session));

      const actions = document.createElement('div');
      actions.className = 'session-actions';

      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'session-icon-button';
      renameBtn.title = '重命名会话';
      renameBtn.setAttribute('aria-label', '重命名会话');
      renameBtn.textContent = '✎';
      renameBtn.addEventListener('click', () => this._renameSession(session));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'session-icon-button danger';
      deleteBtn.title = '删除会话';
      deleteBtn.setAttribute('aria-label', '删除会话');
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', () => this._deleteSession(session));

      actions.append(renameBtn, deleteBtn);
      item.append(openBtn, actions);
      this.sessionListPanel.appendChild(item);
    }
  }

  async _renameSession(session) {
    const title = window.prompt('重命名会话', session.title || '新剧本');
    if (title === null) return;

    const nextTitle = title.trim();
    if (!nextTitle) {
      this._appendMessage('会话名不能为空。', 'error');
      return;
    }

    const updated = { ...session, title: nextTitle };
    if (updated.id === this.sessionId) {
      this.session = updated;
    }
    await sessionStore.saveSession(updated);
    await this._renderSessionList();
  }

  async _deleteSession(session) {
    const ok = window.confirm(`删除会话“${session.title || '新剧本'}”吗？`);
    if (!ok) return;

    await sessionStore.deleteSession(session.id);
    if (session.id !== this.sessionId) {
      await this._renderSessionList();
      return;
    }

    const remaining = await sessionStore.listSessions();
    if (remaining.length > 0) {
      await this._loadSession(remaining[0]);
      return;
    }

    await this._createNewSession();
  }

  // ── Handler 构件 ──
  _makeHandlers() {
    return {
      onBotStart: () => {
        this._botEl = this._appendMessage('', 'bot');
        this._botText = '';
        this._clearWaiting();
        return this._botEl;
      },
      onChunk: (chunk, el) => {
        this._clearWaiting();
        this._botText += chunk;
        if (el) {
          // 用 innerHTML 渲染以支持换行；先转义 HTML，再将 \n 转为 <br>
          el.innerHTML = escapeHtml(this._botText).replace(/\n/g, '<br>');
        }
        this._scrollToBottom();
      },
      onLlmComplete: (html) => {
        this._clearWaiting();
        if (this._botEl) {
          this._botEl.innerHTML = html;
        } else {
          this._botEl = this._appendMessage('', 'bot');
          this._botEl.innerHTML = html;
        }
        this._botText = html;
      },
      onSystem: (content) => this._appendMessage(content, 'system'),
      onInputLock: (locked) => this._setInputLocked(locked),
      onRetryClear: (content) => {
        // 清除无效 bot 气泡，替换为系统提示
        if (this._botEl) {
          this._botEl.remove();
          this._botEl = null;
          this._botText = '';
        }
        this._appendMessage(content, 'system');
      },
      onDiceConfirm: (diceNotation) => {
        this._clearWaiting();
        this._dicePendingBotEl = this._botEl;
        this._botEl = null;
        this._botText = '';
        this._renderDiceConfirm(diceNotation);
      },
      onBotBreak: () => {
        this._botEl = null;
        this._botText = '';
      },
      onDebugPrompt: (data) => this._appendDebugPanel(data),
      onDebugRaw: (data) => this._appendDebugPanel(data),
      onError: (msg) => this._appendMessage(msg, 'error'),
      onDone: (s) => {
        this.session = s;
        this._updateUI();
        this._persistSession();
      },
    };
  }

  // ── 等待提示 ──
  _showWaiting() {
    if (!this._waitingEl) {
      this._waitingEl = this._appendMessage(
        'KP正在思考话术，请稍等片刻…',
        'system'
      );
    }
  }

  _clearWaiting() {
    if (this._waitingEl) {
      this._waitingEl.remove();
      this._waitingEl = null;
    }
  }

  // ── Dice 确认/取消 ──
  _renderDiceConfirm(diceNotation) {
    // 移除旧的确认 UI（如有）
    this._removeDiceConfirm();

    this._diceConfirmEl = document.createElement('div');
    this._diceConfirmEl.classList.add('message', 'system');
    this._diceConfirmEl.id = 'dice-confirm-msg';
    this._diceConfirmEl.innerHTML =
      '<div style="margin-bottom:8px;">确定使用该技能进行投掷判定吗？</div>' +
      '<div class="dice-confirm-btns">' +
      '<button id="btn-dice-confirm" class="dice-btn dice-btn-confirm">确定</button>' +
      '<button id="btn-dice-cancel" class="dice-btn dice-btn-cancel">取消并回退至上次行为</button>' +
      '</div>';
    this.messagesEl.appendChild(this._diceConfirmEl);
    this._scrollToBottom();

    document.getElementById('btn-dice-confirm').addEventListener('click', () =>
      this._confirmDice()
    );
    document.getElementById('btn-dice-cancel').addEventListener('click', () =>
      this._cancelDice()
    );
  }

  _removeDiceConfirm() {
    if (this._diceConfirmEl) {
      this._diceConfirmEl.remove();
      this._diceConfirmEl = null;
    }
  }

  async _confirmDice() {
    this._removeDiceConfirm();
    this._setInputLocked(true);
    this._showWaiting();

    try {
      const { session } = await apiClient.confirmDice(
        this.session,
        this._makeHandlers()
      );
      this.session = session;
      this._updateUI();
      await this._persistSession();
    } catch (err) {
      this._appendMessage(`错误: ${err.message}`, 'error');
    } finally {
      this._clearWaiting();
      // 若触发递归 dice（NARRATION_II 又含 <dice>），输入保持锁定
      if (this.session?.subState !== 'DICE_PENDING') {
        this._setInputLocked(false);
      }
    }
  }

  async _cancelDice() {
    try {
      const result = await apiClient.cancelDice(this.session);
      this.session = result.session;
      this._removeDiceConfirm();
      // 移除含 dice 的 bot 气泡
      if (this._dicePendingBotEl) {
        this._dicePendingBotEl.remove();
        this._dicePendingBotEl = null;
      }
      this._botEl = null;
      this._botText = '';
      this._appendMessage(result.message, 'system');
      this._updateUI();
      await this._persistSession();
      this._setInputLocked(false);
    } catch (err) {
      this._appendMessage(`取消失败: ${err.message}`, 'error');
    }
  }

  // ── 核心操作 ──
  async _sendMessage() {
    if (this._isInputBlocked()) return;
    const text = this.promptInput.value.trim();
    if (!text) return;

    this._appendMessage(text, 'user');
    this.promptInput.value = '';
    this.selectedOptions.clear();
    this._renderOptionButtons();

    this._setInputLocked(true);
    this._showWaiting();

    try {
      const { session } = await apiClient.sendMessage(
        this.session,
        text,
        this._makeHandlers()
      );
      this.session = session;
      this._updateUI();
      await this._persistSession();
    } catch (err) {
      this._appendMessage(`错误: ${err.message}`, 'error');
    } finally {
      this._clearWaiting();
      // DICE_AWAITING 时不应解锁输入 —— 等待确认/取消
      if (this.session?.subState !== 'DICE_PENDING') {
        this._setInputLocked(false);
      }
    }
  }

  async _openStory() {
    if (this.session?.openingDone) return;

    this._setInputLocked(true);
    this._showWaiting();
    document.getElementById('btn-open-story').disabled = true;

    try {
      const { session } = await apiClient.openStory(
        this.session,
        this._makeHandlers()
      );
      this.session = session;
      this._updateUI();
      await this._persistSession();
    } catch (err) {
      this._appendMessage(`故事开幕失败: ${err.message}`, 'error');
    } finally {
      this._clearWaiting();
      this._setInputLocked(false);
    }
  }

  async _saveWorld() {
    try {
      const { session, message } = await apiClient.saveWorld(this.session);
      this.session = session;
      this._appendMessage(message, 'system');
      this._updateUI();
      await this._persistSession();
    } catch (err) {
      this._appendMessage(`存档失败: ${err.message}`, 'error');
    }
  }

  async _enterCharacter() {
    try {
      const { session, guidance } = await apiClient.enterCharacterSetting(
        this.session
      );
      this.session = session;
      this._appendMessage(guidance, 'system');
      document.getElementById('btn-enter-character').disabled = true;
      this._updateUI();
      await this._persistSession();
    } catch (err) {
      this._appendMessage(`进入人物设定失败: ${err.message}`, 'error');
    }
  }

  async _saveCharacter() {
    try {
      const { session, message } = await apiClient.saveCharacter(
        this.session
      );
      this.session = session;
      this._appendMessage(message, 'system');
      this._updateUI();
      await this._persistSession();
    } catch (err) {
      this._appendMessage(`保存主角失败: ${err.message}`, 'error');
    }
  }

  async _saveProtagonistEdit() {
    try {
      const { session } = await apiClient.updateProtagonist(
        this.session,
        this.protagonistPanel.value
      );
      this.session = session;
      this._appendMessage('主角设定已手动保存。', 'system');
      this._updateUI();
      await this._persistSession();
    } catch (err) {
      this._appendMessage(`保存失败: ${err.message}`, 'error');
    }
  }

  _openNpcModal(index = null) {
    this.editingNpcIndex = index;
    const npc = Number.isInteger(index) ? this.session?.npcs?.[index] : null;

    this.npcModalTitle.textContent = npc ? '编辑 NPC' : '添加 NPC';
    this.npcNameInput.value = npc?.name || '';
    this.npcDescriptionInput.value = npc?.description || '';
    this.npcModalBackdrop.classList.add('open');
    this.npcNameInput.focus();
  }

  _closeNpcModal() {
    this.npcModalBackdrop.classList.remove('open');
    this.npcForm.reset();
    this.editingNpcIndex = null;
  }

  async _saveNpcFromModal() {
    const name = this.npcNameInput.value.trim();
    const description = this.npcDescriptionInput.value.trim();

    if (!name || !description) {
      this._appendMessage('NPC 名称和描述都不能为空。', 'error');
      return;
    }

    const npcs = [...(this.session.npcs || [])];
    const npc = Number.isInteger(this.editingNpcIndex)
      ? { ...npcs[this.editingNpcIndex], name, description }
      : { name, description };
    if (Number.isInteger(this.editingNpcIndex)) {
      npcs[this.editingNpcIndex] = npc;
    } else {
      npcs.push(npc);
    }

    this.session = {
      ...this.session,
      npcs,
    };
    this._closeNpcModal();
    this._updateUI();
    await this._persistSession();
  }

  // ── UI ──
  _appendMessage(text, type) {
    const el = document.createElement('div');
    el.classList.add('message', type);
    el.textContent = text;
    this.messagesEl.appendChild(el);
    this._scrollToBottom();
    return el;
  }

  _scrollToBottom() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  _setInputLocked(locked) {
    this.inputLocked = locked;
    this._syncInputControls();
    this._renderOptionButtons();
  }

  _isInputBlocked() {
    return this.inputLocked || this.session?.subState !== 'AWAITING_INPUT';
  }

  _syncInputControls() {
    const blocked = this._isInputBlocked();
    this.promptInput.disabled = blocked;
    this.sendButton.disabled = blocked;
  }

  _areOptionButtonsLocked() {
    return this._isInputBlocked();
  }

  _restoreUI() {
    const displayLog = this.session.displayLog || [];
    for (const entry of displayLog) {
      const type =
        entry.role === 'player'
          ? 'user'
          : entry.role === 'system'
            ? 'system'
            : 'bot';
      const el = this._appendMessage('', type);
      if (type === 'bot') {
        // 新格式：refined HTML 以 '<' 开头；旧格式：raw JSON/XML
        const content = entry.content || '';
        if (content.trim().startsWith('<')) {
          el.innerHTML = content;
        } else {
          el.innerHTML = renderBotContent(content);
        }
      } else {
        el.textContent = entry.content;
      }
    }

    if (displayLog.length === 0) {
      this._appendMessage(
        `【会话已恢复】\n阶段: ${this.session.phase}\n点击发送，继续冒险。`,
        'system'
      );
    }
    this._updateUI();
    if (this.session.subState === 'DICE_PENDING' && this.session.pendingDiceFlow) {
      this._renderDiceConfirm(this.session.pendingDiceFlow.diceNotation);
    }
  }

  _updateUI() {
    if (!this.session) return;

    this.phaseLabel.textContent = `阶段: ${this.session.phase} | 状态: ${this.session.subState}`;
    this.worldPanel.value = this.session.worldSettings || '';
    this.protagonistPanel.value = this.session.protagonist || '';

    this.locationsPanel.innerHTML = (this.session.locations || [])
      .map(
        (l) =>
          `<div class="sidebar-item"><strong>${escapeHtml(l.name)}</strong>${escapeHtml(l.description)}</div>`
      )
      .join('');

    this.npcsPanel.innerHTML = (this.session.npcs || [])
      .map(
        (n, index) =>
          `<div class="sidebar-item">
            <div class="sidebar-item-head">
              <strong>${escapeHtml(n.name)}</strong>
              <button class="sidebar-item-action" type="button" data-npc-index="${index}">编辑</button>
            </div>
            ${escapeHtml(n.description)}
          </div>`
      )
      .join('');

    this.inventoryPanel.innerHTML = (this.session.inventory || [])
      .map(
        (i) =>
          `<div class="sidebar-item"><strong>${escapeHtml(i.name)}</strong> (${escapeHtml(i.status)})<br>${escapeHtml(i.description)}</div>`
      )
      .join('');

    this._syncInputControls();
    this._renderOptionButtons();
    this._updateActionButtons();
  }

  _renderOptionButtons() {
    this.optionsBar.innerHTML = '';
    const buffer = this.session?.optionBuffer;
    if (!buffer || this.session.phase !== 'STORY_PLAY') return;

    for (const letter of ['A', 'B', 'C', 'D']) {
      const btn = document.createElement('button');
      btn.classList.add('option-btn');
      btn.textContent = letter;
      btn.disabled = this._areOptionButtonsLocked();
      if (this.selectedOptions.has(letter)) {
        btn.classList.add('selected');
      }
      btn.addEventListener('click', () => this._toggleOption(letter));
      this.optionsBar.appendChild(btn);
    }
  }

  _toggleOption(letter) {
    if (this._areOptionButtonsLocked()) return;

    if (this.selectedOptions.has(letter)) {
      this.selectedOptions.delete(letter);
    } else {
      this.selectedOptions.add(letter);
    }
    this._renderOptionButtons();
    this._updatePromptFromOptions();
  }

  _updatePromptFromOptions() {
    const letters = ['A', 'B', 'C', 'D'].filter((l) =>
      this.selectedOptions.has(l)
    );
    if (letters.length === 0) return;
    const text =
      letters.length === 1
        ? `选项${letters[0]}`
        : `选项${letters.join('和')}`;
    this.promptInput.value = text;
  }

  _updateActionButtons() {
    const phase = this.session.phase;
    document.getElementById('btn-save-world').style.display =
      phase === 'WORLD_SETTING' ? 'inline-block' : 'none';
    document.getElementById('btn-enter-character').style.display =
      phase === 'WORLD_SETTING' && this.session.worldSettings
        ? 'inline-block'
        : 'none';
    document.getElementById('btn-save-character').style.display =
      phase === 'CHARACTER_SETTING' ? 'inline-block' : 'none';

    const openBtn = document.getElementById('btn-open-story');
    const canOpen =
      phase === 'CHARACTER_SETTING' && this.session.protagonist;
    openBtn.style.display = canOpen ? 'inline-block' : 'none';
    openBtn.disabled = this.session.openingDone;
  }

  // ── God's Eye ──
  _toggleGodseye() {
    this._godseyeOpen = !this._godseyeOpen;
    if (this._godseyeOpen) {
      this.godseyePanel.style.display = 'flex';
    } else {
      this.godseyePanel.style.display = 'none';
    }
  }

  _closeGodseye() {
    this._godseyeOpen = false;
    this.godseyePanel.style.display = 'none';
  }

  _appendDebugPanel(data) {
    const isPrompt = data.type === 'debug_prompt';
    const container = document.createElement('div');
    container.style.cssText =
      'margin-bottom:10px;border:1px solid #2a2f40;border-radius:6px;overflow:hidden;';

    const header = document.createElement('div');
    const flowLabel = data.flowType || '?';
    const attemptLabel = data.attempt > 1 ? ` 重试#${data.attempt}` : '';
    header.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:600;';
    header.style.background = isPrompt ? '#1a2818' : '#2a1c1c';
    header.style.color = isPrompt ? '#7ab87a' : '#c97a7a';
    header.textContent = isPrompt
      ? `↑ REQUEST [${flowLabel}]${attemptLabel}`
      : `↓ RESPONSE [${flowLabel}]${attemptLabel}`;
    container.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText =
      'padding:8px 10px;max-height:320px;overflow-y:auto;white-space:pre-wrap;word-break:break-all;';
    body.textContent = isPrompt
      ? `【SYSTEM】\n${data.systemInstruction}\n\n【USER】\n${data.userContent}`
      : data.content;
    container.appendChild(body);

    this.godseyeContent.appendChild(container);
    this.godseyeContent.scrollTop = this.godseyeContent.scrollHeight;
  }
}
