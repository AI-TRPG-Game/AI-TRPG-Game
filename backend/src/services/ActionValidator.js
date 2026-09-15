import { evidenceIntent } from './InvestigationDirector.js';
import { componentAccess, contactWitness, hasDanger, knownRoute, locationPatterns, requestedComponents } from '../../../src/shared/InvestigationRules.mjs';

// Read-only preflight: never schedule events, award evidence or spend pressure.
export function validateAction(session,input) {
  const text=String(input).split('对应行动：').pop().trim();
  const reject=reason=>({ok:false,message:`【行动尚未执行】${reason}\n请修改输入或选择证据详情中的具体行动。本次不消耗行动压力。`});
  const main=text.split(/如果|若有人|if\b/i)[0]; // Conditional intentions are not extra executed actions.
  const intent=evidenceIntent(session,main);
  if(intent.clarification) return reject(intent.clarification);
  const moving=/进入|前往|返回|回到|走进|赶到|先去|^去|go to|return to|enter|move to|head (?:to|for)/i.test(main);
  const destinations=Object.entries(locationPatterns).filter(([,pattern])=>pattern.test(main)).map(([id])=>id);
  const sequence=main.split(/然后|接着|随后|再去|再搜索|；|;|\bthen\b/i).filter(s=>s.trim() && !/^(?:标注|标记|注明|记录位置|放置比例|label|mark)/i.test(s.trim()));
  if(sequence.length>1 || moving && destinations.length>1) return reject('这包含多个独立步骤。请先选择一个目的地，或一项调查目标；其他步骤留到下一行动。');
  if(moving && /拍照|拍摄|抄录|取样|装袋|调查|搜索|搜查|询问|说服|录音|photograph|inspect|search|persuade|record/i.test(main)) return reject('移动与到达后的调查是两个步骤。请先移动，再处理材料或人物。');
  if(!hasDanger(session) && /说服|谈判|persuad|convince/i.test(main) && /录音|拍摄|抄录|取样|record|photo/i.test(main)) return reject('请先解决合作意愿，再进行取证。');
  if(moving && !hasDanger(session)) {
    const destination=destinations[0];
    if(!destination || !session.locations.some(l=>l.id===destination)) return reject('目的地尚不明确或尚未发现。请选一个已知地点；探索未知路线请描述从哪里开始探索。');
    const route=knownRoute(session,destination);
    if(!route) return reject('目前没有已知的可通行路线，请先调查通路。');
    if(route.slice(1,-1).some(id=>['loc_004','loc_009','loc_010'].includes(id))) return reject('路线经过危险区域，不能直接越过。请先进入相邻的危险区域。');
    const familiar=(session.scenarioFlags.investigation?.visited || [session.playerLocationId]);
    return {ok:true,cost:route.every(id=>familiar.includes(id) && !['loc_004','loc_009','loc_010'].includes(id)) ? 0 : 1,kind:'move'};
  }
  if(!hasDanger(session) && /调查|检查|搜索|搜查|search|inspect/i.test(main) && /询问|说服|谈判|ask|persuad/i.test(main)) return reject('调查物品和交涉人物是不同目标，请先选择其中一个。');
  if(intent.method && intent.ids.length) {
    const ids=intent.ids;
    const archivePair=ids.every(id=>['evidence_003','evidence_007'].includes(id)) && session.playerLocationId==='loc_007';
    if(ids.length>1 && !archivePair) return reject('这里涉及不同证据目标。请先选择其中一项；同一份组合证据的共同取证可以一起完成。');
    for(const id of ids) {
      const wanted=requestedComponents(session,id,main);
      if(!wanted.length) return reject('请说明要保存哪个组件，例如画作、名册、证词或检修图。');
      for(const key of wanted) { const access=componentAccess(session,id,key); if(!access.ok) return reject(access.reason); }
      if(!session.inventory.some(i=>i.id==='item_field_kit' && i.status!=='已失去')) return reject('缺少取证工具。');
    }
  }
  if(/林晚|lin wan/i.test(main) && /说服|询问|谈判|问她|persuad|ask/i.test(main) && !contactWitness(session)) return reject('目前无法与林晚直接交流。请先建立联系。');
  if(/包扎|稳定情绪/.test(main) && hasDanger(session)) return reject('危险未解除，不能安全治疗或休整。');
  if(!main || /^(?:这个|那个|做这个|处理一下|do it|that)$/i.test(main)) return reject('请说明本次想对谁或什么做什么。');
  // Creative, single-objective actions remain possible. Interpretation cannot
  // grant remote evidence: all outcomes are still checked by the director.
  return {ok:true,cost:1,kind:'action'};
}
