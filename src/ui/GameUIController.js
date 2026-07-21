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
      parts.push(escapeHtml(`【地点】${l.name}：${l.description ?? ''}`));
    }
  }

  if (Array.isArray(parsed.npcs) && parsed.npcs.length > 0) {
    for (const n of parsed.npcs) {
      // NPC 新结构：baseDescription + currentState；兜底旧 description
      const base = n.baseDescription ?? n.description ?? '';
      const state = n.currentState ?? '';
      const descText = state ? `${base}（${state}）` : base;
      parts.push(escapeHtml(`【NPC】${n.name}：${descText}`));
    }
  }

  if (Array.isArray(parsed.items) && parsed.items.length > 0) {
    for (const i of parsed.items) {
      parts.push(escapeHtml(`【物品】${i.name}：${i.status || '已获得'}，${i.description ?? ''}`));
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
    this._dicePendingBotEl = null;   // dice 确认阶段的 bot 气泡引用
    this._diceConfirmEl = null;

    this.messagesEl = document.getElementById('messages');
    this.promptInput = document.getElementById('prompt-input');
    this.sendButton = document.getElementById('send-button');
    this.optionsBar = document.getElementById('options-bar');
    this.phaseLabel = document.getElementById('phase-label');
    this.worldPanel = document.getElementById('world-info');
    this.playerInfo = document.getElementById('player-info');
    this.playerPanel = document.getElementById('player-settings');
    this.playerEditArea = document.getElementById('player-edit-area');
    this.locationsPanel = document.getElementById('locations-panel');
    this.npcsPanel = document.getElementById('npcs-panel');
    this.inventoryPanel = document.getElementById('inventory-panel');
    this.keyCharactersPanel = document.getElementById('key-characters-panel');
    this.autoGenKeyCharBtn = document.getElementById('btn-auto-gen-key-char');
    this.actionButtons = document.getElementById('action-buttons');
    this.npcModalBackdrop = document.getElementById('npc-modal-backdrop');
    this.npcModalTitle = document.getElementById('npc-modal-title');
    this.npcForm = document.getElementById('npc-form');
    this.npcNameInput = document.getElementById('npc-name-input');
    this.npcDescriptionInput = document.getElementById('npc-description-input');
    this.npcStateInput = document.getElementById('npc-state-input');
    this.editingNpcIndex = null;
    this.sessionSidebar = document.getElementById('session-sidebar');
    this.sessionToggleButton = document.getElementById('btn-session-toggle');
    this.newSessionButton = document.getElementById('btn-new-session');
    this.sessionListPanel = null;

    this.godseyePanel = document.getElementById('godseye-panel');
    this.godseyeContent = document.getElementById('godseye-content');
    this._godseyeOpen = false;

    // 详情面板
    this.detailPanel = document.getElementById('detail-panel');
    this.detailPanelTitle = document.getElementById('detail-panel-title');
    this.detailPanelContent = document.getElementById('detail-panel-content');
    this.detailPanelClose = document.getElementById('detail-panel-close');
    this.detailPanelHeader = document.getElementById('detail-panel-header');
    this._detailDrag = null;

    // 详情面板编辑状态
    this._editing = null;  // { type, index }

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
    document.getElementById('btn-enter-key-character').addEventListener('click', () =>
      this._enterKeyCharacter()
    );
    document.getElementById('btn-save-key-character').addEventListener('click', () =>
      this._saveKeyCharacter()
    );
    document.getElementById('btn-invite-next-key-char').addEventListener('click', () =>
      this._inviteNextKeyCharacter()
    );
    this.autoGenKeyCharBtn.addEventListener('click', () =>
      this._autoGenKeyChar()
    );

    document.getElementById('btn-godseye').addEventListener('click', () =>
      this._toggleGodseye()
    );
    document.getElementById('btn-godseye-close').addEventListener('click', () =>
      this._closeGodseye()
    );
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
      const button = event.target.closest('button[data-npc-index]');
      if (!button) return;
      this._openNpcModal(Number(button.dataset.npcIndex));
    });

    // 详情面板关闭
    this.detailPanelClose.addEventListener('click', () => this._closeDetailPanel());
    // 详情面板拖动
    this._initDetailPanelDrag();
    // 侧边栏点击委托（查看详情 / 编辑 / 删除 / 新增）
    document.getElementById('sidebar').addEventListener('click', (event) => {
      // 删除按钮
      const delBtn = event.target.closest('.sbb-delete');
      if (delBtn) { this._handleDelete(delBtn); return; }
      // 编辑按钮
      const editBtn = event.target.closest('.sbb-edit');
      if (editBtn) { this._openEditInDetail(editBtn); return; }
      // 新增按钮
      const addBtn = event.target.closest('.sidebar-add-btn');
      if (addBtn) { this._handleAdd(addBtn.dataset.add); return; }
      // 名称点击 → 查看详情
      const nameBtn = event.target.closest('.sidebar-clickable');
      if (!nameBtn || nameBtn.classList.contains('empty')) return;
      this._openDetailByEvent(nameBtn);
    });
    // 详情面板内保存/删除按钮
    this.detailPanel.addEventListener('click', (event) => {
      const saveBtn = event.target.closest('#detail-panel-save');
      if (saveBtn) { this._saveFromDetailPanel(); return; }
      const delBtn = event.target.closest('#detail-panel-delete');
      if (delBtn) { this._deleteFromDetailPanel(); }
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
    // 如果 IndexedDB 中不存在（新建会话场景），先存入再读取
    this.session = await sessionStore.getSession(session.id)
      || await sessionStore.saveSession(session);
    localStorage.setItem('ai-trpg-current-session-id', session.id);
    window.location.hash = this.sessionId;
    this.messagesEl.innerHTML = '';
    this.selectedOptions.clear();
    this._botEl = null;
    this._waitingEl = null;
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
      item.draggable = true;
      item.dataset.sessionId = session.id;
      if (session.id === this.sessionId) item.classList.add('active');

      // ── 拖拽事件 ──
      item.addEventListener('dragstart', (e) => {
        this._dragSessionId = session.id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', session.id);
        item.classList.add('dragging');
        requestAnimationFrame(() => { item.style.opacity = '0.4'; });
      });
      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        item.style.opacity = '';
        this._dragSessionId = null;
        this.sessionListPanel.querySelectorAll('.session-drag-over').forEach(el => el.classList.remove('session-drag-over'));
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      item.addEventListener('dragenter', (e) => {
        e.preventDefault();
        if (this._dragSessionId && this._dragSessionId !== session.id) {
          item.classList.add('session-drag-over');
        }
      });
      item.addEventListener('dragleave', () => {
        item.classList.remove('session-drag-over');
      });
      item.addEventListener('drop', async (e) => {
        e.preventDefault();
        item.classList.remove('session-drag-over');
        const fromId = this._dragSessionId;
        const toId = session.id;
        if (!fromId || fromId === toId) return;
        try {
          await sessionStore.swapSessionOrder(fromId, toId);
          await this._renderSessionList();
        } catch (err) {
          console.error('Swap session order failed:', err);
        }
      });

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
  // v2.1 SSE 改造：3 个 LLM 路由（/message /open-story /dice-confirm）改为 SSE 流式响应。
  // 后端在 LLM 调用过程中实时推送 event:debug 事件，前端通过 onDebug 回调立即渲染到 god's eye 面板。
  // 整个回合完成后推送 event:done，前端调用 _renderLlmResponse 渲染最终结果。
  // 因此 _renderLlmResponse 不再处理 result.debugLogs（已实时渲染），避免重复。

  /**
   * 统一渲染 LLM 调用结果（done 事件触发）。
   * @param {Object} resp - 后端返回 { session, result, systemMessages?, diceNotation? }
   * @param {Object} opts - { isDiceBranch: 是否 dice 分支（保留 dicePendingBotEl） }
   */
  _renderLlmResponse(resp, opts = {}) {
    const { result, systemMessages } = resp;
    this.session = resp.session;

    // 1. 渲染 system 消息（如 dice 系统提示、故事开幕提示等）
    if (Array.isArray(systemMessages)) {
      for (const sys of systemMessages) {
        this._appendMessage(sys, 'system');
      }
    }

    // 2. 渲染 bot 消息（refined HTML 一次性显示）
    if (result?.refinedHtml) {
      // 若有等待中的 dice bot 气泡，先保留引用再清空
      if (opts.isDiceBranch && this._botEl) {
        this._dicePendingBotEl = this._botEl;
      }
      this._botEl = this._appendMessage('', 'bot');
      this._botEl.innerHTML = result.refinedHtml;
      this._scrollToBottom();
    }

    // 3. debug 日志已通过 onDebug 回调实时渲染到 god's eye 面板，这里不再处理 result.debugLogs

    // 4. dice 确认弹窗
    if (result?.branch === 'DICE_AWAITING' || resp.diceNotation) {
      const diceNotation = resp.diceNotation || result?.diceNotation;
      if (diceNotation) {
        this._renderDiceConfirm(diceNotation);
      }
    }

    this._updateUI();
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
      const resp = await apiClient.confirmDice(this.session, {
        onDebug: (log) => this._appendDebugPanel(log),
        // 系统判定结果在 LLM 调用前就到达，立即渲染到对话界面
        // 此时 waiting 元素已显示，先清空再追加系统消息，最后重新显示 waiting
        // 保证顺序为：[系统判定结果] → [KP正在思考话术] → [LLM 回复]
        onSystemMessage: (msg) => {
          this._clearWaiting();
          this._appendMessage(msg, 'system');
          this._showWaiting();
        },
      });
      this._renderLlmResponse(resp, { isDiceBranch: true });
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
      const resp = await apiClient.sendMessage(this.session, text, {
        onDebug: (log) => this._appendDebugPanel(log),
      });
      this._renderLlmResponse(resp);
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

    // 如果有关键角色设定阶段，先弹出确认
    if (this.session.phase === 'KEY_CHARACTER_SETTING' ||
        (this.session.phase === 'CHARACTER_SETTING' && this.session.keyCharacters?.length > 0)) {
      const { count, message } = await apiClient.getStoryOpenConfirm(this.session);
      const confirmed = window.confirm(message);
      if (!confirmed) return;
    }

    this._setInputLocked(true);
    this._showWaiting();
    document.getElementById('btn-open-story').disabled = true;

    try {
      const resp = await apiClient.openStory(this.session, {
        onDebug: (log) => this._appendDebugPanel(log),
      });
      this._renderLlmResponse(resp);
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
      this._appendMessage(`保存玩家失败: ${err.message}`, 'error');
    }
  }

  // ── 关键角色 ──

  async _enterKeyCharacter() {
    try {
      const { session, guidance } = await apiClient.enterKeyCharacterSetting(
        this.session
      );
      this.session = session;
      this._appendMessage(guidance, 'system');
      this._updateUI();
      await this._persistSession();
    } catch (err) {
      this._appendMessage(`进入关键角色设定失败: ${err.message}`, 'error');
    }
  }

  async _saveKeyCharacter() {
    try {
      const { session, message, nextGuidance } =
        await apiClient.saveKeyCharacter(this.session);
      this.session = session;
      this._appendMessage(message, 'system');
      if (nextGuidance) {
        this._appendMessage(nextGuidance, 'system');
      }
      this._updateUI();
      await this._persistSession();
    } catch (err) {
      this._appendMessage(`保存关键角色失败: ${err.message}`, 'error');
    }
  }

  async _inviteNextKeyCharacter() {
    try {
      const { session, guidance } = await apiClient.inviteNextKeyCharacter(
        this.session
      );
      this.session = session;
      this._appendMessage(guidance, 'system');
      this._updateUI();
      await this._persistSession();
    } catch (err) {
      this._appendMessage(`邀请下一位角色失败: ${err.message}`, 'error');
    }
  }

  async _autoGenKeyChar() {
    if (this._isInputBlocked()) return;
    this._appendMessage('根据世界观生成一个合理角色', 'user');
    this.promptInput.value = '';

    this._setInputLocked(true);
    this._showWaiting();

    try {
      const resp = await apiClient.sendMessage(
        this.session,
        '根据世界观生成一个合理角色',
        { onDebug: (log) => this._appendDebugPanel(log) }
      );
      this._renderLlmResponse(resp);
      await this._persistSession();
    } catch (err) {
      this._appendMessage(`AI生成角色失败: ${err.message}`, 'error');
    } finally {
      this._clearWaiting();
      this._setInputLocked(false);
    }
  }

  _openNpcModal(index = null) {
    this.editingNpcIndex = index;
    const npc = Number.isInteger(index) ? this.session?.npcs?.[index] : null;

    this.npcModalTitle.textContent = npc ? '编辑 NPC' : '添加 NPC';
    this.npcNameInput.value = npc?.name || '';
    // NPC 新结构：baseDescription（兼容旧 description 字段）
    this.npcDescriptionInput.value = npc?.baseDescription ?? npc?.description ?? '';
    this.npcStateInput.value = npc?.currentState ?? '';
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
    const state = this.npcStateInput.value.trim();

    if (!name || !description) {
      this._appendMessage('NPC 名称和基础描述都不能为空。', 'error');
      return;
    }

    // 走后端 API：保证 id 分配 / lastUpdatedAt 等字段一致
    try {
      const result = await apiClient.upsertNpc(
        this.session,
        Number.isInteger(this.editingNpcIndex) ? this.editingNpcIndex : -1,
        { name, baseDescription: description, currentState: state }
      );
      this.session = result.session;
    } catch (err) {
      this._appendMessage(`保存 NPC 失败: ${err.message}`, 'error');
      return;
    }

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
        // 新格式：refined HTML 由后端 TextRefiner 统一以 '<div class="kp-block">' 开头
        // 旧格式：raw JSON / XML（<narration>...</narration>）走 renderBotContent 解析
        const content = entry.content || '';
        if (content.trim().startsWith('<div')) {
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

    // 世界观 —— 紧凑模式
    if (this.session.worldSettings) {
      this.worldPanel.innerHTML = `<span class="sidebar-label">世界观</span> <span class="sidebar-value">已设定 ✓</span> <button class="sidebar-item-action sbb-edit" data-detail="world">✎</button>`;
      this.worldPanel.classList.remove('empty');
    } else {
      this.worldPanel.innerHTML = '尚未设定…';
      this.worldPanel.classList.add('empty');
    }

    // 玩家设定 —— 紧凑模式 + 编辑按钮
    const player = this.session.player || '';
    const playerName = this._extractName(player);
    if (player) {
      this.playerInfo.innerHTML = `<span class="sidebar-label">玩家</span> <span class="sidebar-value">${escapeHtml(playerName)}</span> <button class="sidebar-item-action sbb-edit" data-detail="player">✎</button>`;
      this.playerInfo.classList.remove('empty');
    } else {
      this.playerInfo.innerHTML = '尚未设定…';
      this.playerInfo.classList.add('empty');
      this.playerEditArea.style.display = 'none';
    }

    // 地点 —— 名称 + 编辑（按 id 引用，name 编辑后仍可定位）
    this.locationsPanel.innerHTML = (this.session.locations || [])
      .map(
        (l, i) =>
          `<div class="sidebar-item-row">📍 <span class="sidebar-clickable" data-detail="location" data-location-id="${escapeHtml(l.id ?? '')}" title="${escapeHtml(l.id ?? '')}">${escapeHtml(l.name)}<small class="entity-id-badge">${escapeHtml(l.id ?? '')}</small></span><button class="sidebar-item-action sbb-edit" data-edit-location="${i}">✎</button></div>`
      )
      .join('') + '<button class="sidebar-add-btn" data-add="location">+ 新增地点</button>';

    // NPC —— 名称 + 编辑（按 id 引用）
    this.npcsPanel.innerHTML = (this.session.npcs || [])
      .map(
        (n, i) => {
          // 主角/邀请角色标签（基于 id 区段判断）
          const tag = n.id === 'npc_000' ? '（主角）'
            : /^npc_00[1-3]$/.test(n.id || '') ? '（已邀请）'
            : '';
          return `<div class="sidebar-item-row">👤 <span class="sidebar-clickable" data-detail="npc" data-npc-id="${escapeHtml(n.id ?? '')}" title="${escapeHtml(n.id ?? '')}">${escapeHtml(n.name)}${tag ? `<small style="opacity:0.6"> ${tag}</small>` : ''}<small class="entity-id-badge">${escapeHtml(n.id ?? '')}</small></span><button class="sidebar-item-action sbb-edit" data-edit-npc="${i}">✎</button></div>`;
        }
      )
      .join('') + '<button class="sidebar-add-btn" data-add="npc">+ 新增 NPC</button>';

    // 物品 —— 名称 + 编辑（按 id 引用）
    this.inventoryPanel.innerHTML = (this.session.inventory || [])
      .map(
        (i, idx) =>
          `<div class="sidebar-item-row">📦 <span class="sidebar-clickable" data-detail="inventory" data-item-id="${escapeHtml(i.id ?? '')}" title="${escapeHtml(i.id ?? '')}">${escapeHtml(i.name)}<small class="entity-id-badge">${escapeHtml(i.id ?? '')}</small></span><button class="sidebar-item-action sbb-edit" data-edit-item="${idx}">✎</button></div>`
      )
      .join('') + '<button class="sidebar-add-btn" data-add="item">+ 新增物品</button>';

    // 关键角色 —— 名称 + 编辑
    const keyChars = this.session.keyCharacters || [];
    this.keyCharactersPanel.innerHTML = keyChars.length > 0
      ? keyChars
          .map(
            (c, idx) => {
              const name = this._extractName(c) || `角色${idx + 1}`;
              return `<div class="sidebar-item-row">👥 <span class="sidebar-clickable" data-detail="keycharacter" data-keychar-index="${idx}">${escapeHtml(name)}</span><button class="sidebar-item-action sbb-edit" data-edit-keychar="${idx}">✎</button></div>`;
            }
          )
          .join('')
      : '<div class="sidebar-clickable empty" style="font-size:12px;">暂无已邀请的关键角色</div>';

    this._syncInputControls();
    this._renderOptionButtons();
    this._updateActionButtons();
  }

  /** 从角色卡文本中提取姓名 */
  _extractName(characterText) {
    if (!characterText) return '';
    const m = characterText.match(/姓名[：:]\s*(.+)/);
    return m ? m[1].trim() : '';
  }

  /** 将角色卡/世界观纯文本渲染为 HTML（复用聊天区的 kp-block 风格） */
  _renderDetailHtml(plainText) {
    if (!plainText) return '暂无内容';
    return `<div class="kp-block">${escapeHtml(plainText).replace(/\n/g, '<br>')}</div>`;
  }

  // ── 详情面板 ──
  /** 打开浮动详情面板 */
  _openDetailPanel(type) {
    let title = '';
    let content = '';

    switch (type) {
      case 'world':
        title = '世界观与背景';
        content = this._renderDetailHtml(this.session.worldSettings);
        break;
      case 'player':
        title = '玩家设定';
        content = this._renderDetailHtml(this.session.player);
        break;
      case 'keycharacter': {
        // 通过 data-keychar-index 获取（由事件触发时不可用此分支，需通过事件对象）
        // 这里仅处理通过 data-detail="keycharacter" 直接调用的情况
        break;
      }
      default:
        break;
    }

    this.detailPanelTitle.textContent = title;
    this.detailPanelContent.innerHTML = content;
    this.detailPanel.style.display = 'flex';
  }

  /** 通过事件对象打开详情（支持地点/NPC/物品/关键角色等带索引的类型） */
  _openDetailByEvent(el) {
    const type = el.dataset.detail;
    if (!type) return;

    let title = '';
    let content = '';

    switch (type) {
      case 'location': {
        const id = el.dataset.locationId;
        const loc = (this.session.locations || []).find(l => l.id === id);
        if (!loc) return;
        title = `地点：${escapeHtml(loc.name)}`;
        content = this._renderDetailHtml(loc.description ?? '');
        break;
      }
      case 'npc': {
        const id = el.dataset.npcId;
        const npc = (this.session.npcs || []).find(n => n.id === id);
        if (!npc) return;
        title = `NPC：${escapeHtml(npc.name)}`;
        // NPC 新结构：baseDescription + currentState（兼容旧 description）
        {
          const base = npc.baseDescription ?? npc.description ?? '';
          const state = npc.currentState ?? '';
          const body = state ? `${base}\n\n【当前状态】${state}` : base;
          content = this._renderDetailHtml(body);
        }
        break;
      }
      case 'inventory': {
        const id = el.dataset.itemId;
        const item = (this.session.inventory || []).find(i => i.id === id);
        if (!item) return;
        title = `物品：${escapeHtml(item.name)}`;
        content = this._renderDetailHtml(
          `状态：${item.status || '未知'}\n\n${item.description || ''}`
        );
        break;
      }
      case 'keycharacter': {
        const idx = Number(el.dataset.keycharIndex);
        const kc = (this.session.keyCharacters || [])[idx];
        if (!kc) return;
        const kcName = this._extractName(kc) || `角色${idx + 1}`;
        title = `关键角色：${escapeHtml(kcName)}`;
        content = this._renderDetailHtml(kc);
        break;
      }
      case 'world':
        title = '世界观与背景';
        content = this._renderDetailHtml(this.session.worldSettings);
        break;
      case 'player':
        title = '玩家设定';   
        content = this._renderDetailHtml(this.session.player);
        break;
      default:
        return;
    }

    this.detailPanelTitle.textContent = title;
    this.detailPanelContent.innerHTML = content;
    this.detailPanel.style.display = 'flex';
  }

  // ── 侧边栏增删改 ──

  async _handleDelete(btn) {
    // 优先匹配精确定义的属性
    const idx = (s) => btn.dataset[s] !== undefined ? Number(btn.dataset[s]) : null;
    let type, index;

    index = idx('deleteLocation');
    if (index !== null) { type = 'location'; }

    if (type === undefined) {
      index = idx('deleteNpc');
      if (index !== null) { type = 'npc'; }
    }

    if (type === undefined) {
      index = idx('deleteItem');
      if (index !== null) { type = 'item'; }
    }

    if (type === undefined) {
      index = idx('deleteKeychar');
      if (index !== null) { type = 'keycharacter'; }
    }

    if (!type) return;

    if (!confirm('确定要删除该项吗？')) return;

    try {
      let result;
      switch (type) {
        case 'location': result = await apiClient.deleteLocation(this.session, index); break;
        case 'npc': result = await apiClient.deleteNpc(this.session, index); break;
        case 'item': result = await apiClient.deleteItem(this.session, index); break;
        case 'keycharacter': result = await apiClient.deleteKeyCharacter(this.session, index); break;
      }
      if (result) {
        this.session = result.session;
        this._closeDetailPanel();
        this._updateUI();
        await this._persistSession();
      }
    } catch (err) {
      this._appendMessage(`删除失败: ${err.message}`, 'error');
    }
  }

  _openEditInDetail(btn) {
    let type, index;

    if (btn.dataset.editLocation !== undefined) { type = 'location'; index = Number(btn.dataset.editLocation); }
    else if (btn.dataset.editNpc !== undefined) { type = 'npc'; index = Number(btn.dataset.editNpc); }
    else if (btn.dataset.editItem !== undefined) { type = 'item'; index = Number(btn.dataset.editItem); }
    else if (btn.dataset.editKeychar !== undefined) { type = 'keycharacter'; index = Number(btn.dataset.editKeychar); }
    else if (btn.dataset.detail) { type = btn.dataset.detail; index = -1; }

    if (!type) return;

    this._editing = { type, index };
    this.detailPanelTitle.textContent = this._getEditTitle(type, index);
    this.detailPanelContent.innerHTML = this._buildEditForm(type, index);
    this.detailPanel.style.display = 'flex';
  }

  _getEditTitle(type, index) {
    const isNew = (index === -1);
    const labels = {
      location: isNew ? '新增地点' : '编辑地点',
      npc: isNew ? '新增 NPC' : '编辑 NPC',
      item: isNew ? '新增物品' : '编辑物品',
      keycharacter: isNew ? '新增关键角色' : '编辑关键角色',
      world: '编辑世界观',
      player: '编辑玩家设定',   
    };
    return labels[type] || '编辑';
  }

  _buildEditForm(type, index) {
    const isNew = (index === -1);

    switch (type) {
      case 'location': {
        const loc = !isNew ? (this.session.locations || [])[index] : { name: '', description: '' };
        return `<label>名称 <input id="edit-name" type="text" value="${escapeHtml(loc?.name || '')}"></label>
          <label>描述 <textarea id="edit-desc" rows="4">${escapeHtml(loc?.description || '')}</textarea></label>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <button id="detail-panel-save" type="button">保存</button>
            ${isNew ? '' : '<button id="detail-panel-delete" class="sbb-delete" type="button" style="margin-top:0;">删除</button>'}
          </div>`;
      }
      case 'npc': {
        // NPC 新结构：name + baseDescription + currentState（兼容旧 description 字段读取）
        const npc = !isNew ? (this.session.npcs || [])[index] : { name: '', baseDescription: '', currentState: '' };
        const baseDesc = npc?.baseDescription ?? npc?.description ?? '';
        return `<label>名称 <input id="edit-name" type="text" value="${escapeHtml(npc?.name || '')}"></label>
          <label>基础描述 <textarea id="edit-desc" rows="4">${escapeHtml(baseDesc)}</textarea></label>
          <label>当前状态 <input id="edit-state" type="text" value="${escapeHtml(npc?.currentState || '')}" placeholder="如：神情紧张、正在擦拭酒杯"></label>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <button id="detail-panel-save" type="button">保存</button>
            ${isNew ? '' : '<button id="detail-panel-delete" class="sbb-delete" type="button" style="margin-top:0;">删除</button>'}
          </div>`;
      }
      case 'item': {
        const item = !isNew ? (this.session.inventory || [])[index] : { name: '', status: '已获得', description: '' };
        return `<label>名称 <input id="edit-name" type="text" value="${escapeHtml(item?.name || '')}"></label>
          <label>状态 <input id="edit-status" type="text" value="${escapeHtml(item?.status || '已获得')}"></label>
          <label>描述 <textarea id="edit-desc" rows="4">${escapeHtml(item?.description || '')}</textarea></label>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <button id="detail-panel-save" type="button">保存</button>
            ${isNew ? '' : '<button id="detail-panel-delete" class="sbb-delete" type="button" style="margin-top:0;">删除</button>'}
          </div>`;
      }
      case 'keycharacter': {
        const kc = !isNew ? (this.session.keyCharacters || [])[index] : '';
        return `<label>角色卡文本 <textarea id="edit-desc" rows="12">${escapeHtml(kc || '')}</textarea></label>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <button id="detail-panel-save" type="button">保存</button>
            ${isNew ? '' : '<button id="detail-panel-delete" class="sbb-delete" type="button" style="margin-top:0;">删除</button>'}
          </div>`;
      }
      case 'world': {
        return `<label>世界观描述 <textarea id="edit-desc" rows="8">${escapeHtml(this.session.worldSettings || '')}</textarea></label>
          <button id="detail-panel-save" type="button">保存</button>`;
      }
      case 'player': {
        return `<label>玩家设定 <textarea id="edit-desc" rows="12">${escapeHtml(this.session.player || '')}</textarea></label>
          <button id="detail-panel-save" type="button">保存</button>`;
      }
      default:
        return '';
    }
  }

  async _saveFromDetailPanel() {
    if (!this._editing) return;
    const { type, index } = this._editing;

    try {
      let result;
      switch (type) {
        case 'world': {
          const text = document.getElementById('edit-desc')?.value ?? '';
          result = await apiClient.updateWorldSettings(this.session, text);
          break;
        }
        case 'player': {
          const text = document.getElementById('edit-desc')?.value ?? '';
          result = await apiClient.updatePlayer(this.session, text);
          break;
        }
        case 'location': {
          const name = document.getElementById('edit-name')?.value ?? '';
          const desc = document.getElementById('edit-desc')?.value ?? '';
          result = await apiClient.upsertLocation(this.session, index, { name, description: desc });
          break;
        }
        case 'npc': {
          const name = document.getElementById('edit-name')?.value ?? '';
          const baseDescription = document.getElementById('edit-desc')?.value ?? '';
          const currentState = document.getElementById('edit-state')?.value ?? '';
          result = await apiClient.upsertNpc(this.session, index, { name, baseDescription, currentState });
          break;
        }
        case 'item': {
          const name = document.getElementById('edit-name')?.value ?? '';
          const status = document.getElementById('edit-status')?.value ?? '已获得';
          const desc = document.getElementById('edit-desc')?.value ?? '';
          result = await apiClient.upsertItem(this.session, index, { name, status, description: desc });
          break;
        }
        case 'keycharacter': {
          const text = document.getElementById('edit-desc')?.value ?? '';
          result = await apiClient.upsertKeyCharacter(this.session, index, text);
          break;
        }
      }

      if (result) {
        this.session = result.session;
        this._editing = null;
        this._closeDetailPanel();
        this._updateUI();
        await this._persistSession();
      }
    } catch (err) {
      this._appendMessage(`保存失败: ${err.message}`, 'error');
    }
  }

  _handleAdd(type) {
    this._editing = { type, index: -1 };
    this.detailPanelTitle.textContent = this._getEditTitle(type, -1);
    this.detailPanelContent.innerHTML = this._buildEditForm(type, -1);
    this.detailPanel.style.display = 'flex';
  }

  async _deleteFromDetailPanel() {
    if (!this._editing || this._editing.index === -1) return;
    const { type, index } = this._editing;
    if (!confirm('确定要删除该项吗？')) return;

    try {
      let result;
      switch (type) {
        case 'location': result = await apiClient.deleteLocation(this.session, index); break;
        case 'npc': result = await apiClient.deleteNpc(this.session, index); break;
        case 'item': result = await apiClient.deleteItem(this.session, index); break;
        case 'keycharacter': result = await apiClient.deleteKeyCharacter(this.session, index); break;
        default: return;
      }
      if (result) {
        this.session = result.session;
        this._editing = null;
        this._closeDetailPanel();
        this._updateUI();
        await this._persistSession();
      }
    } catch (err) {
      this._appendMessage(`删除失败: ${err.message}`, 'error');
    }
  }

  // ── 详情面板关闭（优化） ──
  _closeDetailPanel() {
    this.detailPanel.style.display = 'none';
    this.detailPanelTitle.textContent = '';
    this.detailPanelContent.innerHTML = '';
    this._editing = null;
  }

  // ── 详情面板拖动 ──
  _initDetailPanelDrag() {
    const panel = this.detailPanel;
    const header = this.detailPanelHeader;
    let startX, startY, initialLeft, initialTop;
    let dragging = false;

    header.addEventListener('mousedown', (e) => {
      if (e.target === this.detailPanelClose) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      panel.style.transition = 'none';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      panel.style.left = `${initialLeft + dx}px`;
      panel.style.top = `${initialTop + dy}px`;
      panel.style.right = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      document.body.style.userSelect = '';
    });
  }

  /** 侧边栏点击处理（委托）—— 该逻辑已合并到 _bindEvents 内联 */

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
    const keyChars = this.session.keyCharacters || [];
    const keyCharCount = keyChars.filter(Boolean).length;

    document.getElementById('btn-save-world').style.display =
      phase === 'WORLD_SETTING' ? 'inline-block' : 'none';
    document.getElementById('btn-enter-character').style.display =
      phase === 'WORLD_SETTING' && this.session.worldSettings
        ? 'inline-block'
        : 'none';
    document.getElementById('btn-save-character').style.display =
      phase === 'CHARACTER_SETTING' ? 'inline-block' : 'none';

    // 关键角色按钮
    const enterKeyCharBtn = document.getElementById('btn-enter-key-character');
    const saveKeyCharBtn = document.getElementById('btn-save-key-character');
    const inviteNextBtn = document.getElementById('btn-invite-next-key-char');
    const autoGenBtn = document.getElementById('btn-auto-gen-key-char');

    if (phase === 'CHARACTER_SETTING' && this.session.player) {  
      enterKeyCharBtn.style.display = 'inline-block';
      saveKeyCharBtn.style.display = 'none';
      inviteNextBtn.style.display = 'none';
      autoGenBtn.style.display = 'none';
    } else if (phase === 'KEY_CHARACTER_SETTING') {
      enterKeyCharBtn.style.display = 'none';
      saveKeyCharBtn.style.display = 'inline-block';
      inviteNextBtn.style.display =
        keyCharCount > 0 && keyCharCount < 3 ? 'inline-block' : 'none';
      autoGenBtn.style.display = 'inline-block';
    } else {
      enterKeyCharBtn.style.display = 'none';
      saveKeyCharBtn.style.display = 'none';
      inviteNextBtn.style.display = 'none';
      autoGenBtn.style.display = 'none';
    }

    const openBtn = document.getElementById('btn-open-story');
    const canOpen =
      (phase === 'CHARACTER_SETTING' && this.session.player) ||
      phase === 'KEY_CHARACTER_SETTING';
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
    const isRaw = data.type === 'debug_raw';
    const isSystem = data.type === 'system' || data.type === 'retry_clear' || data.type === 'parse_fail';
    const container = document.createElement('div');
    container.style.cssText =
      'margin-bottom:10px;border:1px solid #2a2f40;border-radius:6px;overflow:hidden;';

    const header = document.createElement('div');
    const flowLabel = data.flowType || '?';
    const attemptLabel = data.attempt > 1 ? ` 重试#${data.attempt}` : '';
    header.style.cssText = 'padding:4px 10px;font-size:11px;font-weight:600;';
    if (isPrompt) {
      header.style.background = '#1a2818';
      header.style.color = '#7ab87a';
      header.textContent = `↑ REQUEST [${flowLabel}]${attemptLabel}`;
    } else if (isRaw) {
      header.style.background = '#2a1c1c';
      header.style.color = '#c97a7a';
      header.textContent = `↓ RESPONSE [${flowLabel}]${attemptLabel}`;
    } else {
      // system / retry_clear / parse_fail
      header.style.background = '#3a2e1a';
      header.style.color = '#d8b75a';
      const tag = data.type === 'parse_fail' ? 'PARSE FAIL' : data.type === 'retry_clear' ? 'RETRY' : 'SYSTEM';
      header.textContent = `! ${tag} [${flowLabel}]${attemptLabel}`;
    }
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
