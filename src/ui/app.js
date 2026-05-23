import { runNarrative } from '../engine/narrativeEngine.js';
import { FlowType, Phase } from '../engine/flows.js';
import { parseNpcProposals } from '../engine/simpleOptions.js';
import {
  updateSession,
  listSessions,
  createSession,
  loadSession,
} from '../store/stateStore.js';

function nextNpcName(base, existingNames) {
  if (!base) base = '(未命名)';
  if (!existingNames.has(base)) return base;
  let i = 2;
  while (existingNames.has(`${base}#${i}`)) i += 1;
  return `${base}#${i}`;
}

function parsePcCard(text) {
  if (!text || typeof text !== 'string') return null;
  // Very lightweight schema: extract by labels if present; otherwise keep raw.
  const get = (label) => {
    const re = new RegExp(`${label}\\s*[:：]\\s*(.+)`, 'i');
    return re.exec(text)?.[1]?.trim() || '';
  };
  const card = {
    name: get('姓名') || '',
    age: get('年龄') || '',
    gender: get('性别') || '',
    race: get('种族') || '',
    personality: get('性格') || '',
    appearance: get('外貌') || '',
    background: get('家世与教育背景') || '',
    other: get('其余') || '',
    raw: text.trim(),
  };

  // Require at least name; otherwise treat as invalid.
  if (!card.name) return null;
  return card;
}

export function renderApp({ sessionId, session }) {
  const app = document.querySelector('#app');
  app.innerHTML = `
    <div style="display:grid;grid-template-columns:2fr 1fr;height:100vh;font-family:system-ui;">
      <div style="padding:12px;border-right:1px solid #eee;display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;gap:8px;align-items:center;">
          <select id="sessionSelect"></select>
          <button id="newSessionBtn">新建</button>

          <label style="margin-left:auto;display:flex;gap:6px;align-items:center;">
            <span>Meta</span>
            <input id="metaToggle" type="checkbox" />
          </label>
        </div>

        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <label style="display:flex;gap:6px;align-items:center;">
            <input type="radio" name="chatMode" value="simple" checked />
            <span>纯聊天（无记忆）</span>
          </label>
          <label style="display:flex;gap:6px;align-items:center;">
            <input type="radio" name="chatMode" value="game" />
            <span>游戏（结构化JSON，legacy）</span>
          </label>

          <label style="margin-left:auto;display:flex;gap:6px;align-items:center;">
            <input id="flowToggle" type="checkbox" checked />
            <span>启用叙事Flow</span>
          </label>
        </div>

        <!-- Doc-aligned buttons -->
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <button id="btnWorldSetup">开启故事设定（世界观）</button>
          <button id="btnPCSetup">开启设定主角</button>
          <button id="btnOpening">故事开幕</button>
          <button id="btnAcceptQuest">接收任务</button>
        </div>

        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span style="font-size:12px;color:#666;">Phase:</span>
          <select id="phaseSelect">
            <option value="${Phase.setup_world}">setup_world</option>
            <option value="${Phase.setup_pc}">setup_pc</option>
            <option value="${Phase.opening}">opening</option>
            <option value="${Phase.playing}">playing</option>
            <option value="${Phase.checking}">checking</option>
          </select>

          <span style="font-size:12px;color:#666;">FlowType:</span>
          <select id="flowTypeSelect">
            <option value="">(auto)</option>
            <option value="${FlowType.WORLD_GEN}">WORLD_GEN</option>
            <option value="${FlowType.PC_GEN}">PC_GEN</option>
            <option value="${FlowType.OPENING}">OPENING</option>
            <option value="${FlowType.CHECK_REQUEST}">CHECK_REQUEST</option>
            <option value="${FlowType.NORMAL_TURN}">NORMAL_TURN</option>
          </select>

          <label style="display:flex;gap:6px;align-items:center;">
            <input id="enforceOptionsToggle" type="checkbox" checked />
            <span>固定选项(A/B/C/D)</span>
          </label>
        </div>

        <div style="display:flex;gap:8px;">
          <select id="providerSelect">
            <option value="mock">Mock（默认）</option>
            <option value="deepseek">DeepSeek（BYOK测试）</option>
            <option value="openai">OpenAI（BYOK测试）</option>
          </select>
          <input id="apiKeyInput" placeholder="API Key（仅本地测试，不安全）" style="flex:1;" />
          <input id="modelInput" value="deepseek-v4-flash" style="width:180px;" />
        </div>

        <details>
          <summary>System Prompt（可选）</summary>
          <textarea id="systemPromptInput" rows="4" style="width:100%;box-sizing:border-box;" placeholder="例如：你是一个TRPG主持人(KP)，请用中文主持一个克苏鲁短剧本。"></textarea>
        </details>

        <div id="chat" style="flex:1;overflow:auto;border:1px solid #eee;padding:8px;border-radius:8px;background:#fafafa;"></div>

        <div id="options" style="display:flex;flex-wrap:wrap;gap:8px;"></div>

        <div id="pcDraft" style="display:none;border:1px solid #eee;background:#fff;border-radius:8px;padding:8px;"></div>

        <div id="npcProposals" style="display:none;border:1px solid #eee;background:#fff;border-radius:8px;padding:8px;"></div>

        <div style="display:flex;gap:8px;">
          <input id="textInput" style="flex:1;padding:10px;border-radius:8px;border:1px solid #ddd;" placeholder="输入你的行动或问题..." />
          <button id="sendBtn">发送</button>
        </div>
      </div>

      <div style="padding:12px;display:flex;flex-direction:column;gap:8px;">
        <h3 style="margin:0;">特殊数据库（WorldState）</h3>
        <div style="font-size:12px;color:#666;">（Meta 模式可编辑。点击保存写入存档。）</div>
        <div id="stateView" style="white-space:pre-wrap;background:#f6f6f6;border:1px solid #eee;border-radius:8px;padding:8px;flex:1;overflow:auto;" contenteditable="true"></div>
        <button id="saveStateBtn">保存右侧修改（Meta 模式）</button>
      </div>
    </div>
  `;

  const el = {
    chat: app.querySelector('#chat'),
    options: app.querySelector('#options'),
    pcDraft: app.querySelector('#pcDraft'),
    npcProposals: app.querySelector('#npcProposals'),
    textInput: app.querySelector('#textInput'),
    sendBtn: app.querySelector('#sendBtn'),
    metaToggle: app.querySelector('#metaToggle'),
    flowToggle: app.querySelector('#flowToggle'),
    phaseSelect: app.querySelector('#phaseSelect'),
    flowTypeSelect: app.querySelector('#flowTypeSelect'),
    enforceOptionsToggle: app.querySelector('#enforceOptionsToggle'),
    stateView: app.querySelector('#stateView'),
    saveStateBtn: app.querySelector('#saveStateBtn'),
    providerSelect: app.querySelector('#providerSelect'),
    apiKeyInput: app.querySelector('#apiKeyInput'),
    modelInput: app.querySelector('#modelInput'),
    sessionSelect: app.querySelector('#sessionSelect'),
    newSessionBtn: app.querySelector('#newSessionBtn'),
    systemPromptInput: app.querySelector('#systemPromptInput'),

    btnWorldSetup: app.querySelector('#btnWorldSetup'),
    btnPCSetup: app.querySelector('#btnPCSetup'),
    btnOpening: app.querySelector('#btnOpening'),
    btnAcceptQuest: app.querySelector('#btnAcceptQuest'),
  };

  const chatModeEls = Array.from(app.querySelectorAll('input[name="chatMode"]'));

  // UI-only state: pending proposals require explicit user save
  let pendingNpcs = [];
  let pendingPc = null;

  // persist settings
  el.apiKeyInput.value = localStorage.getItem('ai_trpg_api_key') || '';
  el.providerSelect.value = localStorage.getItem('ai_trpg_provider') || 'mock';
  el.modelInput.value = localStorage.getItem('ai_trpg_model') || 'deepseek-v4-flash';
  el.systemPromptInput.value = localStorage.getItem('ai_trpg_system_prompt') || '';
  el.flowToggle.checked = localStorage.getItem('ai_trpg_flow_enabled') !== 'false';
  el.enforceOptionsToggle.checked = localStorage.getItem('ai_trpg_enforce_options') !== 'false';

  // session phase/mode
  session.phase = session.phase || Phase.setup_world;
  el.phaseSelect.value = session.phase;

  function getChatMode() {
    const picked = chatModeEls.find((x) => x.checked);
    return picked?.value || 'simple';
  }

  function renderSessionList(currentId) {
    const sessions = listSessions();
    el.sessionSelect.innerHTML = sessions
      .map((s) => `<option value="${s.id}">${escapeHtml(s.title)}</option>`)
      .join('');
    el.sessionSelect.value = currentId;
  }

  function renderChat() {
    el.chat.innerHTML = session.messages
      .map((m) => {
        const bg = m.role === 'user' ? '#dff2ff' : '#fff';
        const modeTag = m.mode ? ` · ${escapeHtml(m.mode)}` : '';
        const phaseTag = m.phase ? ` · ${escapeHtml(m.phase)}` : '';
        return `<div style="margin:6px 0;padding:8px;border-radius:8px;background:${bg};border:1px solid #eee;">
        <div style="font-size:12px;color:#666;">${escapeHtml(m.role)}${modeTag}${phaseTag}</div>
        <div>${escapeHtml(m.content).replaceAll('\n', '<br/>')}</div>
      </div>`;
      })
      .join('');
    el.chat.scrollTop = el.chat.scrollHeight;
  }

  function renderState() {
    el.stateView.textContent = JSON.stringify(session.state, null, 2);
  }

  function insertIntoInput(text) {
    const cur = el.textInput.value || '';
    el.textInput.value = cur ? `${cur}\n${text}` : text;
    el.textInput.focus();
  }

  function renderOptions(opts) {
    el.options.innerHTML = '';
    for (const o of opts) {
      const btn = document.createElement('button');
      const label = typeof o === 'string' ? o : `${o.key}. ${o.text}`;
      btn.textContent = label;
      btn.onclick = () => {
        if (typeof o === 'string') insertIntoInput(o);
        else insertIntoInput(`${o.key}. ${o.text}`);
      };
      el.options.appendChild(btn);
    }
  }

  function renderPcDraft() {
    if (!pendingPc) {
      el.pcDraft.style.display = 'none';
      el.pcDraft.innerHTML = '';
      return;
    }

    el.pcDraft.style.display = 'block';
    el.pcDraft.innerHTML = `<div style="font-weight:600;margin-bottom:6px;">主角设定草稿（可一键存档）</div>`;

    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.margin = '0 0 8px 0';
    pre.textContent = pendingPc.raw;
    el.pcDraft.appendChild(pre);

    const btnSave = document.createElement('button');
    btnSave.textContent = '存档当前人物设定（覆盖主角）';
    btnSave.onclick = () => {
      session.state.pc = {
        name: pendingPc.name,
        age: pendingPc.age,
        gender: pendingPc.gender,
        race: pendingPc.race,
        personality: pendingPc.personality,
        appearance: pendingPc.appearance,
        background: pendingPc.background,
        other: pendingPc.other,
        raw: pendingPc.raw,
        at: new Date().toISOString(),
      };
      pendingPc = null;
      updateSession(sessionId, (s) => Object.assign(s, session));
      renderState();
      renderPcDraft();
      alert('已存档主角设定。');
    };

    const btnClear = document.createElement('button');
    btnClear.textContent = '清空草稿';
    btnClear.style.marginLeft = '8px';
    btnClear.onclick = () => {
      pendingPc = null;
      renderPcDraft();
    };

    el.pcDraft.appendChild(btnSave);
    el.pcDraft.appendChild(btnClear);
  }

  function renderNpcProposals() {
    if (!pendingNpcs.length) {
      el.npcProposals.style.display = 'none';
      el.npcProposals.innerHTML = '';
      return;
    }

    el.npcProposals.style.display = 'block';
    el.npcProposals.innerHTML = `<div style="font-weight:600;margin-bottom:6px;">待存档人物（需要你确认）</div>`;

    const existingNames = new Set((session.state.npcs || []).map((n) => n.name));

    pendingNpcs.forEach((npc, idx) => {
      const wrap = document.createElement('div');
      wrap.style.borderTop = '1px solid #eee';
      wrap.style.paddingTop = '6px';
      wrap.style.marginTop = '6px';

      const name = npc.name || '(未命名)';
      const relation = npc.relation || '';
      const desc = npc.description || '';

      wrap.innerHTML = `
        <div><b>${escapeHtml(name)}</b> ${relation ? `（${escapeHtml(relation)}）` : ''}</div>
        <div style="font-size:12px;color:#555;white-space:pre-wrap;">${escapeHtml(desc)}</div>
      `;

      const btn = document.createElement('button');
      btn.textContent = '角色存档';
      btn.onclick = () => {
        const finalName = nextNpcName(name, existingNames);
        existingNames.add(finalName);

        session.state.npcs = session.state.npcs || [];
        session.state.npcs.push({
          name: finalName,
          relation,
          description: desc,
          at: new Date().toISOString(),
        });

        // remove from pending
        pendingNpcs.splice(idx, 1);
        updateSession(sessionId, (s) => Object.assign(s, session));
        renderState();
        renderNpcProposals();
      };

      wrap.appendChild(btn);
      el.npcProposals.appendChild(wrap);
    });

    const clearBtn = document.createElement('button');
    clearBtn.textContent = '清空待存档';
    clearBtn.style.marginTop = '8px';
    clearBtn.onclick = () => {
      pendingNpcs = [];
      renderNpcProposals();
    };
    el.npcProposals.appendChild(clearBtn);
  }

  async function submit(text) {
    const mode = el.metaToggle.checked ? 'meta' : 'normal';
    const provider = el.providerSelect.value;
    const chatMode = getChatMode();
    const flowEnabled = el.flowToggle.checked;
    const phase = el.phaseSelect.value;
    const selectedFlowType = el.flowTypeSelect.value || null;

    session.messages.push({ role: 'user', content: text, mode, phase });
    updateSession(sessionId, (s) => Object.assign(s, session));
    renderChat();

    try {
      const apiKey = el.apiKeyInput.value.trim();
      const model = el.modelInput.value.trim();
      const systemPrompt = el.systemPromptInput.value;

      if (chatMode === 'game') {
        const result = await runNarrative({
          session,
          provider,
          apiKey,
          model,
          mode,
          phase,
          userText: text,
          systemPrompt,
          flowEnabled: false,
          selectedFlowType: null,
        });

        session.messages.push({ role: 'assistant', content: result.text, mode, phase });
        updateSession(sessionId, (s) => Object.assign(s, session));
        renderChat();
        renderState();
        renderOptions([]);
        return;
      }

      const enforceOptions = el.enforceOptionsToggle.checked;
      const result = await runNarrative({
        session,
        provider,
        apiKey,
        model,
        mode,
        phase,
        userText: text,
        systemPrompt,
        flowEnabled,
        selectedFlowType,
      });

      session.messages.push({
        role: 'assistant',
        content: result.text,
        mode,
        phase: result.next?.phase || phase,
      });

      // parse npc proposals from assistant text, but do NOT auto-save
      const proposals = parseNpcProposals(result.text);
      if (proposals.length) {
        pendingNpcs = proposals;
      }

      // PC schema: in setup_pc phase, allow 1-click save
      if ((result.next?.phase || phase) === Phase.setup_pc || phase === Phase.setup_pc) {
        const pc = parsePcCard(result.text);
        if (pc) pendingPc = pc;
      }

      session.phase = result.next?.phase || phase;
      el.phaseSelect.value = session.phase;

      updateSession(sessionId, (s) => Object.assign(s, session));
      renderChat();
      renderState();
      renderPcDraft();
      renderNpcProposals();
      renderOptions(enforceOptions ? result.options || [] : []);
    } catch (e) {
      session.messages.push({
        role: 'assistant',
        content: `【错误】${e.message}`,
        mode,
        phase,
      });
      updateSession(sessionId, (s) => Object.assign(s, session));
      renderChat();
    }
  }

  el.sendBtn.onclick = () => {
    const t = el.textInput.value.trim();
    if (!t) return;
    el.textInput.value = '';
    submit(t);
  };

  el.textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el.sendBtn.click();
  });

  el.btnWorldSetup.onclick = () => {
    el.metaToggle.checked = true;
    session.phase = Phase.setup_world;
    el.phaseSelect.value = session.phase;
    updateSession(sessionId, (s) => Object.assign(s, session));
    insertIntoInput('请根据关键词生成世界观与背景：');
  };

  el.btnPCSetup.onclick = () => {
    el.metaToggle.checked = true;
    session.phase = Phase.setup_pc;
    el.phaseSelect.value = session.phase;
    updateSession(sessionId, (s) => Object.assign(s, session));
    insertIntoInput('请按“姓名/年龄/性别/种族/性格/外貌/家世与教育背景/其余”生成主角设定：');
  };

  el.btnOpening.onclick = () => {
    el.metaToggle.checked = false;
    session.phase = Phase.opening;
    el.phaseSelect.value = session.phase;
    updateSession(sessionId, (s) => Object.assign(s, session));
    insertIntoInput('故事开幕。');
  };

  el.btnAcceptQuest.onclick = () => {
    el.metaToggle.checked = false;
    session.phase = Phase.playing;
    el.phaseSelect.value = session.phase;
    updateSession(sessionId, (s) => Object.assign(s, session));
    insertIntoInput('我接收任务，并准备采取行动。');
  };

  el.providerSelect.onchange = () => {
    localStorage.setItem('ai_trpg_provider', el.providerSelect.value);
    if (el.providerSelect.value === 'deepseek' && (!el.modelInput.value || el.modelInput.value.startsWith('gpt-'))) {
      el.modelInput.value = 'deepseek-v4-flash';
    }
    if (el.providerSelect.value === 'openai' && (!el.modelInput.value || el.modelInput.value.startsWith('deepseek-'))) {
      el.modelInput.value = 'gpt-4.1-mini';
    }
    localStorage.setItem('ai_trpg_model', el.modelInput.value);
  };

  el.apiKeyInput.oninput = () => localStorage.setItem('ai_trpg_api_key', el.apiKeyInput.value);
  el.modelInput.oninput = () => localStorage.setItem('ai_trpg_model', el.modelInput.value);
  el.systemPromptInput.oninput = () => localStorage.setItem('ai_trpg_system_prompt', el.systemPromptInput.value);

  el.flowToggle.onchange = () => localStorage.setItem('ai_trpg_flow_enabled', String(el.flowToggle.checked));
  el.enforceOptionsToggle.onchange = () =>
    localStorage.setItem('ai_trpg_enforce_options', String(el.enforceOptionsToggle.checked));

  el.phaseSelect.onchange = () => {
    session.phase = el.phaseSelect.value;
    updateSession(sessionId, (s) => Object.assign(s, session));
  };

  el.saveStateBtn.onclick = () => {
    if (!el.metaToggle.checked) {
      alert('建议只在 Meta 模式下修改状态面板。');
      return;
    }
    try {
      const next = JSON.parse(el.stateView.textContent);
      session.state = next;
      updateSession(sessionId, (s) => Object.assign(s, session));
      alert('已保存。下一轮将按新设定运行。');
    } catch (e) {
      alert('右侧不是合法 JSON，无法保存。');
    }
  };

  el.newSessionBtn.onclick = () => {
    createSession();
    location.reload();
  };

  el.sessionSelect.onchange = () => {
    const nextId = el.sessionSelect.value;
    const next = loadSession(nextId);
    if (!next) return;
    location.reload();
  };

  // init
  renderSessionList(sessionId);
  renderChat();
  renderState();
  renderPcDraft();
  renderNpcProposals();
  renderOptions([]);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    })[c]
  );
}
