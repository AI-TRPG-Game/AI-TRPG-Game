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
    this.scenarioStatus = document.getElementById('scenario-status');
    this.worldPanel = document.getElementById('world-info');
    this.playerInfo = document.getElementById('player-info');
    this.playerPanel = document.getElementById('player-settings');
    this.playerEditArea = document.getElementById('player-edit-area');
    this.locationsPanel = document.getElementById('locations-panel');
    this.npcsPanel = document.getElementById('npcs-panel');
    this.characterStatusPanel = document.getElementById('character-status');
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
    this.tutorialSessionButton = document.getElementById('btn-tutorial-session');
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
    this.tutorialSessionButton.addEventListener('click', () => this._createBirchStationTutorial());

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

  async _createBirchStationTutorial() {
    try {
      const { session } = await apiClient.createBirchStationTutorial();
      await this._loadSession(session);
    } catch (err) {
      this._appendMessage(`无法开始新手试炼: ${err.message}`, 'error');
    }
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
    const previousClock = this.session?.scenarioClock
      ? { currentTime: this.session.scenarioClock.currentTime, turn: this.session.scenarioClock.turn }
      : null;
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

    // 剧本时钟由后端在每个已结算回合附带；不能只依赖 displayLog，
    // 否则实时游玩时会等到刷新/恢复会话后才看到计时结果。
    if (Array.isArray(result?.scenarioMessages)) {
      for (const [index, message] of result.scenarioMessages.entries()) {
        this._appendMessage(message, index === 0 ? 'turn-summary' : 'system');
      }
    } else if (
      this.session?.scenarioClock &&
      previousClock &&
      (previousClock.currentTime !== this.session.scenarioClock.currentTime ||
        previousClock.turn !== this.session.scenarioClock.turn)
    ) {
      // 兼容未携带 scenarioMessages 的旧后端响应：只要时钟已经推进，
      // 就不能让玩家错过这一回合的时间流逝。
      const clock = this.session.scenarioClock;
      this._appendMessage(
        `【第${clock.turn}回合 · 游戏内时间推进：${previousClock.currentTime} → ${clock.currentTime} · 截止 ${clock.deadline}】`,
        'turn-summary'
      );
    }

    // 3. debug 日志已通过 onDebug 回调实时渲染到 god's eye 面板，这里不再处理 result.debugLogs

    // 4. actions 确认弹窗（原 dice 确认，现在基于 actions 数组）
    //    后端返回 result.branch === 'DICE_AWAITING' 和 result.actions
    //    _renderDiceConfirm 不依赖具体内容，仅展示"确定/取消"按钮
    if (result?.branch === 'DICE_AWAITING') {
      this._renderDiceConfirm(result.actions);
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

  /**
   * 按 P/S/O 集合分类 actions。
   * P = skill_check(trigger=player) 的数量
   * S = sancheck 的数量（trigger 恒为 others）
   * O = others skill_check + 所有 direct（含 direct(trigger=player)）的数量
   * @param {Array} actions
   * @returns {{P: number, S: number, O: number, playerSkillChecks: Array, sancchecks: Array}}
   */
  _classifyActions(actions) {
    const playerSkillChecks = [];
    const sancchecks = [];
    let O = 0;

    for (const a of actions || []) {
      const type = a.type || a.action_type;
      const trigger = a.trigger || 'others';
      if (type === 'skill_check' && trigger === 'player') {
        playerSkillChecks.push(a);
      } else if (type === 'sancheck') {
        sancchecks.push(a);
      } else {
        O++;
      }
    }

    return {
      P: playerSkillChecks.length,
      S: sancchecks.length,
      O,
      playerSkillChecks,
      sancchecks,
    };
  }

  /**
   * 根据 actions 数组分类渲染 A/B 弹窗。
   * - P ≥ 1：A 弹窗（列出 player skill_check 详情 + 取消/确定）
   * - P = 0 且 S+O ≥ 1：B 弹窗（B1/B2/B3 子情况 + 仅确定）
   * @param {Array} actions - pendingDiceFlow.actions（可选，缺省从 session 取）
   */
  _renderDiceConfirm(actions) {
    this._removeDiceConfirm();

    const acts = actions || (this.session?.pendingDiceFlow?.actions) || [];
    const { P, S, O, playerSkillChecks, sancchecks } = this._classifyActions(acts);

    this._diceConfirmEl = document.createElement('div');
    this._diceConfirmEl.classList.add('message', 'system');
    this._diceConfirmEl.id = 'dice-confirm-msg';

    let innerHtml = '';
    let showCancel = false;

    if (P >= 1) {
      // === A 弹窗 ===
      showCancel = true;
      innerHtml += '<div class="dice-confirm-title">即将进行以下判定：</div>';
      for (const sc of playerSkillChecks) {
        const bonus = sc.bonus_dice > 0 ? `，奖励骰：${sc.bonus_dice}` : '';
        const penalty = sc.penalty_dice > 0 ? `，惩罚骰：${sc.penalty_dice}` : '';
        innerHtml += `<div class="dice-confirm-item">是否使用 ${escapeHtml(sc.skill_name)} 技能（技能点${sc.skill_point}${bonus}${penalty}）？</div>`;
      }
      if (S + O > 0) {
        innerHtml += '<div class="dice-confirm-hint">（可能会触发其余判定）</div>';
      }
    } else {
      // === B 弹窗 ===
      if (S >= 1 && O === 0) {
        // B1：纯 sancheck
        const targets = sancchecks.map(s => s.target === 'player' ? '你' : s.target).join('、');
        innerHtml += `<div class="dice-confirm-title">${targets} 直视了不可直视之物，需要进行 SAN 检定</div>`;
      } else if (S === 0 && O >= 1) {
        // B2：纯 others 非 sancheck
        innerHtml += `<div class="dice-confirm-title">将进行 ${O} 次投掷判定</div>`;
      } else if (S >= 1 && O >= 1) {
        // B3：sancheck + others 混合
        innerHtml += `<div class="dice-confirm-title">将进行 ${S + O} 次投掷判定（包括 sancheck）</div>`;
      }
    }

    innerHtml += '<div class="dice-confirm-btns">';
    if (showCancel) {
      innerHtml += '<button id="btn-dice-cancel" class="dice-btn dice-btn-cancel">取消并回退</button>';
    }
    innerHtml += '<button id="btn-dice-confirm" class="dice-btn dice-btn-confirm">确定</button>';
    innerHtml += '</div>';

    this._diceConfirmEl.innerHTML = innerHtml;
    this.messagesEl.appendChild(this._diceConfirmEl);
    this._scrollToBottom();

    document.getElementById('btn-dice-confirm').addEventListener('click', () =>
      this._confirmDice()
    );
    const cancelBtn = document.getElementById('btn-dice-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this._cancelDice());
    }
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
          this._appendMessage(msg, 'judge');
          this._showWaiting();
        },
      });

      // === 检查是否需要 B 二次弹窗 ===
      if (resp.result?.branch === 'B_SANCHECK_AWAITING') {
        this.session = resp.session;
        this._clearWaiting();
        this._setInputLocked(false);
        // 渲染 B1 弹窗（只含 sancheck 部分）
        const sancheckActions = (resp.result.actions || this.session.pendingDiceFlow?.actions || [])
          .filter(a => (a.type || a.action_type) === 'sancheck');
        this._renderDiceConfirm(sancheckActions);
        return;
      }

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
      const dialogStage = this.session.pendingDiceFlow.dialogStage;
      const actions = this.session.pendingDiceFlow.actions;
      if (dialogStage === 'B_SANCHECK_CONFIRM') {
        // A 已确认，等待 B 二次确认：渲染 B1 样式（只含 sancheck 部分）
        const sancheckActions = (actions || []).filter(a => (a.type || a.action_type) === 'sancheck');
        this._renderDiceConfirm(sancheckActions);
      } else {
        // A_CONFIRM 阶段：渲染完整 A/B 弹窗
        this._renderDiceConfirm(actions);
      }
    }
  }

  _updateUI() {
    if (!this.session) return;

    this.phaseLabel.textContent = `阶段: ${this.session.phase} | 状态: ${this.session.subState}`;
    if (this.session.scenarioClock) {
      const clock = this.session.scenarioClock;
      const secured = (this.session.evidence || []).filter(e => e.secured).length;
      this.scenarioStatus.textContent = `⏱ ${clock.currentTime} / ${clock.deadline} · ${clock.phase} · 证据 ${secured}/${(this.session.evidence || []).length} · 怀疑 ${this.session.suspicion ?? 0}/10`;
      this.scenarioStatus.title = '新手试炼的游戏内时间、阶段、证据和怀疑度';
    } else {
      // 普通自由剧本没有剧本时钟；明确告知入口，避免把空白状态误认为显示故障。
      this.scenarioStatus.textContent = '无剧本时钟 · 点击左上“试炼”开始';
      this.scenarioStatus.title = '只有“新手试炼：白桦站的末班车”使用游戏内倒计时';
    }

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
        (l, i) => {
          const isCurrent = l.id === this.session.playerLocationId;
          const marker = isCurrent ? '📍' : '📌';
          const currentLabel = isCurrent ? '<small style="opacity:0.75"> 你在此</small>' : '';
          return `<div class="sidebar-item-row">${marker} <span class="sidebar-clickable" data-detail="location" data-location-id="${escapeHtml(l.id ?? '')}" title="${escapeHtml(l.id ?? '')}">${escapeHtml(l.name)}${currentLabel}<small class="entity-id-badge">${escapeHtml(l.id ?? '')}</small></span><button class="sidebar-item-action sbb-edit" data-edit-location="${i}">✎</button></div>`;
        }
      )
      .join('') + '<button class="sidebar-add-btn" data-add="location">+ 新增地点</button>';

    // NPC —— 名称 + 编辑（按 id 引用）
    this.npcsPanel.innerHTML = (this.session.npcs || [])
      .map(
        (n, i) => {
          // 主角/邀请角色标签（基于 keyCharacters.length 动态判断 id 区段）
          // 后端 IdAllocator: npc_000=玩家, npc_001~00X=关键角色(X=keyCharacters.length), npc_00(X+1)+=普通NPC
          // 硬编码 npc_001~003 会在"未邀请关键角色"时把第一个普通NPC误标为"已邀请"
          const keyCharCount = this.session.keyCharacters?.length || 0;
          const npcNumMatch = (n.id || '').match(/^npc_(\d{3})$/);
          const npcNum = npcNumMatch ? parseInt(npcNumMatch[1], 10) : -1;
          const tag = n.id === 'npc_000' ? '（主角）'
            : (npcNum >= 1 && npcNum <= keyCharCount) ? '（已邀请）'
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

    // 角色 HP/SAN 状态栏
    this._renderCharacterStatus();

    // 结局/重启状态检测
    this._handleEndingStates();

    this._syncInputControls();
    this._renderOptionButtons();
    this._updateActionButtons();
  }

  /**
   * 渲染角色 HP/SAN/属性 状态栏。
   * - departed：显示"已退场"
   * - hidden：HP/SAN/属性全部显示 ??（已隐藏）
   * - 正常：显示 HP/SAN，key 角色额外显示 8 大属性
   */
  _renderCharacterStatus() {
    if (!this.characterStatusPanel) return;
    const npcs = this.session?.npcs || [];
    if (npcs.length === 0) {
      this.characterStatusPanel.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">暂无角色</div>';
      return;
    }

    const html = npcs.map(npc => {
      const name = npc.name || npc.id;
      let label;
      if (npc.id === 'npc_000') {
        label = '玩家';
      } else if (npc.importance === 'key') {
        label = `关键角色 · ${name}`;
      } else if (npc.importance === 'player') {
        label = '玩家';
      } else {
        label = name;
      }

      // departed 的 NPC
      if (npc.status === 'departed') {
        return `<div class="char-status-item departed">
          <span class="char-name">${escapeHtml(label)}</span>
          <span class="char-hp-san">已退场</span>
        </div>`;
      }

      // hidden 的 NPC：HP/SAN/属性全部隐藏
      if (npc.visibility === 'hidden') {
        return `<div class="char-status-item hidden">
          <span class="char-name">${escapeHtml(label)}</span>
          <span class="char-hp-san">HP ??/?? | SAN ??/??（已隐藏）</span>
        </div>`;
      }

      // 正常显示
      const hpStr = npc.hp != null ? `${npc.hp}/${npc.maxHp ?? '?'}` : '?';
      const sanStr = npc.san != null ? `${npc.san}/${npc.maxSan ?? '?'}` : '?';
      let line = `HP ${escapeHtml(hpStr)} | SAN ${escapeHtml(sanStr)}`;
      if (npc.id === 'npc_000' && npc.san != null) {
        const sanState = npc.san >= 51 ? 'stable' : npc.san >= 46 ? 'uneasy' : npc.san >= 31 ? 'shaken' : npc.san >= 16 ? 'unstable' : npc.san > 0 ? 'critical' : 'madness';
        line += ` | ${sanState}`;
        const trauma = this.session?.sanity?.activeTrauma;
        if (trauma?.label) line += ` | 创伤：${trauma.label}`;
      }
      if (npc.attributes) {
        const attrStr = Object.entries(npc.attributes)
          .map(([k, v]) => `${k}${v}`)
          .join(' ');
        line += `<div class="char-attrs">${escapeHtml(attrStr)}</div>`;
      }
      return `<div class="char-status-item">
        <span class="char-name">${escapeHtml(label)}</span>
        <span class="char-hp-san">${line}</span>
      </div>`;
    }).join('');

    this.characterStatusPanel.innerHTML = html;
  }

  /**
   * 检测结局/重启状态并渲染对应 UI。
   * - RESTART_PENDING：显示"是否重新开始故事"按钮
   * - ENDING_PENDING：结局生成中，锁定输入
   */
  _handleEndingStates() {
    const subState = this.session?.subState;

    if (subState === 'RESTART_PENDING') {
      // 仅在尚未渲染重启面板时渲染（避免重复）
      if (!document.getElementById('restart-options')) {
        this._renderRestartOptions();
      }
    } else {
      // 非 RESTART_PENDING 时清理残留的重启面板
      const existing = document.getElementById('restart-options');
      if (existing) existing.remove();
    }
  }

  /**
   * 渲染重启选项 UI（结局触发后显示）。
   */
  _renderRestartOptions() {
    const el = document.createElement('div');
    el.id = 'restart-options';
    el.className = 'restart-options-panel';
    el.innerHTML = `
      <div class="restart-message">是否重新开始故事？</div>
      <div class="restart-hint">世界观、玩家与已邀请的关键角色设定会保留，其余设定将会删除</div>
      <div class="restart-btns">
        <button id="btn-restart-yes" class="restart-btn restart-btn-yes">是</button>
        <button id="btn-restart-later" class="restart-btn restart-btn-later">暂时搁置</button>
      </div>
    `;
    this.messagesEl.appendChild(el);
    this._scrollToBottom();

    document.getElementById('btn-restart-yes').addEventListener('click', () => this._restartStory());
    document.getElementById('btn-restart-later').addEventListener('click', () => this._postponeRestart());
  }

  /**
   * 用户点"是"重启故事。
   */
  async _restartStory() {
    const btnYes = document.getElementById('btn-restart-yes');
    const btnLater = document.getElementById('btn-restart-later');
    if (btnYes) btnYes.disabled = true;
    if (btnLater) btnLater.disabled = true;

    this._setInputLocked(true);
    this._showWaiting();

    try {
      const prevDisplayLen = this.session?.displayLog?.length || 0;
      const resp = await apiClient.restartStory(this.session);
      this.session = resp.session;
      // 移除重启面板
      const panel = document.getElementById('restart-options');
      if (panel) panel.remove();
      this._clearWaiting();
      this._setInputLocked(false);

      // 渲染重启后新增的 displayLog 条目（player 重启请求 + KP 新开幕）
      const newEntries = (this.session.displayLog || []).slice(prevDisplayLen);
      if (newEntries.length > 0) {
        this._appendMessage('故事已重新开启，继续冒险吧。', 'system');
        for (const entry of newEntries) {
          const type = entry.role === 'player' ? 'user' : entry.role === 'system' ? 'system' : 'bot';
          const el = this._appendMessage('', type);
          if (type === 'bot') {
            const content = entry.content || '';
            el.innerHTML = content.trim().startsWith('<div') ? content : renderBotContent(content);
          } else {
            el.textContent = entry.content;
          }
        }
      } else {
        this._appendMessage('故事已重新开启，继续冒险吧。', 'system');
      }

      this._updateUI();
      await this._persistSession();
    } catch (err) {
      this._appendMessage(`错误: ${err.message}`, 'error');
      this._clearWaiting();
      // 重新启用按钮让用户可以重试
      if (btnYes) btnYes.disabled = false;
      if (btnLater) btnLater.disabled = false;
    }
  }

  /**
   * 用户点"暂时搁置"。
   * 隐藏重启面板，允许用户继续浏览对话（但输入仍锁定，因为 RESTART_PENDING 状态未解除）。
   */
  _postponeRestart() {
    const panel = document.getElementById('restart-options');
    if (panel) {
      panel.remove();
    }
    this._appendMessage('已搁置重启。可随时刷新页面再次选择。', 'system');
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
        return `<label>名称 <input id="edit-name" type="text" maxlength="40" value="${escapeHtml(npc?.name || '')}"></label>
          <label>基础描述（75字以内） <textarea id="edit-desc" rows="4" maxlength="75">${escapeHtml(baseDesc)}</textarea></label>
          <label>当前状态（35字以内） <input id="edit-state" type="text" maxlength="35" value="${escapeHtml(npc?.currentState || '')}" placeholder="如：神情紧张、正在擦拭酒杯"></label>
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
      // 保存后后端自动邀请下一个角色（递增 keyCharacterIndex），无需手动点击
      inviteNextBtn.style.display = 'none';
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
