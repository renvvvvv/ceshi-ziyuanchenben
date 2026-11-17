/**
 * 测试公式速查 - 数据定义
 * 每个公式包含：公式文本、输入参数、计算函数、判定标准
 */

export type FormulaCategory = 'electrical' | 'hvac' | 'weak' | 'fire' | 'general';

export interface FormulaInput {
  key: string;
  label: string;
  unit: string;
  defaultValue?: number;
  placeholder?: string;
  select?: Array<{ label: string; value: number }>;
}

export interface FormulaJudgment {
  operator: '<=' | '>=' | '|' | 'range' | 'abs<=';
  threshold?: number;
  range?: [number, number];
  passText: string;
  failText: string;
}

export interface FormulaDef {
  id: string;
  category: FormulaCategory;
  title: string;
  formulaText: string;
  inputs: FormulaInput[];
  compute: (v: Record<string, number>) => number;
  resultUnit: string;
  resultLabel: string;
  resultScale?: number; // 小数位数
  judgment?: FormulaJudgment;
  standard?: string;
  note?: string;
}

export const CATEGORY_LABELS: Record<FormulaCategory, string> = {
  electrical: '电气',
  hvac: '暖通',
  weak: '弱电',
  fire: '消防',
  general: '通用',
};

export const CATEGORY_ICONS: Record<FormulaCategory, string> = {
  electrical: '⚡',
  hvac: '❄️',
  weak: '📡',
  fire: '🔥',
  general: '📊',
};

export const FORMULAS: FormulaDef[] = [
  // ==================== 电气 ====================
  {
    id: 'ups-vr',
    category: 'electrical',
    title: '稳压精度（UPS）',
    formulaText: 'η = |V实 - V额| / V额 × 100%',
    inputs: [
      { key: 'rated', label: '额定输出电压', unit: 'V', defaultValue: 380 },
      { key: 'measured', label: '实测输出电压', unit: 'V', placeholder: '381.9' },
    ],
    compute: (v) => Math.abs(v.measured - v.rated) / v.rated * 100,
    resultUnit: '%',
    resultLabel: '稳压精度',
    resultScale: 2,
    judgment: {
      operator: '<=',
      threshold: 1,
      passText: '合格（在线式 UPS 标准 ≤ ±1%）',
      failText: '不合格（超出 ±1%，检查 UPS 稳压模块）',
    },
    standard: 'GB/T 7260.3',
    note: '后备式 UPS 放宽至 ±3%',
  },
  {
    id: 'steady-v-dev',
    category: 'electrical',
    title: '稳态电压偏差',
    formulaText: 'ΔU = (V实 - V标) / V标 × 100%',
    inputs: [
      { key: 'nominal', label: '标称电压', unit: 'V', defaultValue: 380 },
      { key: 'measured', label: '实测电压', unit: 'V', placeholder: '368' },
    ],
    compute: (v) => (v.measured - v.nominal) / v.nominal * 100,
    resultUnit: '%',
    resultLabel: '电压偏差',
    resultScale: 2,
    judgment: {
      operator: '|',
      threshold: 7,
      passText: '合格（380V 系统允许 ±7%）',
      failText: '不合格（超出 ±7%，检查变压器分接头或线路压降）',
    },
    standard: 'GB/T 12325',
    note: '正值为偏高，负值为偏低',
  },
  {
    id: 'gen-v-transient',
    category: 'electrical',
    title: '柴发电压瞬态偏差',
    formulaText: 'ΔV = (V瞬 - V稳) / V稳 × 100%',
    inputs: [
      { key: 'steady', label: '稳态电压', unit: 'V', defaultValue: 400 },
      { key: 'transient', label: '突变后瞬时电压', unit: 'V', placeholder: '342' },
      { key: 'type', label: '负载变化', unit: '', select: [
        { label: '突加负载', value: 1 },
        { label: '突卸负载', value: 2 },
      ] },
    ],
    compute: (v) => (v.transient - v.steady) / v.steady * 100,
    resultUnit: '%',
    resultLabel: '瞬态电压偏差',
    resultScale: 1,
    judgment: {
      operator: 'range',
      range: [-15, 20],
      passText: '合格（G3级：突加 ≤ -15%，突卸 ≤ +20%，恢复 ≤ 4s）',
      failText: '不合格（超出 G3 级限值，检查 AVR 调节）',
    },
    standard: 'GB/T 2820.5 / ISO 8528-5',
    note: '突加负载电压跌落（负值），突卸负载电压跃升（正值）',
  },
  {
    id: 'gen-f-transient',
    category: 'electrical',
    title: '柴发频率瞬态偏差',
    formulaText: 'Δf = (f瞬 - f额) / f额 × 100%',
    inputs: [
      { key: 'rated', label: '额定频率', unit: 'Hz', defaultValue: 50 },
      { key: 'transient', label: '突变后瞬时频率', unit: 'Hz', placeholder: '45.5' },
    ],
    compute: (v) => (v.transient - v.rated) / v.rated * 100,
    resultUnit: '%',
    resultLabel: '瞬态频率偏差',
    resultScale: 1,
    judgment: {
      operator: 'range',
      range: [-10, 12],
      passText: '合格（G3级：突加 ≤ -10%，突卸 ≤ +12%，恢复 ≤ 5s）',
      failText: '不合格（超出 G3 级限值，检查调速器）',
    },
    standard: 'GB/T 2820.5',
  },
  {
    id: 'gen-f-steady',
    category: 'electrical',
    title: '柴发频率稳态偏差',
    formulaText: 'Δf = (f实 - 50) / 50 × 100%',
    inputs: [
      { key: 'measured', label: '实测频率', unit: 'Hz', placeholder: '50.15' },
    ],
    compute: (v) => (v.measured - 50) / 50 * 100,
    resultUnit: '%',
    resultLabel: '频率偏差',
    resultScale: 2,
    judgment: {
      operator: '|',
      threshold: 0.5,
      passText: '合格（≤ ±0.5%）',
      failText: '不合格（超出 ±0.5%，检查调速器）',
    },
    standard: 'GB/T 2820.5',
  },
  {
    id: 'v-unbalance',
    category: 'electrical',
    title: '三相电压不平衡度',
    formulaText: 'ε = (Umax - Uavg) / Uavg × 100%',
    inputs: [
      { key: 'ua', label: 'A相电压', unit: 'V', placeholder: '382' },
      { key: 'ub', label: 'B相电压', unit: 'V', placeholder: '379' },
      { key: 'uc', label: 'C相电压', unit: 'V', placeholder: '375' },
    ],
    compute: (v) => {
      const avg = (v.ua + v.ub + v.uc) / 3;
      const max = Math.max(v.ua, v.ub, v.uc);
      return (max - avg) / avg * 100;
    },
    resultUnit: '%',
    resultLabel: '不平衡度',
    resultScale: 2,
    judgment: {
      operator: '<=',
      threshold: 2,
      passText: '合格（≤ 2%）',
      failText: '不合格（> 2%，检查三相负载分配）',
    },
    standard: 'GB/T 15543',
  },
  {
    id: 'thd',
    category: 'electrical',
    title: '电压总谐波畸变率 THD',
    formulaText: 'THD = √(U₂²+U₃²+...+Uₙ²) / U₁ × 100%',
    inputs: [
      { key: 'fundamental', label: '基波电压 U₁', unit: 'V', defaultValue: 380 },
      { key: 'harmonics', label: '谐波总有效值 √(ΣUₙ²)', unit: 'V', placeholder: '15.2' },
    ],
    compute: (v) => v.harmonics / v.fundamental * 100,
    resultUnit: '%',
    resultLabel: 'THD',
    resultScale: 2,
    judgment: {
      operator: '<=',
      threshold: 5,
      passText: '合格（380V 电网 THD ≤ 5%）',
      failText: '不合格（THD > 5%，检查非线性负载）',
    },
    standard: 'GB/T 14549',
  },
  {
    id: 'ups-eff',
    category: 'electrical',
    title: 'UPS 效率',
    formulaText: 'η = P输出 / P输入 × 100%',
    inputs: [
      { key: 'output', label: '输出有功功率', unit: 'kW', placeholder: '180' },
      { key: 'input', label: '输入有功功率', unit: 'kW', placeholder: '192' },
    ],
    compute: (v) => v.output / v.input * 100,
    resultUnit: '%',
    resultLabel: '效率',
    resultScale: 1,
    judgment: {
      operator: '>=',
      threshold: 92,
      passText: '合格（在线式 ≥ 92%）',
      failText: '低于 92%，考虑模块化或升级',
    },
    standard: 'GB/T 7260.3',
    note: '测试条件：额定负载、三相平衡',
  },
  {
    id: 'battery-backup',
    category: 'electrical',
    title: 'UPS 电池后备时间',
    formulaText: 't = (C × U × η) / P负载',
    inputs: [
      { key: 'capacity', label: '电池容量 C', unit: 'Ah', defaultValue: 100 },
      { key: 'voltage', label: '电池组电压 U', unit: 'V', defaultValue: 480 },
      { key: 'efficiency', label: '综合效率 η', unit: '', defaultValue: 0.85 },
      { key: 'load', label: '负载功率 P', unit: 'W', placeholder: '50000' },
    ],
    compute: (v) => (v.capacity * v.voltage * v.efficiency) / v.load,
    resultUnit: 'h',
    resultLabel: '后备时间',
    resultScale: 2,
    judgment: {
      operator: '>=',
      threshold: 0.5,
      passText: '满足 ≥ 30min 要求',
      failText: '不满足 30min，需增配电池',
    },
    note: '综合效率含逆变器+电池放电效率，约 0.80~0.90',
  },
  {
    id: 'voltage-drop',
    category: 'electrical',
    title: '线路压降',
    formulaText: 'ΔU = √3 × I × L × (R·cosφ + X·sinφ)',
    inputs: [
      { key: 'current', label: '电流 I', unit: 'A', placeholder: '200' },
      { key: 'length', label: '线路长度 L', unit: 'm', placeholder: '50' },
      { key: 'resistance', label: '导线电阻 R', unit: 'Ω/km', defaultValue: 0.125 },
      { key: 'reactance', label: '导线电抗 X', unit: 'Ω/km', defaultValue: 0.08 },
      { key: 'pf', label: '功率因数 cosφ', unit: '', defaultValue: 0.95 },
    ],
    compute: (v) => {
      const sin = Math.sqrt(1 - v.pf * v.pf);
      return Math.sqrt(3) * v.current * (v.length / 1000) * (v.resistance * v.pf + v.reactance * sin);
    },
    resultUnit: 'V',
    resultLabel: '压降',
    resultScale: 1,
    judgment: {
      operator: '<=',
      threshold: 19,
      passText: '合格（≤ 380V × 5% = 19V）',
      failText: '压降过大，增大导线截面或缩短线路',
    },
    note: '三相公式；单相去掉 √3。R/X 值查导线手册（示例为185mm²铜缆）',
  },
  {
    id: 'power-factor',
    category: 'electrical',
    title: '功率因数',
    formulaText: 'PF = P / (√3 × U × I)',
    inputs: [
      { key: 'p', label: '有功功率 P', unit: 'kW', placeholder: '150' },
      { key: 'u', label: '线电压 U', unit: 'V', defaultValue: 380 },
      { key: 'i', label: '线电流 I', unit: 'A', placeholder: '245' },
    ],
    compute: (v) => (v.p * 1000) / (Math.sqrt(3) * v.u * v.i),
    resultUnit: '',
    resultLabel: '功率因数',
    resultScale: 3,
    judgment: {
      operator: '>=',
      threshold: 0.95,
      passText: '合格（数据中心 ≥ 0.95）',
      failText: '偏低，检查无功补偿装置',
    },
  },
  {
    id: 'load-rate',
    category: 'electrical',
    title: '负载率',
    formulaText: 'β = P实际 / P额定 × 100%',
    inputs: [
      { key: 'actual', label: '实际功率', unit: 'kW', placeholder: '150' },
      { key: 'rated', label: '额定功率', unit: 'kW', placeholder: '200' },
    ],
    compute: (v) => v.actual / v.rated * 100,
    resultUnit: '%',
    resultLabel: '负载率',
    resultScale: 1,
    judgment: {
      operator: '<=',
      threshold: 80,
      passText: '正常（N+1 系统建议 ≤ 80%）',
      failText: '负载偏高，注意冗余',
    },
    note: 'N+1 冗余单台 ≤ 50%（一台故障时其余不过载）；2N 系统 ≤ 45%',
  },
  // ==================== 暖通 ====================
  {
    id: 'cooling-water',
    category: 'hvac',
    title: '制冷量（水侧）',
    formulaText: 'Q = G × 1.163 × Δt',
    inputs: [
      { key: 'flow', label: '冷冻水流量 G', unit: 'm³/h', placeholder: '120' },
      { key: 'tSupply', label: '供水温度', unit: '°C', defaultValue: 7 },
      { key: 'tReturn', label: '回水温度', unit: '°C', placeholder: '12' },
    ],
    compute: (v) => v.flow * 1.163 * Math.abs(v.tReturn - v.tSupply),
    resultUnit: 'kW',
    resultLabel: '制冷量',
    resultScale: 1,
    note: '1.163 = 1000 kg/m³ × 4.187 kJ/kg·°C / 3600 s/h',
  },
  {
    id: 'cooling-air',
    category: 'hvac',
    title: '制冷量（风侧）',
    formulaText: 'Q = L × 1.2 × 1.005 × Δt / 3600',
    inputs: [
      { key: 'airflow', label: '风量 L', unit: 'm³/h', placeholder: '10000' },
      { key: 'tReturn', label: '回风温度', unit: '°C', placeholder: '28' },
      { key: 'tSupply', label: '送风温度', unit: '°C', placeholder: '18' },
    ],
    compute: (v) => v.airflow * 1.2 * 1.005 * Math.abs(v.tReturn - v.tSupply) / 3600,
    resultUnit: 'kW',
    resultLabel: '制冷量',
    resultScale: 1,
  },
  {
    id: 'cop',
    category: 'hvac',
    title: '能效比 COP',
    formulaText: 'COP = 制冷量(kW) / 压缩机输入功率(kW)',
    inputs: [
      { key: 'cooling', label: '制冷量', unit: 'kW', placeholder: '700' },
      { key: 'power', label: '压缩机输入功率', unit: 'kW', placeholder: '130' },
    ],
    compute: (v) => v.cooling / v.power,
    resultUnit: '',
    resultLabel: 'COP',
    resultScale: 2,
    judgment: {
      operator: '>=',
      threshold: 5,
      passText: '合格（水冷螺杆 ≥ 5.0）',
      failText: '低于标准，检查冷凝器/蒸发器结垢',
    },
    standard: 'GB 19577',
    note: '水冷离心 ≥ 5.5，风冷 ≥ 3.0',
  },
  {
    id: 'airflow-calc',
    category: 'hvac',
    title: '风量计算',
    formulaText: 'L = v × A × 3600',
    inputs: [
      { key: 'velocity', label: '平均风速 v', unit: 'm/s', placeholder: '4.5' },
      { key: 'width', label: '风管宽度', unit: 'm', placeholder: '0.8' },
      { key: 'height', label: '风管高度', unit: 'm', placeholder: '0.5' },
    ],
    compute: (v) => v.velocity * v.width * v.height * 3600,
    resultUnit: 'm³/h',
    resultLabel: '风量',
    resultScale: 0,
    note: '风速取多点测量平均值（至少 5 点）',
  },
  {
    id: 'shr',
    category: 'hvac',
    title: '显热比 SHR',
    formulaText: 'SHR = 显热制冷量 / 总制冷量',
    inputs: [
      { key: 'sensible', label: '显热制冷量', unit: 'kW', placeholder: '32' },
      { key: 'total', label: '总制冷量', unit: 'kW', placeholder: '35' },
    ],
    compute: (v) => v.sensible / v.total,
    resultUnit: '',
    resultLabel: '显热比',
    resultScale: 2,
    judgment: {
      operator: '>=',
      threshold: 0.85,
      passText: '合格（机房精密空调 ≥ 0.85）',
      failText: '偏低，机房环境显热占比不足',
    },
    note: '数据中心精密空调 SHR 通常 0.90~0.95',
  },
  {
    id: 'chwdt',
    category: 'hvac',
    title: '供回水温差',
    formulaText: 'Δt = t回水 - t供水',
    inputs: [
      { key: 'tSupply', label: '供水温度', unit: '°C', defaultValue: 7 },
      { key: 'tReturn', label: '回水温度', unit: '°C', placeholder: '12' },
    ],
    compute: (v) => v.tReturn - v.tSupply,
    resultUnit: '°C',
    resultLabel: '温差',
    resultScale: 1,
    judgment: {
      operator: 'range',
      range: [4, 7],
      passText: '正常（设计温差 5°C，允许 ±1°C）',
      failText: '异常（温差过小→流量过大/冷量不足；过大→流量不足/脏堵）',
    },
  },
  // ==================== 弱电 ====================
  {
    id: 'bandwidth',
    category: 'weak',
    title: '带宽验证',
    formulaText: '实测带宽 ≥ 标称 × 90%',
    inputs: [
      { key: 'measured', label: '实测带宽', unit: 'Gbps', placeholder: '9.2' },
      { key: 'rated', label: '标称带宽', unit: 'Gbps', defaultValue: 10 },
    ],
    compute: (v) => v.measured / v.rated * 100,
    resultUnit: '%',
    resultLabel: '带宽达成率',
    resultScale: 1,
    judgment: {
      operator: '>=',
      threshold: 90,
      passText: '合格（≥ 90%）',
      failText: '不达标，检查链路/光模块/网卡配置',
    },
    note: '万兆链路实测 ≥ 9Gbps，千兆 ≥ 900Mbps。测试工具 iperf3 -t 60',
  },
  {
    id: 'cctv-storage',
    category: 'weak',
    title: '视频监控存储容量',
    formulaText: '容量(TB) = 码流 × 86400 × 天数 × 通道数 / 8 / 1024³',
    inputs: [
      { key: 'bitrate', label: '单路码流', unit: 'Mbps', defaultValue: 4 },
      { key: 'days', label: '存储天数', unit: '天', defaultValue: 30 },
      { key: 'channels', label: '通道数', unit: '路', placeholder: '64' },
    ],
    compute: (v) => v.bitrate * 86400 * v.days * v.channels / 8 / 1024 / 1024 / 1024,
    resultUnit: 'TB',
    resultLabel: '所需存储',
    resultScale: 1,
  },
  // ==================== 消防 ====================
  {
    id: 'sprinkler-end',
    category: 'fire',
    title: '喷淋末端试水压力',
    formulaText: '末端试水装置压力 ≥ 0.05 MPa',
    inputs: [
      { key: 'pressure', label: '末端试水压力', unit: 'MPa', placeholder: '0.12' },
    ],
    compute: (v) => v.pressure,
    resultUnit: 'MPa',
    resultLabel: '末端压力',
    resultScale: 2,
    judgment: {
      operator: '>=',
      threshold: 0.05,
      passText: '合格（≥ 0.05MPa）',
      failText: '不合格（压力不足，检查最不利点）',
    },
    standard: 'GB 50261',
  },
  {
    id: 'hydrant',
    category: 'fire',
    title: '消火栓栓口压力',
    formulaText: '建筑 ≤24m ≥0.35MPa；>24m ≥0.50MPa',
    inputs: [
      { key: 'pressure', label: '栓口动压', unit: 'MPa', placeholder: '0.42' },
      { key: 'height', label: '建筑高度', unit: 'm', select: [
        { label: '≤ 24m', value: 24 },
        { label: '> 24m', value: 50 },
      ], defaultValue: 24 },
    ],
    compute: (v) => v.pressure,
    resultUnit: 'MPa',
    resultLabel: '栓口压力',
    resultScale: 2,
    judgment: {
      operator: '>=',
      threshold: 0.35,
      passText: '合格（≥ 0.35MPa）',
      failText: '不合格（压力不足）',
    },
    standard: 'GB 50974',
    note: '建筑 >24m 时标准提高至 ≥ 0.50MPa',
  },
  {
    id: 'smoke-press',
    category: 'fire',
    title: '防排烟余压',
    formulaText: '楼梯间 40~50Pa；前室 25~30Pa',
    inputs: [
      { key: 'pressure', label: '实测余压', unit: 'Pa', placeholder: '45' },
      { key: 'location', label: '测试位置', unit: '', select: [
        { label: '楼梯间', value: 1 },
        { label: '前室/合用前室', value: 2 },
      ], defaultValue: 1 },
    ],
    compute: (v) => v.pressure,
    resultUnit: 'Pa',
    resultLabel: '余压',
    resultScale: 0,
    judgment: {
      operator: 'range',
      range: [40, 50],
      passText: '合格（楼梯间 40~50Pa）',
      failText: '超出范围，调节加压风机',
    },
    standard: 'GB 51251',
    note: '前室标准为 25~30Pa',
  },
  // ==================== 通用 ====================
  {
    id: 'pue',
    category: 'general',
    title: 'PUE（电能利用效率）',
    formulaText: 'PUE = 总耗电 / IT设备耗电',
    inputs: [
      { key: 'total', label: '总耗电', unit: 'kW', placeholder: '10000' },
      { key: 'it', label: 'IT 设备耗电', unit: 'kW', placeholder: '7200' },
    ],
    compute: (v) => v.total / v.it,
    resultUnit: '',
    resultLabel: 'PUE',
    resultScale: 2,
    judgment: {
      operator: '<=',
      threshold: 1.4,
      passText: '合格（≤ 1.4）',
      failText: '超标，分析制冷/供配电损耗',
    },
    note: '一线城市新建 ≤ 1.4，先进数据中心 ≤ 1.25',
  },
  {
    id: 'fuel-runtime',
    category: 'general',
    title: '柴发满载续航时间',
    formulaText: 't = 油箱容积 / (功率 × 0.25 L/kWh)',
    inputs: [
      { key: 'tank', label: '油箱容积', unit: 'L', placeholder: '5000' },
      { key: 'power', label: '柴发额定功率', unit: 'kW', placeholder: '1000' },
    ],
    compute: (v) => v.tank / (v.power * 0.25),
    resultUnit: 'h',
    resultLabel: '满载续航',
    resultScale: 1,
    judgment: {
      operator: '>=',
      threshold: 8,
      passText: '满足 ≥ 8h 要求',
      failText: '不满足 8h，需增大油箱或配外部供油',
    },
    note: '0.25 L/kWh 为满载近似值；50% 负载约 0.32 L/kWh',
  },
  {
    id: 'noise',
    category: 'general',
    title: '噪声判定',
    formulaText: '柴发机房 ≤85dB；办公区 ≤60dB',
    inputs: [
      { key: 'level', label: '实测噪声', unit: 'dB(A)', placeholder: '82' },
      { key: 'location', label: '测试位置', unit: '', select: [
        { label: '柴发机房（1m）', value: 85 },
        { label: '办公区域', value: 60 },
        { label: '机房内（运行中）', value: 70 },
      ], defaultValue: 85 },
    ],
    compute: (v) => v.level,
    resultUnit: 'dB(A)',
    resultLabel: '噪声',
    resultScale: 1,
    judgment: {
      operator: '<=',
      threshold: 85,
      passText: '合格',
      failText: '超标，需隔音/减振处理',
    },
    standard: 'GBZ 2.2',
  },
];
