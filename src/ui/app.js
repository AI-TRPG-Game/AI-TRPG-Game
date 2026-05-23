import { runNarrative } from "../engine/narrativeEngine.js";
import { FlowType, Phase } from "../engine/flows.js";
import {
  updateSession,
  listSessions,
  createSession,
  loadSession,
} from "../store/stateStore.js";

export function renderApp({ sessionId, session }) {
  const app = document.querySelector("#app");
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
    chat: app.querySelector("#chat"),
    options: app.querySelector("#options"),
    textInput: app.querySelector("#textInput"),
    sendBtn: app.querySelector("#sendBtn"),
    metaToggle: app.querySelector("#metaToggle"),
    flowToggle: app.querySelector('#flowToggle'),
    phaseSelect: app.querySelector('#phaseSelect'),
    flowTypeSelect: app.querySelector('#flowTypeSelect'),
    enforceOptionsToggle: app.querySelector('#enforceOptionsToggle'),
    stateView: app.querySelector("#stateView"),
    saveStateBtn: app.querySelector("#saveStateBtn"),
    providerSelect: app.querySelector("#providerSelect"),
    apiKeyInput: app.querySelector("#apiKeyInput"),
    modelInput: app.querySelector("#modelInput"),
    sessionSelect: app.querySelector("#sessionSelect"),
    newSessionBtn: app.querySelector("#newSessionBtn"),
    systemPromptInput: app.querySelector('#systemPromptInput'),
  };

  const chatModeEls = Array.from(app.querySelectorAll('input[name="chatMode"]'));

  // persist settings
  el.apiKeyInput.value = localStorage.getItem("ai_trpg_api_key") || "";
  el.providerSelect.value = localStorage.getItem("ai_trpg_provider") || "mock";
  el.modelInput.value = localStorage.getItem("ai_trpg_model") || "deepseek-v4-flash";
  el.systemPromptInput.value = localStorage.getItem('ai_trpg_system_prompt') || '';
  el.flowToggle.checked = localStorage.getItem('ai_trpg_flow_enabled') !== 'false';
  el.enforceOptionsToggle.checked = localStorage.getItem('ai_trpg_enforce_options') !== 'false';

  // session phase/mode
  session.phase = session.phase || Phase.setup_world;
  el.phaseSelect.value = session.phase;

  function getChatMode() {
    const picked = chatModeEls.find((x) => x.checked);
    return picked?.value || "simple";
  }

  function renderSessionList(currentId) {
    const sessions = listSessions();
    el.sessionSelect.innerHTML = sessions
      .map((s) => `<option value="${s.id}">${escapeHtml(s.title)}</option>`)
      .join("");
    el.sessionSelect.value = currentId;
  }

  function renderChat() {
    el.chat.innerHTML = session.messages
      .map((m) => {
        const bg = m.role === "user" ? "#dff2ff" : "#fff";
        const modeTag = m.mode ? ` · ${escapeHtml(m.mode)}` : "";
        const phaseTag = m.phase ? ` · ${escapeHtml(m.phase)}` : "";
        return `<div style="margin:6px 0;padding:8px;border-radius:8px;background:${bg};border:1px solid #eee;">
        <div style="font-size:12px;color:#666;">${escapeHtml(m.role)}${modeTag}${phaseTag}</div>
        <div>${escapeHtml(m.content).replaceAll("\n", "<br/>")}</div>
      </div>`;
      })
      .join("");
    el.chat.scrollTop = el.chat.scrollHeight;
  }

  function renderState() {
    el.stateView.textContent = JSON.stringify(session.state, null, 2);
  }

  function renderOptions(opts) {
    el.options.innerHTML = "";
    for (const o of opts) {
      const btn = document.createElement("button");
      const label = typeof o === 'string' ? o : `${o.key}. ${o.text}`;
      btn.textContent = label;
      btn.onclick = () => {
        if (typeof o === 'string') submit(o);
        else submit(o.text);
      };
      el.options.appendChild(btn);
    }
  }

  async function submit(text) {
    const mode = el.metaToggle.checked ? "meta" : "normal";
    const provider = el.providerSelect.value;
    const chatMode = getChatMode();
    const flowEnabled = el.flowToggle.checked;
    const phase = el.phaseSelect.value;
    const selectedFlowType = el.flowTypeSelect.value || null;

    // user message
    session.messages.push({ role: "user", content: text, mode, phase });
    updateSession(sessionId, (s) => Object.assign(s, session));
    renderChat();

    try {
      const apiKey = el.apiKeyInput.value.trim();
      const model = el.modelInput.value.trim();
      const systemPrompt = el.systemPromptInput.value;

      if (chatMode === "game") {
        // legacy
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

        session.messages.push({ role: "assistant", content: result.text, mode, phase });
        updateSession(sessionId, (s) => Object.assign(s, session));
        renderChat();
        renderState();
        renderOptions([]);
        return;
      }

      // simple chat with flow
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

      session.messages.push({ role: "assistant", content: result.text, mode, phase: result.next?.phase || phase });
      session.phase = result.next?.phase || phase;
      el.phaseSelect.value = session.phase;

      updateSession(sessionId, (s) => Object.assign(s, session));
      renderChat();
      renderState();
      renderOptions(enforceOptions ? (result.options || []) : []);
    } catch (e) {
      session.messages.push({
        role: "assistant",
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
    el.textInput.value = "";
    submit(t);
  };

  el.textInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") el.sendBtn.click();
  });

  el.providerSelect.onchange = () => {
    localStorage.setItem("ai_trpg_provider", el.providerSelect.value);
    if (
      el.providerSelect.value === "deepseek" &&
      (!el.modelInput.value || el.modelInput.value.startsWith("gpt-"))
    ) {
      el.modelInput.value = "deepseek-v4-flash";
    }
    if (
      el.providerSelect.value === "openai" &&
      (!el.modelInput.value || el.modelInput.value.startsWith("deepseek-"))
    ) {
      el.modelInput.value = "gpt-4.1-mini";
    }
    localStorage.setItem("ai_trpg_model", el.modelInput.value);
  };

  el.apiKeyInput.oninput = () =>
    localStorage.setItem("ai_trpg_api_key", el.apiKeyInput.value);
  el.modelInput.oninput = () =>
    localStorage.setItem("ai_trpg_model", el.modelInput.value);
  el.systemPromptInput.oninput = () =>
    localStorage.setItem('ai_trpg_system_prompt', el.systemPromptInput.value);

  el.flowToggle.onchange = () =>
    localStorage.setItem('ai_trpg_flow_enabled', String(el.flowToggle.checked));
  el.enforceOptionsToggle.onchange = () =>
    localStorage.setItem('ai_trpg_enforce_options', String(el.enforceOptionsToggle.checked));

  el.phaseSelect.onchange = () => {
    session.phase = el.phaseSelect.value;
    updateSession(sessionId, (s) => Object.assign(s, session));
  };

  el.saveStateBtn.onclick = () => {
    if (!el.metaToggle.checked) {
      alert("建议只在 Meta 模式下修改状态面板。");
      return;
    }
    try {
      const next = JSON.parse(el.stateView.textContent);
      session.state = next;
      updateSession(sessionId, (s) => Object.assign(s, session));
      alert("已保存。下一轮将按新设定运行。");
    } catch (e) {
      alert("右侧不是合法 JSON，无法保存。");
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
  renderOptions([]);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[c]
  );
}
