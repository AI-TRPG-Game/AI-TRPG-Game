import { runTurn, runSimpleChat } from "../engine/gameEngine.js";
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

        <div style="display:flex;gap:8px;align-items:center;">
          <label style="display:flex;gap:6px;align-items:center;">
            <input type="radio" name="chatMode" value="simple" checked />
            <span>纯聊天（无记忆）</span>
          </label>
          <label style="display:flex;gap:6px;align-items:center;">
            <input type="radio" name="chatMode" value="game" />
            <span>游戏（结构化JSON）</span>
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
          <summary>纯聊天设置（可选 System Prompt）</summary>
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
        <h3 style="margin:0;">状态面板</h3>
        <div style="font-size:12px;color:#666;">（游戏模式使用；纯聊天模式可忽略）</div>
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
  el.systemPromptInput.value = localStorage.getItem('ai_trpg_simple_system_prompt') || '';

  function getChatMode() {
    const picked = chatModeEls.find(x => x.checked);
    return picked?.value || 'simple';
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
        const modeTag = m.mode ? ` · ${escapeHtml(m.mode)}` : '';
        return `<div style="margin:6px 0;padding:8px;border-radius:8px;background:${bg};border:1px solid #eee;">
        <div style="font-size:12px;color:#666;">${escapeHtml(m.role)}${modeTag}</div>
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
      btn.textContent = o;
      btn.onclick = () => submit(o);
      el.options.appendChild(btn);
    }
  }

  async function submit(text) {
    const mode = el.metaToggle.checked ? "meta" : "normal";
    const provider = el.providerSelect.value;
    const chatMode = getChatMode();

    session.messages.push({ role: "user", content: text, mode });
    updateSession(sessionId, (s) => Object.assign(s, session));
    renderChat();

    try {
      const apiKey = el.apiKeyInput.value.trim();
      const model = el.modelInput.value.trim();

      if (chatMode === 'simple') {
        const systemPrompt = el.systemPromptInput.value;
        const result = await runSimpleChat({ provider, apiKey, model, systemPrompt, userText: text });
        session.messages.push({ role: 'assistant', content: result.text, mode });
        updateSession(sessionId, (s) => Object.assign(s, session));
        renderChat();
        renderOptions([]);
        return;
      }

      // game mode
      const result = await runTurn({
        mode,
        session,
        userText: text,
        provider,
        apiKey,
        model,
      });

      session.messages.push({ role: "assistant", content: result.narrative, mode });
      updateSession(sessionId, (s) => Object.assign(s, session));

      renderChat();
      renderState();
      renderOptions(result.options || []);
    } catch (e) {
      session.messages.push({ role: "assistant", content: `【错误】${e.message}`, mode });
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
    // convenience defaults
    if (el.providerSelect.value === 'deepseek' && (!el.modelInput.value || el.modelInput.value.startsWith('gpt-'))) {
      el.modelInput.value = 'deepseek-v4-flash';
    }
    if (el.providerSelect.value === 'openai' && (!el.modelInput.value || el.modelInput.value.startsWith('deepseek-'))) {
      el.modelInput.value = 'gpt-4.1-mini';
    }
    localStorage.setItem("ai_trpg_model", el.modelInput.value);
  };
  el.apiKeyInput.oninput = () =>
    localStorage.setItem("ai_trpg_api_key", el.apiKeyInput.value);
  el.modelInput.oninput = () =>
    localStorage.setItem("ai_trpg_model", el.modelInput.value);
  el.systemPromptInput.oninput = () =>
    localStorage.setItem('ai_trpg_simple_system_prompt', el.systemPromptInput.value);

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
