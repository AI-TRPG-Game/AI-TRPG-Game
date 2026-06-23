import express from 'express';
import cors from 'cors';
import { GameOrchestrator } from '../orchestrator/GameOrchestrator.js';
import { RequestSessionRepository } from '../persistence/RequestSessionRepository.js';

function createStatelessOrchestrator({ session, llmProvider, streamEmitter }) {
  const repository = new RequestSessionRepository(session);
  return new GameOrchestrator({
    repository,
    llmProvider,
    streamEmitter,
  });
}

function requireSession(req) {
  if (!req.body?.session?.id) {
    throw new Error('Session payload is required');
  }
  return req.body.session;
}

export function createGameController({ llmProvider, streamEmitter }) {
  const router = express.Router();

  router.post('/sessions', (req, res) => {
    try {
      const orchestrator = createStatelessOrchestrator({
        session: null,
        llmProvider,
        streamEmitter,
      });
      const session = orchestrator.createSession(req.body?.title);
      res.json({ session: session.toClientJSON() });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/sessions/:id/enter-world', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({
        session,
        llmProvider,
        streamEmitter,
      });
      res.json(orchestrator.enterWorldSetting(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/sessions/:id/enter-character', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({
        session,
        llmProvider,
        streamEmitter,
      });
      res.json(orchestrator.enterCharacterSetting(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/sessions/:id/save-world', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({
        session,
        llmProvider,
        streamEmitter,
      });
      res.json(orchestrator.saveWorld(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/sessions/:id/save-character', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({
        session,
        llmProvider,
        streamEmitter,
      });
      res.json(orchestrator.saveCharacter(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.patch('/sessions/:id/protagonist', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({
        session,
        llmProvider,
        streamEmitter,
      });
      res.json(orchestrator.updateProtagonist(req.params.id, req.body.protagonist));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/sessions/:id/open-story', async (req, res) => {
    const streamId = streamEmitter.createStream();
    res.json({ streamId });

    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({
        session,
        llmProvider,
        streamEmitter,
      });
      await orchestrator.openStory(req.params.id, streamId);
    } catch (err) {
      streamEmitter.emit(streamId, { type: 'error', error: err.message });
    } finally {
      streamEmitter.emit(streamId, { type: 'end' });
      setTimeout(() => streamEmitter.close(streamId), 5000);
    }
  });

  router.post('/sessions/:id/dice-confirm', async (req, res) => {
    const streamId = streamEmitter.createStream();
    res.json({ streamId });

    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({
        session,
        llmProvider,
        streamEmitter,
      });
      await orchestrator.confirmDice(req.params.id, streamId);
    } catch (err) {
      streamEmitter.emit(streamId, { type: 'error', error: err.message });
    } finally {
      streamEmitter.emit(streamId, { type: 'end' });
      setTimeout(() => streamEmitter.close(streamId), 5000);
    }
  });

  router.post('/sessions/:id/dice-cancel', (req, res) => {
    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({
        session,
        llmProvider,
        streamEmitter,
      });
      res.json(orchestrator.cancelDice(req.params.id));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  router.post('/sessions/:id/message', async (req, res) => {
    const { text } = req.body;
    if (!text?.trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }

    const streamId = streamEmitter.createStream();
    res.json({ streamId });

    try {
      const session = requireSession(req);
      const orchestrator = createStatelessOrchestrator({
        session,
        llmProvider,
        streamEmitter,
      });
      await orchestrator.handleMessage(req.params.id, text.trim(), streamId);
    } catch (err) {
      streamEmitter.emit(streamId, { type: 'error', error: err.message });
    } finally {
      streamEmitter.emit(streamId, { type: 'end' });
      setTimeout(() => streamEmitter.close(streamId), 5000);
    }
  });

  router.get('/streams/:streamId', (req, res) => {
    const { streamId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const unsubscribe = streamEmitter.subscribe(streamId, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'end') {
        res.end();
      }
    });

    req.on('close', () => {
      unsubscribe();
    });
  });

  return router;
}

export function createApp({ llmProvider, streamEmitter }) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', createGameController({ llmProvider, streamEmitter }));
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  return app;
}
