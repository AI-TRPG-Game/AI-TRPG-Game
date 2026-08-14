export const BIRCH_STATION_ID = 'birch-station-onboarding-v1';

const player = `姓名：调查记者\n年龄：31\n性别：不限\n职业：调查记者\n性格：谨慎、执拗，习惯把疑点记进随身笔记。\n人物肖像与重要经历：顾言在失踪前寄来半段录音，并在信中警告“不要听完整段录音”。你循着邮戳登上了雨夜的雾港号。\nHP：11  SAN：60  信用评级：40\n侦查：60  图书馆使用：55  说服：50  聆听：55  心理学：45  闪避：35`;

export const BIRCH_STATION_TUTORIAL = {
  id: BIRCH_STATION_ID,
  title: '新手试炼：白桦站的末班车',
  worldSettings: '1929年深秋，暴雨中的雾港号停靠在废弃白桦站。列车内发生了一桩看似密室的谋杀；调查会逐步滑向与矿难旧案和异常资料有关的心理恐怖。',
  player,
  scenarioRules: {
    time: { minimumMinutes: 10, maximumMinutes: 60 },
    clueCatalog: {
      evidence_001: { category: 'murder', source: 'compartment lock', reliability: 'medium', description: 'Fresh scratches are visible inside the lock cylinder.', truths: ['murder'] },
      evidence_002: { category: 'murder', source: 'wet mud', reliability: 'medium', description: 'The mud came from the closed roof passage.', truths: ['murder'] },
      evidence_003: { category: 'murder', source: 'needle mark and medicine record', reliability: 'high', description: 'The death was staged with a sedative injection rather than natural illness.', truths: ['murder', 'culprit'] },
      evidence_004: { category: 'survivor', source: 'Gu Yan recording', reliability: 'high', description: 'The missing recording names a seventh miner who survived the disaster.', truths: ['seventh_survivor'] },
      evidence_005: { category: 'coverup', source: 'dispatch record', reliability: 'high', description: 'The dispatch log was altered to conceal an unscheduled transfer.', truths: ['coverup', 'culprit'] },
      evidence_006: { category: 'survivor', source: 'station painting and manifest', reliability: 'high', description: 'A passenger manifest confirms that the seventh survivor was erased from the official count.', truths: ['seventh_survivor'] },
      evidence_007: { category: 'coverup', source: 'medical transfer file', reliability: 'high', description: 'Medical files connect the mine survivors to the station transfer.', truths: ['coverup'] },
      evidence_008: { category: 'culprit', source: 'witness testimony', reliability: 'high', description: 'A witness places the conspirators with the altered records and the victim.', truths: ['culprit'] },
    },
    truths: {
      murder: ['evidence_001', 'evidence_003'],
      coverup: ['evidence_005', 'evidence_007'],
      seventh_survivor: ['evidence_004', 'evidence_006'],
      culprit: ['evidence_003', 'evidence_005', 'evidence_008'],
    },
  },
  opening: {
    narration: `00:10。雾港号停在白桦站已经整整四十分钟了。

你曾在报社的社会版跑过六码头事故、两次失踪案和一场无人愿意署名的罢工。顾言是少数仍肯把调查做到底的人：三周前，他从旧报馆的火灾档案里翻出“白桦矿难”的死亡名单，发现名单上有七个人，却只有六具被确认的遗体。昨夜，一只没有署名的牛皮纸袋送到你的住处，里面是顾言的采访笔记、一张写着“白桦站”的车票，以及半段被雨水浸过的录音带。录音里，顾言的声音压得很低：\n\n“如果我没能下车，别把它听完。去找……第七个人……”

列车在凌晨穿过山区暴雨时突然减速，随后像被什么东西从轨道另一端拽住，停在这座废弃多年的站台旁。白桦站的站牌斜插在积水里；候车室没有灯，只有风把一扇没有玻璃的窗框吹得反复撞墙。车内的乘客被乘务员劝回包厢，谁也不愿承认自己看见了站台尽头那盏本不该亮起的信号灯。

而顾言死了。

头等包厢的门从里面反锁。沈岐医生——雾港号临时随车的医生，袖口干净得不合时宜——蹲在尸体旁，刚刚用一种过于平静的语气宣布“急病猝死”。年轻乘务员许薇守在门口，指节攥得发白；她说停站前曾听见顾言和一名陌生男人争吵，却不肯再多讲一句。你认识顾言的笔迹，也知道他绝不会无缘无故把你引到这里。

你以调查记者的身份可以提问、记录、比对说辞，也可以不按任何人的安排行动。但从现在起，每一次停留都会消耗时间：06:00，雾港号将恢复通行，白桦站和车上的人都会被雨幕带走。

包厢门锁内侧有一道新鲜刮痕，地毯边缘黏着不属于车厢的湿泥。顾言随身的半段录音还在你的口袋里，另一半却不见踪影。

你的目标是查明顾言的死因、保全足以指向真相的证据，并在列车开动前决定那些异常资料该被公开、带走，还是永远留在这场雨里。`,
    options: ['A. 检查包厢门锁、针孔与地毯湿泥', 'B. 询问在场的沈医生和乘务员许薇', 'C. 搜查顾言遗留的行李与采访笔记', 'D. 自由行动'],
  },
  locations: [
    { id: 'loc_001', name: '头等包厢外', description: '顾言的反锁包厢前，狭窄走廊被雨声和昏黄壁灯填满。', firstSeenAt: 0, lastUpdatedAt: 0 },
    { id: 'loc_002', name: '行李车', description: '堆满旅行箱和检修工具的车厢，通往车顶的梯门上有水迹。', firstSeenAt: 0, lastUpdatedAt: 0 },
  ],
  npcs: [
    { id: 'npc_000', name: '调查记者', baseDescription: '追查顾言失踪前录音的调查记者。', currentState: '站在包厢门外，尚未开始调查。', importance: 'player', hp: 11, maxHp: 11, san: 60, maxSan: 60, visibility: 'visible', status: 'active', attributes: null, firstSeenAt: 0, lastUpdatedAt: 0 },
    { id: 'npc_001', name: '沈岐医生', baseDescription: '衣着整洁的随车医生，急于将死亡定为意外。', currentState: '避开尸体旁的针孔，催促乘务员封锁包厢。', importance: 'key', hp: 9, maxHp: 9, san: 45, maxSan: 45, visibility: 'visible', status: 'active', attributes: null, firstSeenAt: 0, lastUpdatedAt: 0 },
    { id: 'npc_002', name: '许薇', baseDescription: '年轻乘务员，记得列车停电前后的异常。', currentState: '脸色苍白，紧攥着调度钥匙。', importance: 'key', hp: 8, maxHp: 8, san: 50, maxSan: 50, visibility: 'visible', status: 'active', attributes: null, firstSeenAt: 0, lastUpdatedAt: 0 },
    { id: 'npc_003', name: '程岳', baseDescription: '自称工程顾问的乘客，与白桦站旧矿难有关。', currentState: '尚未公开露面。', importance: 'key', hp: 10, maxHp: 10, san: 40, maxSan: 40, visibility: 'hidden', status: 'active', attributes: null, firstSeenAt: 0, lastUpdatedAt: 0 },
  ],
  inventory: [
    { id: 'item_001', name: '顾言的半段录音', status: '已获得', description: '录音在最关键处中断，信中警告不要听完整段。', firstSeenAt: 0, lastUpdatedAt: 0 },
  ],
  evidence: [
    { id: 'evidence_001', category: 'murder', source: '包厢门锁', reliability: 'medium', secured: false, description: '锁芯内侧有新鲜刮痕。' },
    { id: 'evidence_002', category: 'murder', source: '地毯湿泥', reliability: 'medium', secured: false, description: '湿泥来自不应开放的车顶通道。' },
  ],
  scheduledEvents: [
    ['broadcast_0040', '00:40', '广播要求乘客留在车内；你获得第一次自由调查机会。', 'hook'],
    ['blackout_0110', '01:10', '人为停电。许薇昏倒，手提箱被调包；行李车车顶水迹变得可疑。', 'investigation'],
    ['painting_0140', '01:40', '苏棠完成画作，画中出现站务楼与第七名乘客。', 'investigation'],
    ['power_0210', '02:10', '电力恢复，白桦站站务楼可以进入。', 'investigation'],
    ['records_0240', '02:40', '程岳开始销毁调度记录；赶到可保住完整记录，迟到仍会留下残页。', 'investigation'],
    ['confession_0310', '03:10', '若信任足够，林晚会坦白并交出检修图。', 'investigation'],
    ['entrance_0340', '03:40', '积水下降，地下入口的线索浮现。', 'crisis'],
    ['seizure_0440', '04:40', '程岳与沈岐开始争夺录音、矿石和药物记录；危机爆发。', 'crisis'],
    ['departure_0510', '05:10', '发车广播响起，嫌疑人的立场公开；调查不再能无限扩张。', 'aftermath'],
    ['last_boarding_0550', '05:50', '最后登车警告：只能再做一次取舍。', 'aftermath'],
  ].map(([id, at, text, phase]) => ({ id, at, text, phase, fired: false, outcome: null })),
};
