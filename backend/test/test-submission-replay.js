import assert from 'node:assert/strict';
import { createApp } from '../src/api/GameController.js';
let calls = 0;
const provider = { model:'offline', generate: async () => {
  calls++;
  return {content: JSON.stringify({ narration:'你记录已知信息。', actions:null, options:['A. 检查门锁','B. 整理笔记','C. 观察环境','D. 自由行动'], npcs:[], locations:[], items:[], time_cost_minutes:15, evidence_changes:[], combat_update:null, suspicion_delta:0, active_event_ack:null })};
}};
const app = createApp({llmProvider:provider});
const server = app.listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const url = `http://127.0.0.1:${server.address().port}/api`;
try {
  const created = await fetch(url+'/sessions/tutorials/birch-station',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());
  const body = JSON.stringify({session:created.session,text:'给门锁刮痕拍照'});
  const request = () => fetch(url+`/sessions/${created.session.id}/message`,{method:'POST',headers:{'Content-Type':'application/json'},body}).then(r=>r.text());
  const [first,second] = await Promise.all([request(),request()]);
  const done = text => text.split('\n\n').find(block=>block.startsWith('event: done'));
  assert.ok(done(first));
  assert.equal(done(first),done(second),'concurrent retry returns the same completed snapshot');
  const used = calls;
  assert.equal(done(await request()),done(first));
  assert.equal(calls,used,'retry must not invoke model again');
  console.log('Concurrent and completed submission replay passed');
} finally { await new Promise(resolve=>server.close(resolve)); }
