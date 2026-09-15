import express from 'express';
import { createApp } from './api/GameController.js';

export function createPlayerApp({ token, origin, dist, shutdown, ...providers }) {
  let active = 0;
  let stopping = false;
  const app = createApp({ ...providers, lifecycleMiddleware(req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) {
      return res.status(403).json({ error: '仅允许本机游戏页面访问。' });
    }
    if (stopping) return res.status(503).json({ error: '游戏正在关闭。' });
    if (req.path.startsWith('/api/')) {
      active++;
      // finish tracks completed response, not client disconnect during generation.
      res.once('finish', () => { active--; });
    }
    next();
  }});
  app.get('/launcher/health', (_req, res) => res.json({ app: 'ai-trpg-player', pid: process.pid }));
  app.get('/launcher/session', (req, res) => {
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.sendStatus(403);
    res.json({ token });
  });
  app.post('/launcher/shutdown', (req, res) => {
    if (req.headers['x-launcher-token'] !== token) return res.sendStatus(403);
    if (active) return res.status(409).json({ error: '游戏仍有请求正在处理，请稍后退出。' });
    stopping = true;
    res.once('finish', shutdown);
    res.json({ stopped: true });
  });
  app.use(express.static(dist));
  return app;
}
