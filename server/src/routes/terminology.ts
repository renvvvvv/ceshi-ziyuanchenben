/**
 * 数据中心 / 测试验证领域专业术语词典
 * 用于 AI 错别字审核时的领域知识注入
 *
 * 每项结构：
 *   - canonical: 规范写法（推荐使用）
 *   - aliases: 常见错误写法（会被识别为错别字）
 *   - en: 英文全称
 *   - desc: 简要说明（帮助 AI 理解）
 */

export interface Term {
  canonical: string;
  aliases: string[];
  en: string;
  desc: string;
}

export const TERMINOLOGY: Term[] = [
  // ===== 供配电系统 =====
  { canonical: 'UPS', aliases: ['ups', 'Ups', 'U.P.S'], en: 'Uninterruptible Power Supply', desc: '不间断电源，保证断电后持续供电' },
  { canonical: '柴油发电机组', aliases: ['柴油发电动机组', '柴油发电机', '发电机租', '发电机阻'], en: 'Diesel Generator Set', desc: '备用电源，市电断电后启动' },
  { canonical: '配电柜', aliases: ['配电拒', '配电轨'], en: 'Power Distribution Cabinet', desc: '分配电能的设备' },
  { canonical: '列头柜', aliases: ['列投柜', '列头拒'], en: 'Top-of-Rack Power Distribution Cabinet', desc: '机房内每列机柜的电源分配起点' },
  { canonical: 'PDU', aliases: ['pdu', 'Pdu'], en: 'Power Distribution Unit', desc: '电源分配单元，机柜内插座条' },
  { canonical: '母线', aliases: ['姆线', '拇线'], en: 'Busbar / Busway', desc: '用于大电流传输的导体' },
  { canonical: '变压器', aliases: ['变压气', '变压其'], en: 'Transformer', desc: '改变交流电压的电气设备' },
  { canonical: '开关电源', aliases: ['开关电源', '开官电源'], en: 'Switching Mode Power Supply', desc: '高频变换的电源模块' },
  { canonical: '蓄电池', aliases: ['蓄电瓶', '蓄电并'], en: 'Battery / Storage Battery', desc: 'UPS 后备电池组' },
  { canonical: '市电', aliases: ['试电', '是电'], en: 'Utility Power / Mains', desc: '城市公共电网提供的交流电' },
  { canonical: '双路市电', aliases: ['双路市店', '双路是电'], en: 'Dual Utility Feeds', desc: '两路独立市电，互为备份' },
  { canonical: 'ATS', aliases: ['ats'], en: 'Automatic Transfer Switch', desc: '自动转换开关，市电与柴发自动切换' },
  { canonical: 'STS', aliases: ['sts'], en: 'Static Transfer Switch', desc: '静态转换开关，市电与 UPS 输出切换' },
  { canonical: '功率因数', aliases: ['功率因速', '功率因素', '功率因束'], en: 'Power Factor', desc: '有功功率与视在功率之比' },
  { canonical: '谐波', aliases: ['斜波', '携波'], en: 'Harmonic', desc: '电力系统中的高次谐波分量' },

  // ===== 暖通空调 =====
  { canonical: '暖通空调', aliases: ['暖通空调', '暖通控调'], en: 'Heating, Ventilation and Air Conditioning (HVAC)', desc: '供热、通风、空调系统' },
  { canonical: '精密空调', aliases: ['精蜜空调', '紧蜜空调'], en: 'Precision Air Conditioner', desc: '机房专用恒温恒湿空调' },
  { canonical: '冷冻水', aliases: ['冷藏水', '冻冷水'], en: 'Chilled Water', desc: '空调系统中的载冷介质' },
  { canonical: '冷却塔', aliases: ['冷却他', '却冷塔'], en: 'Cooling Tower', desc: '通过水蒸发散热降温的设备' },
  { canonical: '冷站', aliases: ['冷栈', '冷占'], en: 'Chiller Plant', desc: '集中制冷的设备机房' },
  { canonical: '板换', aliases: ['板换热器', '扳换'], en: 'Plate Heat Exchanger', desc: '板式换热器' },
  { canonical: '蓄冷罐', aliases: ['蓄冷灌', '蓄冷官'], en: 'Thermal Storage Tank', desc: '蓄冷设备，用于削峰填谷' },
  { canonical: '加湿器', aliases: ['加温器', '加湿汽'], en: 'Humidifier', desc: '增加空气湿度的设备' },
  { canonical: '除湿机', aliases: ['除温机', '除湿汽'], en: 'Dehumidifier', desc: '降低空气湿度的设备' },
  { canonical: '风机盘管', aliases: ['风机盘官', '凤机盘管'], en: 'Fan Coil Unit (FCU)', desc: '末端空调设备' },
  { canonical: '新风系统', aliases: ['兴风系统', '新风系通'], en: 'Fresh Air System', desc: '引入室外新风的通风系统' },
  { canonical: '冷通道', aliases: ['冷通道', '冷同道'], en: 'Cold Aisle', desc: '服务器进气侧的冷空气通道' },
  { canonical: '热通道', aliases: ['热同道'], en: 'Hot Aisle', desc: '服务器出气侧的热空气通道' },

  // ===== 弱电 / 综合布线 =====
  { canonical: '弱电', aliases: ['若电', '若电系统'], en: 'Low-voltage / Weak Current', desc: '低于 36V 的电信号系统' },
  { canonical: '综合布线', aliases: ['综和布线', '总合布线'], en: 'Structured Cabling', desc: '楼宇弱电布线系统' },
  { canonical: '光纤', aliases: ['光迁', '光仟'], en: 'Optical Fiber', desc: '光导纤维通信介质' },
  { canonical: '跳线', aliases: ['条线', '跳纤'], en: 'Patch Cord / Fiber Jumper', desc: '配线架或设备间连接用线缆' },
  { canonical: '配线架', aliases: ['佩线架', '配线驾'], en: 'Patch Panel', desc: '线缆集中端接的设备' },
  { canonical: '机柜', aliases: ['机拒', '机轨'], en: 'Server Rack / Cabinet', desc: '安装服务器和网络设备的柜体' },

  // ===== 消防 / 安防 =====
  { canonical: '消防', aliases: ['消放', '销防'], en: 'Fire Protection', desc: '火灾防护系统' },
  { canonical: '气体灭火', aliases: ['气体灭火车', '气态灭火'], en: 'Gas Fire Suppression', desc: '机房常用洁净气体灭火' },
  { canonical: '烟感', aliases: ['烟甘', '烟杆'], en: 'Smoke Detector', desc: '烟雾探测器' },
  { canonical: '温感', aliases: ['温杆'], en: 'Heat Detector', desc: '温度探测器' },
  { canonical: '门禁', aliases: ['门进', '门尽'], en: 'Access Control', desc: '出入口控制系统' },
  { canonical: '视频监控', aliases: ['视屏监控', '视频监空'], en: 'Video Surveillance / CCTV', desc: '闭路电视监控系统' },
  { canonical: '漏水检测', aliases: ['漏水检测', '留水检测'], en: 'Water Leak Detection', desc: '机房防漏水报警系统' },

  // ===== 监控 / 运维 =====
  { canonical: '动环监控', aliases: ['动环监空', '动环监控'], en: 'Power & Environment Monitoring', desc: '动力环境监控系统' },
  { canonical: '温湿度', aliases: ['温湿渡'], en: 'Temperature & Humidity', desc: '机房环境参数' },
  { canonical: 'PUE', aliases: ['pue', 'Pue'], en: 'Power Usage Effectiveness', desc: '电源使用效率，电总/IT 设备电' },
  { canonical: 'SLA', aliases: ['sla', 'Sla'], en: 'Service Level Agreement', desc: '服务等级协议，可用性指标' },
  { canonical: '机柜U位', aliases: ['机柜U位', '机柜U维'], en: 'Rack U-Space', desc: '机柜内垂直安装高度，1U=44.45mm' },
  { canonical: '承重', aliases: ['成重', '承众'], en: 'Load-bearing Capacity', desc: '楼板承载能力' },
  { canonical: 'IDC', aliases: ['idc'], en: 'Internet Data Center', desc: '互联网数据中心' },
  { canonical: '宕机', aliases: ['当机', '档机'], en: 'Downtime / Outage', desc: '设备或服务不可用' },

  // ===== 测试 / 验证 / 文档通用词 =====
  { canonical: '联调测试', aliases: ['连调测试', '联调试'], en: 'Integrated Commissioning Test', desc: '多系统联合调试' },
  { canonical: '单体调试', aliases: ['单体调试', '单体调示'], en: 'Single-unit Commissioning', desc: '单台设备调试' },
  { canonical: '带电测试', aliases: ['带电测试', '代电测试'], en: 'Live Test', desc: '设备带电运行状态下的测试' },
  { canonical: '耐压测试', aliases: ['耐压测试', '奈压测试'], en: 'Withstand Voltage Test', desc: '电气绝缘强度测试' },
  { canonical: '绝缘电阻', aliases: ['绝源电阻', '决缘电阻'], en: 'Insulation Resistance', desc: '用兆欧表测量的绝缘值' },
  { canonical: '接地电阻', aliases: ['接地电阻', '结地电阻'], en: 'Grounding Resistance', desc: '接地装置的电阻值' },
  { canonical: '验收测试', aliases: ['验收测试', '验受测试'], en: 'Acceptance Test', desc: '业主/监理对成果的检验测试' },
  { canonical: '试运行', aliases: ['试行'], en: 'Trial Run', desc: '正式投运前的测试运行' },
  { canonical: '工程实施', aliases: ['工程实失'], en: 'Implementation', desc: '工程落地执行' },
  { canonical: '上线运行', aliases: ['上先运行', '上线运'], en: 'Go-Live', desc: '系统正式投入运行' },

  // ===== 文档写作常见错字（不属于专业词但易出错） =====
  { canonical: '测试', aliases: ['测度', '测式'], en: 'Test', desc: '' },
  { canonical: '验证', aliases: ['险证'], en: 'Verification', desc: '' },
  { canonical: '配置', aliases: ['佩置'], en: 'Configuration', desc: '' },
  { canonical: '部署', aliases: ['布署'], en: 'Deployment', desc: '' },
  { canonical: '运行', aliases: ['运做'], en: 'Operation', desc: '' },
  { canonical: '响应', aliases: ['响应', '向应'], en: 'Response', desc: '' },
  { canonical: '端口', aliases: ['断口', '端口'], en: 'Port', desc: '' },
  { canonical: '状态', aliases: ['壮态'], en: 'Status', desc: '' },
  { canonical: '完整', aliases: ['完正'], en: 'Complete', desc: '' },
  { canonical: '已配置', aliases: ['以配置', '已佩置'], en: 'Configured', desc: '' },
];

/**
 * 把术语词典格式化成可注入到 system prompt 的中文字符串
 */
export function buildTerminologyPrompt(): string {
  const lines = TERMINOLOGY.map((t) => {
    if (t.aliases.length === 0) return `- ${t.canonical}${t.en ? ` (${t.en})` : ''}`;
    return `- ${t.canonical}${t.en ? ` (${t.en})` : ''}：常见错写 ${t.aliases.join('、')}${t.desc ? `。${t.desc}` : ''}`;
  });
  return `【专业术语词典（数据中心/测试验证领域）】\n以下术语在文档中应使用规范写法，如出现别名视为错别字：\n${lines.join('\n')}`;
}

/**
 * 几个典型 Few-shot 示例：让 AI 学会"什么样的输出"是合格的
 */
export const FEW_SHOT_EXAMPLES = [
  {
    input: '本项目供电采用双路市电接入，主用电源取自市东变电站，备用电源取自市南变电站。柴发机租作为冷备份，在双路失电后延时 15 秒启动。',
    output: {
      errors: [
        {
          original: '柴发机租',
          suggestion: '柴油发电机组',
          context: '作为冷备份',
        },
      ],
    },
  },
  {
    input: '本次单体调试和联调测试全部完成，所有精密空调已带电测试，功率因素达到 0.95 以上。',
    output: {
      errors: [
        {
          original: '功率因素',
          suggestion: '功率因数',
          context: '达到 0.95 以上',
        },
      ],
    },
  },
];
