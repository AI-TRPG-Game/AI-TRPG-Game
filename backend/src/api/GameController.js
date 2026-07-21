import express from 'express';
import cors from 'cors';
import { GameOrchestrator } from '../orchestrator/GameOrchestrator.js';
import { RequestSessionRepository } from '../persistence/RequestSessionRepository.js';

function createStatelessOrchestrator({ session, llmProvider }) {
  const repository = new RequestSessionRepository(session);
  return new GameOrchestrator({ repository, llmProvider });
}

function requireSession(req) {
  if (!req.body?.session?.id) {
    throw new Error('Session payload is required');
  }
  return req.body.session;
}

/**
 * 将 Express 响应切换为 SSE 模式，返回一个 sendSse(event, data) 函数。
 * 用于 LLM 调用路由（/message、/open-story、/dice-confirm）流式推送 debug 日志。
 *
 * SSE 协议格式：
 *   event: <event-name>\n
 *   data: <json-string>\n\n
 *
 * 事件类型：
 *   - debug: 中间调试日志（debug_prompt / debug_raw / parse_fail / retry_clear / system）
 *   - system-message: 系统判定结果（dice 投掷结果，需在 LLM 回复前立即显示）
 *   - done:  最终结果（含 session、result、systemMessages 等）
 *   - error: 错误（含 message 字段）
 */
function startSseStream(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // 关闭 Nginx/反向代理缓冲，确保 chunk 立即下发
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  return (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}

export function createGameController({ llmProvider }) {
  const router = express.Router();

  router.post('/sessions', (req, res) => {
    try {
      const orchestrator = createStatelessOrchestrator({ session: null, llmProvider });
      const session = orchestrator.createSession(req.body?.title);
      res.json({ session: session.toClientJSON() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/sessions/:id/enter-world', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.enterWorldSetting(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/sessions/:id/enter-character', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.enterCharacterSetting(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/sessions/:id/save-world', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.saveWorld(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/sessions/:id/save-character', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.saveCharacter(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch('/sessions/:id/player', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.updatePlayer(req.params.id, req.body.player));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── 关键角色设定 ──

  router.post('/sessions/:id/enter-key-character', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.enterKeyCharacterSetting(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/sessions/:id/save-key-character', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.saveKeyCharacter(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/sessions/:id/invite-next-key-character', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.inviteNextKeyCharacter(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/sessions/:id/open-story-confirm', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.getStoryOpenConfirmInfo(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── LLM 调用路由（SSE 流式推送 debug 日志） ──
  // 三条路由均以 SSE 响应：
  //   1) event:debug —— LLM 调用过程中实时推送中间状态（debug_prompt / debug_raw / parse_fail / retry_clear / system）
  //   2) event:done —— 整个 LLM 回合完成，推送最终结果（含 session、result、systemMessages）
  //   3) event:error —— 异常时推送错误信息
  // 前端通过 fetch + ReadableStream 消费，god's eye 面板实时渲染 debug 事件

  router.post('/sessions/:id/open-story', async (req, res) => {
    const sendSse = startSseStream(res);
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      const result = await orchestrator.openStory(req.params.id, {
        onDebug: (log) => sendSse('debug', log),
      });
      sendSse('done', result);
    } catch (err) {
      sendSse('error', { message: err.message });
    } finally {
      res.end();
    }
  });

  router.post('/sessions/:id/dice-confirm', async (req, res) => {
    const sendSse = startSseStream(res);
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      const result = await orchestrator.confirmDice(req.params.id, {
        onDebug: (log) => sendSse('debug', log),
        // 系统判定结果在 LLM 调用前就推送，让用户立即看到【使用XX技能（技能点YY），判定结果Z，等级】
        onSystemMessage: (msg) => sendSse('system-message', { message: msg }),
      });
      sendSse('done', result);
    } catch (err) {
      sendSse('error', { message: err.message });
    } finally {
      res.end();
    }
  });

  router.post('/sessions/:id/dice-cancel', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.cancelDice(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // ── 设定增删改 ──

  router.patch('/sessions/:id/world-settings', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.updateWorldSettings(req.params.id, req.body.worldSettings));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.patch('/sessions/:id/locations', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.upsertLocation(req.params.id, req.body.index ?? -1, req.body.data));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/sessions/:id/locations/:index', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.deleteLocation(req.params.id, Number(req.params.index)));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.patch('/sessions/:id/npcs', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.upsertNpc(req.params.id, req.body.index ?? -1, req.body.data));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/sessions/:id/npcs/:index', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.deleteNpc(req.params.id, Number(req.params.index)));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.patch('/sessions/:id/items', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.upsertItem(req.params.id, req.body.index ?? -1, req.body.data));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/sessions/:id/items/:index', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.deleteItem(req.params.id, Number(req.params.index)));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.patch('/sessions/:id/key-characters', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.upsertKeyCharacter(req.params.id, req.body.index ?? -1, req.body.data));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.delete('/sessions/:id/key-characters/:index', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      res.json(orchestrator.deleteKeyCharacter(req.params.id, Number(req.params.index)));
    } catch (err) { res.status(400).json({ error: err.message }); }
  });

  router.post('/sessions/:id/message', async (req, res) => {
    const { text } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }
    const sendSse = startSseStream(res);
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({ session, llmProvider });
      const result = await orchestrator.handleMessage(req.params.id, text.trim(), {
        onDebug: (log) => sendSse('debug', log),
      });
      sendSse('done', result);
    } catch (err) {
      sendSse('error', { message: err.message });
    } finally {
      res.end();
    }
  });

  return router;
}

export function createApp({ llmProvider }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createGameController({ llmProvider }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  return app;
}
