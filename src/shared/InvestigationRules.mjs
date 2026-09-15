// Pure rules shared by the UI and engine. No hidden location/name is emitted
// unless it already exists in the player's discovered location collection.
export const components = {
  evidence_001: [['record','刮痕记录','loc_001','给门锁刮痕拍照']],
  evidence_002: [['record','泥粒样本','loc_001','把地毯湿泥装袋取样']],
  evidence_003: [['needle','针孔记录','loc_001','拍摄针孔'],['medical','对应医疗记录','loc_007','抄录对应药物记录']],
  evidence_004: [['record','录音副本','loc_001','抄录顾言的录音']],
  evidence_005: [['record','调度记录副本','loc_006','拍摄调度记录']],
  evidence_006: [['painting','画作记录','loc_005','拍摄苏棠的画作'],['register','名册记录','loc_005','拍摄乘客名册']],
  evidence_007: [['record','转运档案副本','loc_007','抄录医疗转运档案']],
  evidence_008: [['testimony','证词录音','witness','录音保存林晚的证词'],['map','检修图副本','witness','复制林晚的检修图']],
};
export function contactWitness(session) {
  const n = session.npcs?.find(n=>n.id==='npc_005');
  return !!n && n.visibility !== 'hidden' && n.status !== 'departed' && n.hp !== 0
    && !/昏迷|无法交流/.test(n.currentState || '') && n.locationId === session.playerLocationId;
}
export function hasDanger(session) {
  const scene=session.activeScene;
  return !!session.combat?.active || !session.scenarioFlags?.finale_crisis_resolved && !!session.scheduledEvents?.find(e=>e.id===scene?.eventId)?.branches?.[scene?.branchKey]?.combatUpdate?.active;
}
export function heldComponents(session,id) {
  return session.evidence?.find(e=>e.id===id)?.artifacts?.filter(a=>a.custody==='player').map(a=>a.component) || [];
}
export function requestedComponents(session,id,text) {
  if(id==='evidence_003') return [/针孔|needle/i.test(text) && 'needle', /药物|medication|medical/i.test(text) && 'medical'].filter(Boolean).length
    ? [/针孔|needle/i.test(text) && 'needle', /药物|medication|medical/i.test(text) && 'medical'].filter(Boolean)
    : [session.playerLocationId==='loc_007'?'medical':'needle'];
  if(id==='evidence_006') return [/画|painting|portrait/i.test(text)&&'painting',/名册|register/i.test(text)&&'register'].filter(Boolean);
  if(id==='evidence_008') return [/证词|录音|testimony/i.test(text)&&'testimony',/检修图|map/i.test(text)&&'map'].filter(Boolean);
  return ['record'];
}
export function componentAccess(session,id,component) {
  if (heldComponents(session,id).includes(component)) return {ok:true};
  const def=components[id]?.find(c=>c[0]===component);
  if (!def) return {ok:false,reason:'尚无明确的保全方法，请先调查来源。'};
  if (def[2]==='witness') return contactWitness(session)
    ? session.scenarioFlags?.witness_cooperating ? {ok:true} : {ok:false,reason:'须先取得林晚合作。'}
    : {ok:false,reason:`目前无法直接联系林晚，且未持有${component==='map'?'检修图':'证词记录'}；请寻找她，或处理已持有的副本。`};
  if (def[2]===session.playerLocationId || id==='evidence_004' && session.inventory?.some(i=>i.id==='item_001' && i.status!=='已失去')) return {ok:true};
  const place=session.locations?.find(l=>l.id===def[2]);
  return {ok:false,reason:place ? `须先到达${place.name}。` : '材料来源尚待调查。'};
}
export function evidenceDetails(session,id) {
  const record=session.evidence?.find(e=>e.id===id && e.discovered!==false);
  if (!record) return null;
  const equipped=session.inventory?.some(i=>i.id==='item_field_kit' && i.status!=='已失去');
  const rows=(components[id] || []).map(([key,label,location,text])=>{
    const done=!!record.secured || heldComponents(session,id).includes(key);
    const access=componentAccess(session,id,key);
    const place=session.locations?.find(l=>l.id===location);
    const requirement=location==='witness' ? '林晚本人同场且同意合作，或持有该材料的副本' : place ? place.name+'，或已持有该材料' : '材料来源尚待调查';
    let action=null;
    if (!done && access.ok && equipped) action={kind:'preserve',evidenceId:id,component:key};
    else if (!done && location==='witness' && contactWitness(session) && !session.scenarioFlags?.witness_cooperating) action={kind:'cooperate',npcId:'npc_005'};
    else if (!done && place && place.id!==session.playerLocationId && !hasDanger(session)) action={kind:'move',locationId:place.id};
    return {key,label,done,requirement,reason:done ? '已经保存' : !equipped ? '缺少取证工具。' : access.ok ? hasDanger(session) ? '存在危险；保全需先通过本轮检定。' : '可以执行，消耗1次有效行动。' : access.reason,action,text:action?.kind==='move' ? `前往${place.name}` : action?.kind==='cooperate' ? '先取得林晚合作' : text};
  });
  return {rows};
}
export function actionText(session,action) {
  if (action?.kind==='move') {
    const place=session.locations?.find(l=>l.id===action.locationId);
    return place ? `进入${place.name}` : null;
  }
  if (action?.kind==='cooperate') return action.npcId==='npc_005' && session.npcs?.some(n=>n.id==='npc_005' && n.visibility!=='hidden') ? '说服林晚相信我的保护承诺' : null;
  if (action?.kind==='preserve' && session.evidence?.some(e=>e.id===action.evidenceId && e.discovered!==false)) return components[action.evidenceId]?.find(c=>c[0]===action.component)?.[3] || null;
  return null;
}

export const locationPatterns = {loc_001:/first.class|compartment|头等包厢/i,loc_002:/baggage|luggage|行李车/i,loc_003:/platform|白桦站站台|(?:^|到|入|往)站台/i,loc_004:/车顶检修通道/i,loc_005:/waiting hall|waiting room|候车厅/i,loc_006:/station office|站务办公室|(?:^|到|入|往)办公室/i,loc_007:/medical archive|医疗档案室/i,loc_008:/crew.*room|乘务员休息室/i,loc_009:/underground entrance|积水地下入口/i,loc_010:/transfer room|矿难转运室/i};
export function knownRoute(session,destination) {
  const known=new Set(session.locations?.map(l=>l.id));
  const queue=[[session.playerLocationId]], seen=new Set();
  while(queue.length) {
    const path=queue.shift(), last=path.at(-1);
    if(last===destination) return path;
    if(seen.has(last)) continue; seen.add(last);
    for(const next of session.scenarioRules?.locationGraph?.[last] || []) if(known.has(next)) queue.push([...path,next]);
  }
  return null;
}
