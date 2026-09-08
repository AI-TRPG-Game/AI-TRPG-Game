export const BIRCH_STATION_ID = 'birch-station-onboarding-v1';

const player = `姓名：调查记者\n年龄：31\n性别：不限\n职业：调查记者\n性格：谨慎、执拗，习惯把疑点记进随身笔记。\n人物肖像与重要经历：顾言在失踪前寄来半段录音，并在信中警告“不要听完整段录音”。你循着邮戳登上了雨夜的雾港号。\nHP：11  SAN：60  信用评级：40\n侦查：60  图书馆使用：55  说服：50  聆听：55  心理学：45  闪避：35`;

export const BIRCH_STATION_TUTORIAL = {
  id: BIRCH_STATION_ID,
  title: '新手试炼：白桦站的末班车',
  worldSettings: '1929年深秋，暴雨中的雾港号停靠在废弃白桦站。列车内发生了一桩看似密室的谋杀；调查会逐步滑向与矿难旧案和异常资料有关的心理恐怖。',
  player,
  scenarioRules: {
    time: { minimumMinutes: 10, maximumMinutes: 60 },
    initialLocationId: 'loc_001',
    // 这些地点在开局即已写好，但只有被探索或由计划事件揭示后才加入玩家侧边栏。
    locationCatalog: {
      loc_001: { name: '头等包厢外', description: '顾言的反锁包厢前，狭窄走廊被雨声和昏黄壁灯填满。' },
      loc_002: { name: '行李车', description: '堆满旅行箱和检修工具的车厢，通往车顶的梯门上有水迹。' },
      loc_003: { name: '白桦站站台', description: '积水淹过石缝，倾斜的站牌后方，尽头那盏信号灯仍在雨里闪烁。' },
      loc_004: { name: '车顶检修通道', description: '湿滑的金属梯通向车顶，泥水脚印在雨幕中延向本该封死的通道。' },
      loc_005: { name: '站务楼候车厅', description: '褪色时刻表下散着潮湿座椅，墙上的旧画框正对着废弃月台。' },
      loc_006: { name: '站务办公室', description: '恢复供电后才能打开的办公室，调度台与钥匙柜仍保留着最后一次值班的痕迹。' },
      loc_007: { name: '医疗档案室', description: '办公室内侧的窄门后堆满转运表和封蜡病历，空气里有陈旧消毒水味。' },
      loc_008: { name: '乘务员休息室', description: '许薇和林晚暂时避雨的狭小房间，墙上贴着褪色的检修班表。' },
      loc_009: { name: '积水地下入口', description: '站务楼地下的铁门后积水渐退，冷风从黑暗深处带来矿石的腥味。' },
      loc_010: { name: '矿难转运室', description: '地下甬道尽头的封闭转运室，留下了矿难后从未公开的货物与名单。' },
    },
    // 用于判断玩家能否及时介入相邻地点的事件，也为后续统一计算移动耗时提供基础。
    locationGraph: {
      loc_001: ['loc_002', 'loc_003'],
      loc_002: ['loc_001', 'loc_004'],
      loc_003: ['loc_001', 'loc_005'],
      loc_004: ['loc_002'],
      loc_005: ['loc_003', 'loc_006', 'loc_008'],
      loc_006: ['loc_005', 'loc_007', 'loc_009'],
      loc_007: ['loc_006'],
      loc_008: ['loc_005'],
      loc_009: ['loc_006', 'loc_010'],
      loc_010: ['loc_009'],
    },
    // SAN 事件由剧本作者定义，模型只能从当前可用事件中选择；解析器会强制使用这里的严重度和目标。
    sanEvents: {
      san_signal_0040: { at: '00:40', locationId: 'loc_003', severity: 'unease', target: 'player', label: '站台尽头本不该亮起的信号灯' },
      san_blackout_0110: { at: '01:10', locationId: 'loc_002', severity: 'major', target: 'player', label: '停电后手提箱里传出的第二段呼吸声' },
      san_portrait_0140: { at: '01:40', locationId: 'loc_005', severity: 'major', target: 'player', label: '画中第七名乘客转过头来' },
      san_records_0240: { at: '02:40', locationId: 'loc_007', severity: 'major', target: 'player', label: '被篡改的医疗转运记录' },
      san_confession_0310: { at: '03:10', locationId: 'loc_008', severity: 'major', target: 'player', label: '幸存者供词中不可能存在的第七个人' },
      san_depths_0340: { at: '03:40', locationId: 'loc_009', severity: 'catastrophe', target: 'player', label: '地下入口积水下的异常矿物' },
    },
    clueCatalog: {
      evidence_001: { category: 'murder', source: '包厢门锁', reliability: 'medium', description: '锁芯内侧有新鲜刮痕，说明门锁可能从外部被动过。', discoveryHint: '检查顾言包厢的门锁、门框和反锁结构。', locationId: 'loc_001', keywords: ['门锁', '门框', '反锁', '锁芯'], truths: ['murder'] },
      evidence_002: { category: 'murder', source: '地毯湿泥', reliability: 'medium', description: '地毯上的湿泥来自关闭的车顶通道。', discoveryHint: '在包厢门口或行李车检查湿泥的颗粒与来源。', locationId: 'loc_001', keywords: ['湿泥', '泥', '地毯', '脚印'], truths: ['murder'] },
      evidence_003: { category: 'murder', source: '针孔与医疗记录', reliability: 'high', description: '死因被伪装成急病，实际与镇静剂注射有关。', discoveryHint: '检查尸体手臂针孔，并把它和医疗档案室的记录互相核对。', locationId: 'loc_007', locationIds: ['loc_001', 'loc_007'], keywords: ['针孔', '针眼', '镇静剂', '注射', '死因'], truths: ['murder', 'culprit'] },
      evidence_004: { category: 'survivor', source: '顾言的录音', reliability: 'high', description: '失踪的录音提到矿难后仍有第七名幸存者。', discoveryHint: '修复或完整听取顾言留下的录音，记录“第七个人”的原话。', locationId: 'loc_001', keywords: ['录音', '录音带', '第七个人', '完整听'], truths: ['seventh_survivor'] },
      evidence_005: { category: 'coverup', source: '调度记录', reliability: 'high', description: '调度日志被改写，用来掩盖一次未登记的转运。', discoveryHint: '在站务办公室找到原始调度记录，或在程岳销毁前抢救残页。', locationId: 'loc_006', keywords: ['调度', '日志', '残页', '转运记录'], truths: ['coverup', 'culprit'] },
      evidence_006: { category: 'survivor', source: '苏棠的画与乘客名册', reliability: 'high', description: '画作和名册共同证明第七名幸存者从官方人数中被抹掉。', discoveryHint: '询问苏棠并比对她的画与乘客名册，不要只凭口述。', locationId: 'loc_005', keywords: ['苏棠', '画', '画作', '名册', '第七名'], truths: ['seventh_survivor'] },
      evidence_007: { category: 'coverup', source: '医疗转运档案', reliability: 'high', description: '医疗文件把矿难幸存者与白桦站的转运联系起来。', discoveryHint: '在医疗档案室寻找封蜡病历和转运表，注意日期与签名。', locationId: 'loc_007', keywords: ['医疗', '档案', '病历', '转运表', '封蜡'], truths: ['coverup'] },
      evidence_008: { category: 'culprit', source: '林晚的证词', reliability: 'high', description: '证词把共谋者、篡改记录和死者放在同一条行动链上。', discoveryHint: '先取得林晚信任，再让她在安全地点交出检修图并说明见闻。', locationId: 'loc_008', keywords: ['林晚', '检修图', '证词', '见闻', '检修班表'], truths: ['culprit'] },
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

候车厅里还有一位撑着湿画布的乘客苏棠。她是替报社画插图的年轻画师，停电前一直在画白桦站；她说画里原本只有六个人，却不肯解释为什么第七个身影总在下一笔之后出现。乘务员休息室里则有林晚——白桦站临时检修员，今晚负责看管旧站的钥匙和检修班表。她对顾言的死表现得过分平静，只说自己“没有离开过休息室”。这两个人都不是陌生的路人：她们的证词和手里的东西，可能分别连接着画、调度记录与地下通道。

你以调查记者的身份可以提问、记录、比对说辞，也可以不按任何人的安排行动。但从现在起，每一次停留都会消耗时间：06:00，雾港号将恢复通行，白桦站和车上的人都会被雨幕带走。

包厢门锁内侧有一道新鲜刮痕，地毯边缘黏着不属于车厢的湿泥。顾言随身的半段录音还在你的口袋里，另一半却不见踪影。

你的目标是查明顾言的死因、保全足以指向真相的证据，并在列车开动前决定那些异常资料该被公开、带走，还是永远留在这场雨里。

在你开始前，先把眼前的人记清：

- **顾言**：你的同行与朋友，也是把你引到白桦站的人。他已经死在反锁的包厢里；他的笔记、录音和最后一次见到的人，都是这起案件的起点。
- **沈岐医生**：列车临时随车医生。他急着把死因定成“急病”，却刻意避开尸体手臂上的针孔；他现在就在包厢内。
- **许薇**：年轻乘务员。她负责这节车厢，知道停站前的争吵，也握着可能通往其他区域的调度钥匙。她明显害怕，却未必会立刻说真话。
- **程岳**：一名尚未露面的工程顾问。顾言的笔记里多次出现与他相近的姓氏，以及“第七个人”这个被涂掉的称呼。
- **苏棠**：在白桦站候车厅作画的乘客。她的画可能记录了官方名单里被抹去的第七个人，但她需要先确认你不会把画交给沈岐。
- **林晚**：白桦站临时检修员，掌握旧站的钥匙与检修班表。她知道地下入口何时开放，却只有在确信你会保护她和证据时才会开口。

**新手引导**

你可以点击下方选项，也可以直接输入任何行动，例如“检查针孔”“追问许薇刚才听见什么”“去行李车比对湿泥”或“把录音带交给医生观察”。主持人会根据行动推进故事；需要冒险时会出现检定确认，确认后由系统掷骰并说明结果。

每次有效行动都会推进游戏内时间。列车会在 **06:00** 发车，因此搜查、移动和长谈都要有所取舍；时间到达关键节点时，新地点、人物动向和危机会出现。左侧地点栏会逐步加入你已经发现的区域，并以“你在此”标出当前位置。

证据只有在被**取得或保全**后才能支撑你在结局时揭露真相。公开逼问、强行搜查或惊动嫌疑人会提高怀疑度，令行动变慢、证据更难保护。遭遇不该理解的事物时，SAN 会下降；低 SAN 会给主动检定带来惩罚，单次重度损失还可能留下短期创伤。

你不是在寻找唯一正确的选项。记录矛盾、保护证据、判断何时相信或施压，都是调查的一部分。雨声盖住了列车外的脚步声——现在，顾言的包厢门锁正等着你伸手。`,
    options: ['A. 检查包厢门锁、针孔与地毯湿泥', 'B. 询问在场的沈医生和乘务员许薇', 'C. 搜查顾言遗留的行李与采访笔记', 'D. 自由行动'],
  },
  locations: [
    { id: 'loc_001', name: '头等包厢外', description: '顾言的反锁包厢前，狭窄走廊被雨声和昏黄壁灯填满。', firstSeenAt: 0, lastUpdatedAt: 0 },
    { id: 'loc_002', name: '行李车', description: '堆满旅行箱和检修工具的车厢，通往车顶的梯门上有水迹。', firstSeenAt: 0, lastUpdatedAt: 0 },
    { id: 'loc_003', name: '白桦站站台', description: '积水淹过石缝，倾斜的站牌后方，尽头那盏信号灯仍在雨里闪烁。', firstSeenAt: 0, lastUpdatedAt: 0 },
    { id: 'loc_005', name: '站务楼候车厅', description: '褪色时刻表下散着潮湿座椅，墙上的旧画框正对着废弃月台。', firstSeenAt: 0, lastUpdatedAt: 0 },
    { id: 'loc_008', name: '乘务员休息室', description: '许薇和林晚暂时避雨的狭小房间，墙上贴着褪色的检修班表。', firstSeenAt: 0, lastUpdatedAt: 0 },
  ],
  npcs: [
    { id: 'npc_000', name: '调查记者', baseDescription: '追查顾言失踪前录音的调查记者。', currentState: '站在包厢门外，尚未开始调查。', locationId: 'loc_001', importance: 'player', hp: 11, maxHp: 11, san: 60, maxSan: 60, visibility: 'visible', status: 'active', attributes: null, firstSeenAt: 0, lastUpdatedAt: 0 },
    { id: 'npc_001', name: '沈岐医生', baseDescription: '衣着整洁的随车医生，急于将死亡定为意外。', currentState: '避开尸体旁的针孔，催促乘务员封锁包厢。', locationId: 'loc_001', importance: 'key', hp: 9, maxHp: 9, san: 45, maxSan: 45, visibility: 'visible', status: 'active', attributes: null, firstSeenAt: 0, lastUpdatedAt: 0 },
    { id: 'npc_002', name: '许薇', baseDescription: '年轻乘务员，记得列车停电前后的异常。', currentState: '脸色苍白，紧攥着调度钥匙。', locationId: 'loc_001', importance: 'key', hp: 8, maxHp: 8, san: 50, maxSan: 50, visibility: 'visible', status: 'active', attributes: null, firstSeenAt: 0, lastUpdatedAt: 0 },
    { id: 'npc_003', name: '程岳', baseDescription: '自称工程顾问的乘客，与白桦站旧矿难有关。', currentState: '尚未公开露面。', locationId: 'loc_006', importance: 'key', hp: 10, maxHp: 10, san: 40, maxSan: 40, visibility: 'hidden', status: 'active', attributes: null, firstSeenAt: 0, lastUpdatedAt: 0 },
    { id: 'npc_004', name: '苏棠', baseDescription: '替报社画插图的年轻画师，停电前在白桦站候车厅作画。', currentState: '守着一幅尚未干透的画，不愿解释画中多出的第七个人。', locationId: 'loc_005', importance: 'supporting', hp: null, maxHp: null, san: null, maxSan: null, visibility: 'visible', status: 'active', attributes: null, firstSeenAt: 0, lastUpdatedAt: 0 },
    { id: 'npc_005', name: '林晚', baseDescription: '白桦站临时检修员，负责旧站钥匙、检修班表和地下入口。', currentState: '在乘务员休息室整理班表，声称自己没有离开过。', locationId: 'loc_008', importance: 'key', hp: null, maxHp: null, san: null, maxSan: null, visibility: 'visible', status: 'active', attributes: null, firstSeenAt: 0, lastUpdatedAt: 0 },
  ],
  inventory: [
    { id: 'item_001', name: '顾言的半段录音', status: '已获得', description: '录音在最关键处中断，信中警告不要听完整段。', firstSeenAt: 0, lastUpdatedAt: 0 },
  ],
  evidence: [
    { id: 'evidence_001', category: 'murder', source: '包厢门锁', reliability: 'medium', secured: false, discovered: true, description: '锁芯内侧有新鲜刮痕。' },
    { id: 'evidence_002', category: 'murder', source: '地毯湿泥', reliability: 'medium', secured: false, discovered: true, description: '湿泥来自不应开放的车顶通道。' },
  ],
  scheduledEvents: [
    {
      id: 'broadcast_0040', at: '00:40', phase: 'hook', priority: 30,
      placement: { mode: 'global' }, status: 'dormant', fired: false, outcome: null,
      branches: {
        foreground: {
          outcome: 'broadcast_heard',
          instruction: '把要求乘客留在车内的广播作为当前场景内所有人都能听见的变化；它开放行动空间，但不要替玩家决定去向。',
          playerCue: '头顶的旧广播突然滋啦作响，乘务长反复要求所有乘客留在车内，站台方向随即传来仓促落锁的声音。',
          setFlags: { passenger_restriction_announced: true },
        },
      },
    },
    {
      id: 'blackout_0110', at: '01:10', phase: 'investigation', priority: 90,
      placement: { mode: 'global', focusLocationId: 'loc_001' }, status: 'dormant', fired: false, outcome: null,
      branches: {
        present: {
          outcome: 'blackout_intervention_window',
          instruction: '立刻让人为停电打断玩家的行动。玩家与许薇同处包厢走廊，必须给玩家发现、保护她或追逐调包者的机会；不要预先断言她必然昏倒或手提箱必然被调包。',
          playerCue: '灯光毫无预兆地熄灭。黑暗中，许薇失去平衡，却仍死死攥着调度钥匙；近处同时响起手提箱锁扣被碰动的轻响。',
          npcUpdates: { npc_002: { currentState: '停电骤临，她失去平衡并仍紧攥调度钥匙。' } },
          revealsLocations: ['loc_004'], setFlags: { blackout_started: true },
        },
        remote: {
          outcome: 'blackout_remote',
          instruction: '立刻让全站停电打断玩家的行动。玩家不在许薇身边，只能感知黑暗、列车异响和远处短促的动静；不要直接透露谁昏倒或谁调包了手提箱。',
          playerCue: '全站灯光骤然熄灭，列车方向传来一声短促撞击和金属锁扣的轻响，但黑暗与雨声遮住了那里究竟发生了什么。',
          npcUpdates: { npc_002: { currentState: '停电中在包厢走廊遭到袭击，去向暂时不明。' } },
          aftermathInstruction: '玩家回到头等包厢外时，呈现许薇遇袭和手提箱被动过的可观察余波，并留下通往车顶检修通道的水迹；不要提供玩家未调查出的幕后身份。',
          aftermathPlayerCue: '回到包厢走廊后，你发现许薇曾在黑暗中遇袭，手提箱锁扣有被撬动的痕迹，地上的水迹则一路指向车顶检修通道。',
          aftermathLocationId: 'loc_001', leavesAftermath: true,
          revealsLocations: ['loc_004'], setFlags: { blackout_started: true, suitcase_tampered_offscreen: true },
        },
      },
    },
    {
      id: 'painting_0140', at: '01:40', latestAt: '02:20', phase: 'investigation', priority: 35,
      placement: { mode: 'fixed', locationId: 'loc_005' }, absencePolicy: 'defer', status: 'dormant', fired: false, outcome: null,
      branches: {
        present: { outcome: 'painting_witnessed', instruction: '苏棠在玩家面前补完画作，第七个身影在最后一笔后出现。只呈现可观察异常，并让玩家决定如何询问或检查。', playerCue: '苏棠落下最后一笔时，湿画布上原本空着的位置缓慢显出第七道人影；她手中的画笔当场跌落。' },
        nearby: { outcome: 'painting_intercept', instruction: '玩家在相邻区域听见苏棠惊呼，可以赶到候车厅查看刚完成的画作。', playerCue: '候车厅方向突然传来苏棠压抑不住的惊呼，紧接着是画笔落地的脆响。' },
        expired: { outcome: 'painting_completed_offscreen', playerCue: '候车厅方向传来一声短促惊呼，随后彻底安静下来；那里的某件事已经发生。', leavesAftermath: true, aftermathLocationId: 'loc_005', aftermathInstruction: '玩家进入候车厅后发现苏棠已经完成画作；画上异常仍可调查。', aftermathPlayerCue: '候车厅里的画已经完成，湿润颜料间多出一道不属于任何已知乘客的第七个人影。' },
      },
    },
    {
      id: 'power_0210', at: '02:10', phase: 'investigation', priority: 45,
      placement: { mode: 'global' }, status: 'dormant', fired: false, outcome: null,
      branches: {
        foreground: {
          outcome: 'power_restored',
          instruction: '让电力恢复成为所有地点都能感知的环境变化，并说明站务办公室现在可以进入；不要强迫玩家前往。',
          playerCue: '整座站务楼的电灯接连亮起，封闭的站务办公室门锁发出复位声，门缝里透出久违的昏黄灯光。',
          revealsLocations: ['loc_006'], setFlags: { power_restored: true },
        },
      },
    },
    {
      id: 'records_0240', at: '02:40', latestAt: '03:00', phase: 'investigation', priority: 95,
      placement: { mode: 'fixed', locationId: 'loc_006', requiredParticipants: ['npc_003'] },
      absencePolicy: 'resolve_offscreen', status: 'dormant', fired: false, outcome: null,
      branches: {
        present: {
          outcome: 'records_intervention_window',
          instruction: '玩家就在站务办公室时撞见程岳准备销毁调度记录。呈现正在发生、可阻止的行为；不要直接判定记录得救或毁坏，必要时请求检定。',
          playerCue: '站务办公室里骤然腾起焦纸味：程岳正把一叠调度记录送向火焰，你还有机会阻止他。',
          npcUpdates: { npc_003: { visibility: 'visible', locationId: 'loc_006', currentState: '被撞见正在处理调度记录，必须立即应对玩家。' } },
          revealsLocations: ['loc_007'], setFlags: { records_crisis_started: true },
        },
        nearby: {
          outcome: 'records_intercept_window',
          instruction: '玩家在站务办公室相邻区域闻到焦纸味或听见柜门声，仍有短暂机会赶去阻止程岳；不要提前决定结果。',
          playerCue: '站务办公室方向飘来新鲜的焦纸味，柜门与金属桶接连碰响；有人正在匆忙毁掉文件。',
          npcUpdates: { npc_003: { locationId: 'loc_006', currentState: '正在站务办公室匆忙销毁调度记录。' } },
          revealsLocations: ['loc_007'], setFlags: { records_crisis_started: true },
        },
        absent: {
          outcome: 'records_partially_destroyed',
          instruction: '让玩家从当前地点感知站务楼方向的烟味、火光或异常动静，但不要透露是谁在烧毁什么；明确这会造成需要追查的后果。',
          playerCue: '一股焦纸味混进潮湿空气，站务楼某扇窗后闪过不自然的火光；等你注意到时，那里的动静已经停了。',
          leavesAftermath: true, aftermathLocationId: 'loc_006',
          npcUpdates: { npc_003: { locationId: 'loc_006', currentState: '已经销毁大部分调度记录并离开现场。' } },
          aftermathInstruction: '玩家后来进入站务办公室时，只能发现烧焦残页、灰烬和匆忙离开的痕迹；残页仍须保证提供一条较弱但可用的线索路径。',
          aftermathPlayerCue: '站务办公室只剩一桶灰烬和几张烧焦残页；大部分调度记录已被毁掉，但残存的日期与编号仍能继续追查。',
          revealsLocations: ['loc_007'], setFlags: { records_partially_destroyed: true },
        },
      },
    },
    {
      id: 'confession_0310', at: '03:10', latestAt: '04:10', phase: 'investigation', priority: 75,
      placement: { mode: 'fixed', locationId: 'loc_008', requiredParticipants: ['npc_005'] },
      absencePolicy: 'defer', status: 'dormant', fired: false, outcome: null,
      branches: {
        present: {
          outcome: 'confession_conversation',
          instruction: '林晚愿意试探性开口，但完整供词和检修图取决于玩家是否承诺保护她与证据。先进行一段可回应的信任对话，不要无条件一次性交出全部真相。',
          playerCue: '林晚反锁休息室的门，压低声音问你是否真能保护她和那些记录；她的手始终按在藏有检修图的柜门上。',
          npcUpdates: { npc_005: { locationId: 'loc_008', currentState: '决定试探玩家是否值得信任，准备谈及检修图。' } },
          setFlags: { lin_wan_ready_to_talk: true },
        },
        nearby: {
          outcome: 'confession_invitation',
          instruction: '林晚从休息室找到或叫住附近的玩家，低声提出只在安全处谈话；让玩家决定是否跟随并承诺保护她。',
          playerCue: '林晚从休息室方向追来，低声叫住你，只说自己知道地下入口的事，但必须先换到一个安全的地方。',
          npcUpdates: { npc_005: { currentState: '主动寻找玩家，要求在安全处私下谈话。' } },
          setFlags: { lin_wan_ready_to_talk: true },
        },
        expired: {
          outcome: 'confession_note_hidden',
          instruction: '让玩家察觉林晚已经离开休息室并刻意留下了一条可追查的藏匿提示，不要把提示等同于完整供词。',
          playerCue: '远处传来休息室门仓促合拢的声音；林晚没有等到可信的回应，但她留下的动静像是在刻意引人寻找什么。',
          leavesAftermath: true, aftermathLocationId: 'loc_008',
          npcUpdates: { npc_005: { currentState: '未能等到可信回应，藏起检修图后离开休息室。' } },
          aftermathInstruction: '玩家后来进入休息室时可发现林晚仓促留下的藏匿提示；它不能等同完整证词，但必须保留通往检修图的替代路线。',
          aftermathPlayerCue: '休息室已经空了，柜门内侧却留着林晚仓促刻下的记号，指向她藏起检修图的位置。',
          setFlags: { lin_wan_left_hidden_hint: true },
        },
      },
    },
    {
      id: 'entrance_0340', at: '03:40', phase: 'crisis', priority: 50,
      placement: { mode: 'global' }, status: 'dormant', fired: false, outcome: null,
      branches: {
        foreground: {
          outcome: 'water_receded',
          instruction: '用排水声、风向和积水变化让玩家得知地下入口已经露出；这是新选择而非强制路线。',
          playerCue: '站务楼下方响起持续的排水轰鸣，积水退去后，一扇通往地下的锈蚀铁门终于露了出来。',
          revealsLocations: ['loc_009'], setFlags: { underground_entrance_open: true },
        },
      },
    },
    {
      id: 'seizure_0440', at: '04:40', phase: 'crisis', priority: 100,
      placement: { mode: 'player_current', requiredParticipants: ['npc_003', 'npc_001'] },
      status: 'dormant', fired: false, outcome: null,
      branches: {
        foreground: {
          outcome: 'evidence_seizure_confrontation',
          instruction: '把程岳与沈岐对关键证据的争夺带到玩家当前地点，但只有在说明他们追踪到玩家或证据的合理路径后才让两人现身。他们目标不同，给玩家保护证据、谈判、逃脱或利用分歧的机会。',
          playerCue: '追踪证据而来的脚步从两侧逼近：程岳与沈岐先后堵住去路，却各自要求你把关键资料交给他。',
          npcUpdates: {
            npc_003: { visibility: 'visible', currentState: '追踪到玩家所在区域，准备强夺关键证据。' },
            npc_001: { currentState: '来到玩家所在区域，试图带走药物记录和异常资料。' },
          },
          combatUpdate: { active: true, round: 1, objective: '保护证据或脱离围堵', exitConditions: ['证据被安全转移', '玩家成功撤离', '对手退让或互相背叛'], participants: ['npc_000', 'npc_001', 'npc_003'] },
          moveParticipantsToScene: true,
          revealsLocations: ['loc_010'], setFlags: { seizure_confrontation_started: true },
        },
      },
    },
    {
      id: 'departure_0510', at: '05:10', phase: 'aftermath', priority: 85,
      placement: { mode: 'global' }, status: 'dormant', fired: false, outcome: null,
      branches: {
        foreground: { outcome: 'departure_warning', instruction: '让发车广播和人员公开站队收缩调查空间，引导玩家开始处理证据和最终立场，但仍保留行动选择。', playerCue: '雾港号第一次拉响发车预备汽笛，乘务员开始封闭车门；留给调查和转移证据的时间已经所剩无几。', setFlags: { departure_warning_given: true } },
      },
    },
    {
      id: 'last_boarding_0550', at: '05:50', phase: 'aftermath', priority: 110,
      placement: { mode: 'global' }, status: 'dormant', fired: false, outcome: null,
      branches: {
        foreground: { outcome: 'last_choice_window', instruction: '发出最后登车警告，明确玩家只剩一次关键取舍。给出的结局选项必须使用“最终决定：公开真相 / 最终决定：保全并带走证据 / 最终决定：销毁或压下真相 / 最终决定：撤离白桦站”这类明确措辞，避免把普通移动误判为最终选择。', playerCue: '最后登车警告穿透雨幕，车门即将关闭；你必须决定如何处置已经掌握的真相与证据。', setFlags: { final_choice_requested: true } },
      },
    },
  ],
};
