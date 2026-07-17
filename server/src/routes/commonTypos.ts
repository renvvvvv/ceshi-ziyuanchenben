/**
 * 通用易混字 / 地名 / 品牌 / 常用词错字词典
 * 用于 AI 错别字审核时的兜底匹配 — 不限于数据中心专业领域
 *
 * 三大类：
 *   - PLACE_NAMES：地名错写（如"北静"→"北京"、"苏洲"→"苏州"）
 *   - BRAND_NAMES：客户/品牌错写（如"阿里巴爸"→"阿里巴巴"）
 *   - COMMON_TYPOS：高频错别字对（同音字、形近字、常见拼音混）
 *
 * 这份词典的规则需要被 ruleBasedDetect 兜底匹配，确保
 * 任何专业词典未覆盖的高频错别字也能被抓住。
 */

export interface CommonTypo {
  original: string;
  suggestion: string;
  category: '地名' | '品牌' | '常用字' | '成语' | '专名';
  note?: string;
}

// ============== 1. 地名错写（覆盖全国直辖市、省会、计划单列市） ==============
export const PLACE_NAMES: CommonTypo[] = [
  // ===== 3 字地名错写（避免边界检查漏掉） =====
  { original: '北静市', suggestion: '北京市', category: '地名' },
  { original: '哈尔并市', suggestion: '哈尔滨市', category: '地名' },
  { original: '哈尔并省', suggestion: '黑龙江省', category: '地名' },
  { original: '苏洲市', suggestion: '苏州市', category: '地名' },
  { original: '苏洲省', suggestion: '江苏省', category: '地名' },
  { original: '杭洲市', suggestion: '杭州市', category: '地名' },
  { original: '武汗市', suggestion: '武汉市', category: '地名' },
  { original: '长纱市', suggestion: '长沙市', category: '地名' },
  { original: '成都省', suggestion: '四川省', category: '地名' },
  { original: '城都市', suggestion: '成都市', category: '地名' },
  { original: '哈尔滨', suggestion: '哈尔滨', category: '地名' }, // 占位
  { original: '济楠市', suggestion: '济南市', category: '地名' },
  { original: '南竟市', suggestion: '南京市', category: '地名' },
  { original: '西安省', suggestion: '陕西省', category: '地名' },
  { original: '西案市', suggestion: '西安市', category: '地名' },
  { original: '太远市', suggestion: '太原市', category: '地名' },
  { original: '太远省', suggestion: '山西省', category: '地名' },
  { original: '兰洲市', suggestion: '兰州市', category: '地名' },
  { original: '贵阳市', suggestion: '贵阳市', category: '地名' },
  { original: '桂阳市', suggestion: '贵阳市', category: '地名' },
  // 直辖市 2 字
  { original: '北静', suggestion: '北京', category: '地名', note: '北京市' },
  { original: '上海', suggestion: '上海', category: '地名' },
  { original: '重庆', suggestion: '重庆', category: '地名' },
  { original: '天京', suggestion: '天津', category: '地名' },
  // 省会城市
  { original: '哈尔并', suggestion: '哈尔滨', category: '地名' },
  { original: '哈滨', suggestion: '哈尔滨', category: '地名' },
  { original: '哈尔宾', suggestion: '哈尔滨', category: '地名' },
  { original: '沈洋', suggestion: '沈阳', category: '地名' },
  { original: '长春秋', suggestion: '长春', category: '地名' },
  { original: '济楠', suggestion: '济南', category: '地名' },
  { original: '济洲', suggestion: '郑州', category: '地名' },
  { original: '郑洲', suggestion: '郑州', category: '地名' },
  { original: '武汉', suggestion: '武汉', category: '地名' },
  { original: '武汗', suggestion: '武汉', category: '地名' },
  { original: '长沙', suggestion: '长沙', category: '地名' },
  { original: '长纱', suggestion: '长沙', category: '地名' },
  { original: '广州', suggestion: '广州', category: '地名' },
  { original: '廣州', suggestion: '广州', category: '地名' },
  { original: '南京', suggestion: '南京', category: '地名' },
  { original: '南竟', suggestion: '南京', category: '地名' },
  { original: '苏州', suggestion: '苏州', category: '地名' },
  { original: '苏洲', suggestion: '苏州', category: '地名' },
  { original: '杭州', suggestion: '杭州', category: '地名' },
  { original: '抗州', suggestion: '杭州', category: '地名' },
  { original: '哈尔', suggestion: '哈尔滨', category: '地名' },
  { original: '福州', suggestion: '福州', category: '地名' },
  { original: '福洲', suggestion: '福州', category: '地名' },
  { original: '厦门', suggestion: '厦门', category: '地名' },
  { original: '夏门', suggestion: '厦门', category: '地名' },
  { original: '青林', suggestion: '吉林', category: '地名' },
  { original: '吉木斯', suggestion: '佳木斯', category: '地名' },
  { original: '成都', suggestion: '成都', category: '地名' },
  { original: '城都', suggestion: '成都', category: '地名' },
  { original: '重庆', suggestion: '重庆', category: '地名' },
  { original: '重亲', suggestion: '重庆', category: '地名' },
  { original: '昆明', suggestion: '昆明', category: '地名' },
  { original: '昆民', suggestion: '昆明', category: '地名' },
  { original: '贵阳', suggestion: '贵阳', category: '地名' },
  { original: '桂阳', suggestion: '贵阳', category: '地名' },
  { original: '南昌', suggestion: '南昌', category: '地名' },
  { original: '南常', suggestion: '南昌', category: '地名' },
  { original: '合肥', suggestion: '合肥', category: '地名' },
  { original: '合腐', suggestion: '合肥', category: '地名' },
  { original: '太原', suggestion: '太原', category: '地名' },
  { original: '太远', suggestion: '太原', category: '地名' },
  { original: '西安', suggestion: '西安', category: '地名' },
  { original: '西案', suggestion: '西安', category: '地名' },
  { original: '兰州', suggestion: '兰州', category: '地名' },
  { original: '兰洲', suggestion: '兰州', category: '地名' },
  { original: '西宁', suggestion: '西宁', category: '地名' },
  { original: '乌鲁木齐', suggestion: '乌鲁木齐', category: '地名' },
  { original: '乌鲁木奇', suggestion: '乌鲁木齐', category: '地名' },
  { original: '拉萨', suggestion: '拉萨', category: '地名' },
  { original: '拉撒', suggestion: '拉萨', category: '地名' },
  { original: '银川', suggestion: '银川', category: '地名' },
  { original: '银穿', suggestion: '银川', category: '地名' },
  { original: '海口', suggestion: '海口', category: '地名' },
  { original: '常热', suggestion: '常熟', category: '地名' },
  // 计划单列市
  { original: '青岛', suggestion: '青岛', category: '地名' },
  { original: '靑岛', suggestion: '青岛', category: '地名' },
  { original: '宁波', suggestion: '宁波', category: '地名' },
  { original: '宁泊', suggestion: '宁波', category: '地名' },
  { original: '大连', suggestion: '大连', category: '地名' },
  { original: '大连', suggestion: '大连', category: '地名' },
  { original: '厦门', suggestion: '厦门', category: '地名' },
  { original: '深圳', suggestion: '深圳', category: '地名' },
  { original: '深圳', suggestion: '深圳', category: '地名' },
  { original: '珠海', suggestion: '珠海', category: '地名' },
  { original: '桂州', suggestion: '贵州/广州（看语境）', category: '地名', note: '同名多义，按语境判断' },
  // 国家 / 海外
  { original: '美坚', suggestion: '美国', category: '地名' },
  { original: '日奔', suggestion: '日本', category: '地名' },
  { original: '韩国', suggestion: '韩国', category: '地名' },
  { original: '韩国', suggestion: '韩国', category: '地名' },
  { original: '新加坡', suggestion: '新加坡', category: '地名' },
  { original: '新加波', suggestion: '新加坡', category: '地名' },
  { original: '英兰', suggestion: '英国（England）', category: '地名' },
  { original: '徳国', suggestion: '德国', category: '地名' },
  { original: '法国', suggestion: '法国', category: '地名' },
];

// ============== 2. 品牌 / 客户名错写 ==============
export const BRAND_NAMES: CommonTypo[] = [
  // ===== 3 字/4 字品牌名错写（避免边界误伤） =====
  { original: '阿里巴爸公司', suggestion: '阿里巴巴公司', category: '品牌' },
  { original: '阿里巴爸集团', suggestion: '阿里巴巴集团', category: '品牌' },
  { original: '阿里巴爸云', suggestion: '阿里云', category: '品牌' },
  { original: '腾迅公司', suggestion: '腾讯公司', category: '品牌' },
  { original: '腾迅科技', suggestion: '腾讯科技', category: '品牌' },
  { original: '华伪公司', suggestion: '华为公司', category: '品牌' },
  { original: '华伪技术', suggestion: '华为技术', category: '品牌' },
  // 阿里系
  { original: '阿里巴爸', suggestion: '阿里巴巴', category: '品牌', note: '阿里巴巴集团' },
  { original: '阿里八八', suggestion: '阿里巴巴', category: '品牌' },
  { original: '阿里爸爸', suggestion: '阿里巴巴', category: '品牌' },
  { original: '阿里吧吧', suggestion: '阿里巴巴', category: '品牌' },
  { original: '阿理巴巴', suggestion: '阿里巴巴', category: '品牌' },
  { original: 'Alibaba', suggestion: '阿里巴巴', category: '品牌', note: '英文应统一为中文' },
  { original: '淘宝', suggestion: '淘宝', category: '品牌' },
  { original: '掏宝', suggestion: '淘宝', category: '品牌' },
  { original: '天猫', suggestion: '天猫', category: '品牌' },
  { original: '天描', suggestion: '天猫', category: '品牌' },
  { original: '蚂蚁', suggestion: '蚂蚁集团', category: '品牌', note: '上下文为客户名称时建议加"集团"' },
  // 腾讯
  { original: '腾迅', suggestion: '腾讯', category: '品牌' },
  { original: '腾寻', suggestion: '腾讯', category: '品牌' },
  { original: '微信', suggestion: '微信', category: '品牌' },
  { original: '威信', suggestion: '微信', category: '品牌' },
  { original: 'QQ', suggestion: 'QQ', category: '品牌' },
  // 字节
  { original: '字节', suggestion: '字节跳动', category: '品牌', note: '客户文档通常用全称' },
  { original: '字节跳动', suggestion: '字节跳动', category: '品牌' },
  // 华为
  { original: '华伪', suggestion: '华为', category: '品牌' },
  { original: '滑为', suggestion: '华为', category: '品牌' },
  // 百度
  { original: '摆渡', suggestion: '百度', category: '品牌', note: '百度公司非渡船' },
  { original: '白度', suggestion: '百度', category: '品牌' },
  // 京东
  { original: '景东', suggestion: '京东', category: '品牌', note: '京东公司，非云南省景东' },
  { original: '京东', suggestion: '京东', category: '品牌' },
  // 美团
  { original: '美团', suggestion: '美团', category: '品牌' },
  { original: '每团', suggestion: '美团', category: '品牌' },
  // 拼多多
  { original: '拼多多', suggestion: '拼多多', category: '品牌' },
  { original: '评多多', suggestion: '拼多多', category: '品牌' },
  // 网易
  { original: '网易', suggestion: '网易', category: '品牌' },
  { original: '网一', suggestion: '网易', category: '品牌' },
  // 中国电信
  { original: '中国电信', suggestion: '中国电信', category: '品牌' },
  { original: '中国移通', suggestion: '中国电信', category: '品牌' },
  { original: '中国联通', suggestion: '中国联通', category: '品牌' },
  { original: '中国铁塔', suggestion: '中国铁塔', category: '品牌' },
  // 银行
  { original: '中国銀行', suggestion: '中国银行', category: '品牌' },
  { original: '中国很行', suggestion: '中国银行', category: '品牌' },
  { original: '招行', suggestion: '招商银行', category: '品牌', note: '首次出现建议全称' },
  { original: '招唤银行', suggestion: '招商银行', category: '品牌' },
  // 汽车
  { original: '比业迪', suggestion: '比亚迪', category: '品牌' },
  { original: '比亚迪', suggestion: '比亚迪', category: '品牌' },
  { original: '特斯拉', suggestion: '特斯拉', category: '品牌' },
  { original: '特撕拉', suggestion: '特斯拉', category: '品牌' },
];

// ============== 3. 通用高频错别字 / 同音字 / 形近字 ==============
export const COMMON_TYPOS: CommonTypo[] = [
  // 同音错字
  { original: '再接再厉', suggestion: '再接再厉', category: '成语', note: '繁体/简体同形，注意是"厉"非"历"' },
  { original: '再接再历', suggestion: '再接再厉', category: '成语' },
  { original: '不径而走', suggestion: '不胫而走', category: '成语' },
  { original: '川流不息', suggestion: '川流不息', category: '成语' },
  { original: '川留不息', suggestion: '川流不息', category: '成语' },
  { original: '再所难免', suggestion: '在所难免', category: '成语' },
  { original: '在所难免', suggestion: '在所难免', category: '成语' },
  { original: '一愁莫展', suggestion: '一筹莫展', category: '成语' },
  { original: '一筹莫展', suggestion: '一筹莫展', category: '成语' },
  { original: '以身徇职', suggestion: '以身殉职', category: '成语' },
  { original: '美仑美奂', suggestion: '美轮美奂', category: '成语' },
  { original: '黄粱一梦', suggestion: '黄粱一梦', category: '成语', note: '应为梁，非粱' },
  { original: '一诺千斤', suggestion: '一诺千金', category: '成语' },
  { original: '一诺钱金', suggestion: '一诺千金', category: '成语' },
  { original: '饮鸩止渴', suggestion: '饮鸩止渴', category: '成语', note: '鸩不念"鸠"' },
  { original: '一股作气', suggestion: '一鼓作气', category: '成语' },
  { original: '一鼓作气', suggestion: '一鼓作气', category: '成语' },
  { original: '水泻不通', suggestion: '水泄不通', category: '成语' },
  { original: '水泄不通', suggestion: '水泄不通', category: '成语' },
  { original: '趋之若骛', suggestion: '趋之若鹜', category: '成语' },
  { original: '直接了当', suggestion: '直截了当', category: '成语' },
  { original: '再接再励', suggestion: '再接再厉', category: '成语' },
  { original: '川流不熄', suggestion: '川流不息', category: '成语' },
  // 形近错字
  { original: '戊戌', suggestion: '戊戌（wùxū）', category: '常用字', note: '戊 wù（十天干）；戌 xū（十二地支）；不同字' },
  { original: '按装', suggestion: '安装', category: '常用字' },
  { original: '安正', suggestion: '安装', category: '常用字' },
  { original: '按排', suggestion: '安排', category: '常用字' },
  { original: '按耐', suggestion: '按捺', category: '常用字' },
  { original: '报文', suggestion: '报文', category: '常用字' },
  { original: '报毁', suggestion: '抱愧', category: '常用字' },
  { original: '报歉', suggestion: '抱歉', category: '常用字' },
  { original: '辨论', suggestion: '辩论', category: '常用字' },
  { original: '倍受', suggestion: '备受', category: '常用字' },
  { original: '卑躬曲膝', suggestion: '卑躬屈膝', category: '成语' },
  { original: '不耻下问', suggestion: '不耻下问', category: '成语', note: '常被误写为"不齿下问"' },
  { original: '不齿下问', suggestion: '不耻下问', category: '成语' },
  // 字义/语法错
  { original: '做为', suggestion: '作为', category: '常用字' },
  { original: '象素', suggestion: '像素', category: '常用字' },
  { original: '帐号', suggestion: '账号', category: '常用字', note: '"账号"是规范写法' },
  { original: '帐户', suggestion: '账户', category: '常用字' },
  { original: '登陆', suggestion: '登录', category: '常用字', note: '登入系统是"登录"非"登陆"' },
  { original: '其它', suggestion: '其他', category: '常用字', note: '规范用法为"其他"，"其它"为旧用法' },
  { original: '式样', suggestion: '式样', category: '常用字' },
  { original: '图象', suggestion: '图像', category: '常用字' },
  { original: '图象', suggestion: '图像', category: '常用字' },
  { original: '摄像', suggestion: '摄像', category: '常用字' },
  { original: '象形', suggestion: '象形', category: '常用字' },
  // IT 行业常用错字
  { original: '糸统', suggestion: '系统', category: '常用字' },
  { original: '记算', suggestion: '计算', category: '常用字' },
  { original: '记数', suggestion: '计数', category: '常用字' },
  { original: '网路', suggestion: '网络', category: '常用字', note: '网络标准写法"网络"' },
  { original: '程式', suggestion: '程序', category: '常用字', note: '台/港用法，大陆标准为"程序"' },
  { original: '解析度', suggestion: '分辨率', category: '常用字' },
  { original: '影像', suggestion: '图像/影像（看语境）', category: '常用字' },
  { original: '磁碟', suggestion: '磁盘', category: '常用字' },
  { original: '硬碟', suggestion: '硬盘', category: '常用字' },
  { original: '软体', suggestion: '软件', category: '常用字' },
  { original: '硬体', suggestion: '硬件', category: '常用字' },
  { original: '连结', suggestion: '连接', category: '常用字' },
  { original: '频宽', suggestion: '带宽', category: '常用字' },
  { original: '记忆体', suggestion: '内存', category: '常用字' },
  { original: '介面', suggestion: '界面', category: '常用字' },
  // 测试/文档常见错字
  { original: '测度', suggestion: '测试', category: '常用字' },
  { original: '测式', suggestion: '测试', category: '常用字' },
  { original: '险证', suggestion: '验证', category: '常用字' },
  { original: '签定', suggestion: '签订', category: '常用字' },
  { original: '签定', suggestion: '签订', category: '常用字' },
  { original: '签与', suggestion: '签署', category: '常用字' },
  { original: '佩置', suggestion: '配置', category: '常用字' },
  { original: '部暑', suggestion: '部署', category: '常用字' },
  { original: '部属', suggestion: '部署', category: '常用字' },
  { original: '布署', suggestion: '部署', category: '常用字' },
  { original: '运做', suggestion: '运行', category: '常用字' },
  { original: '试运', suggestion: '试运行', category: '常用字' },
];

// ============== 合并导出 ==============
export const ALL_COMMON_TYPOS: CommonTypo[] = [
  ...PLACE_NAMES,
  ...BRAND_NAMES,
  ...COMMON_TYPOS,
];

/**
 * 拼成可注入到 system prompt 的字符串
 */
export function buildCommonTyposPrompt(): string {
  const grouped: Record<string, CommonTypo[]> = {};
  for (const t of ALL_COMMON_TYPOS) {
    if (!grouped[t.category]) grouped[t.category] = [];
    grouped[t.category].push(t);
  }

  const lines: string[] = ['【通用易混字 / 地名 / 品牌错写词典】'];
  lines.push('以下条目在文档中出现时务必视为错别字（不限于数据中心领域）：\n');
  for (const [cat, items] of Object.entries(grouped)) {
    lines.push(`【${cat}】（${items.length} 条）`);
    items.slice(0, 40).forEach((t) => {
      const note = t.note ? ` — ${t.note}` : '';
      lines.push(`- "${t.original}" → "${t.suggestion}"${note}`);
    });
    if (items.length > 40) {
      lines.push(`- ...（还有 ${items.length - 40} 条）`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
