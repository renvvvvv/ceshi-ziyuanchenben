/**
 * 资源配置 · 计算库（自原工具逐函数移植，保持核算口径完全一致）
 */
import { num } from './types';
import type { RcAsset, RcDelivered, RcInstrument, RcLabor, RcLoad, RcStaff } from './types';

/** 投入总天数 = 踏勘 + 复测 + 测试（自动核算） */
export const staffTotal = (r: Partial<RcStaff>): number => num(r.survey) + num(r.retest) + num(r.test);

/** 从规格文本解析 KW（6kw / 6KW / 6Kw 均识别） */
export function parseKw(s: unknown): number {
  const m = String(s || '').match(/(\d+(?:\.\d+)?)\s*kw/i);
  return m ? parseFloat(m[1]) : 0;
}

/** 假负载自有/需租赁分配：总需求 = 数量 + 备用台数，load 按功率匹配、pdu 按名称匹配 */
export function computeLoadAllocation(loads: RcLoad[], assets: RcAsset[]) {
  const stock = assets
    .filter(a => (a.cat === 'load' || a.cat === 'pdu') && num(a.count) > 0 && String(a.name || '').trim())
    .map(a => ({ cat: a.cat, name: String(a.name || ''), kw: parseKw(a.spec), remain: num(a.count) }));
  return loads.map(r => {
    const need = num(r.count) + num(r.ratio);   // ratio 复用为「备用台数」
    if (need <= 0) return { own: 0, rent: 0 };
    const tUp = (String(r.type || '') + ' ' + String(r.spec || '')).toUpperCase().replace(/\s+/g, '');
    let remaining = need, own = 0;
    for (const s of stock) {
      if (remaining <= 0) break;
      let hit = false;
      if (s.cat === 'pdu') {
        hit = tUp.includes('PDU') && tUp.includes(s.name.toUpperCase().replace(/\s+/g, ''));
      } else {
        const rowKw = parseKw(r.spec);
        hit = rowKw > 0 && s.kw === rowKw;
      }
      if (hit) {
        const use = Math.min(remaining, s.remain);
        own += use; s.remain -= use; remaining -= use;
      }
    }
    return { own, rent: need - own };
  });
}

/** 仪器仪表分配：名称精确匹配库存；自有=min(需求,库存)，超出转租赁 */
export function computeInsAllocation(instruments: RcInstrument[], assets: RcAsset[]) {
  const stockByName: Record<string, number> = {};
  assets.filter(a => a.cat === 'ins').forEach(a => {
    const k = String(a.name || '');
    if (k) stockByName[k] = (stockByName[k] || 0) + num(a.count);
  });
  return instruments.map(r => {
    const d = num(r.demand);
    const n = String(r.name || '');
    if (d <= 0 || !n) return { lib: 0, own: 0, rent: 0, found: false };
    const total = stockByName[n] || 0;
    const own = Math.min(d, total);
    return { lib: total, own, rent: d - own, found: n in stockByName };
  });
}

/** 劳务核算：auto=强度驱动 / byman=按人数 / experience=经验直填 */
export function laborCalc(r: Partial<RcLabor> & { mode?: string; workers?: number | string }) {
  const qty = Math.max(0, num(r.qty));
  const days = Math.max(1, num(r.days));
  const mode = r.mode === 'byman' ? 'byman' : r.mode === 'experience' ? 'experience' : 'auto';
  if (mode === 'byman') {
    const workers = Math.max(0, Math.round(num(r.workers)));
    const manDays = workers * days;
    const daily = manDays > 0 ? qty / manDays : 0;
    return { workers, manDays: Math.round(manDays * 10) / 10, daily: Math.round(daily * 10) / 10, qty };
  }
  if (mode === 'experience') {
    const workers = Math.max(0, Math.round(num(r.workers)));
    return { workers, manDays: Math.round(workers * days * 10) / 10, daily: num(r.daily), qty };
  }
  // auto：强度（人/天产能）驱动 → 人数 = 数量 ÷ (强度×天数)
  const daily = num(r.daily);
  if (daily <= 0) return { workers: 0, manDays: 0, daily: 0, qty };  // 人效未填返回 0 而非天文数字
  const manDaysF = qty / daily;
  const workers = Math.max(0, Math.round(manDaysF / days));
  const manDays = Math.round(workers * days * 10) / 10;
  return { workers, manDays, daily: num(r.daily), qty };
}

/** 存档/汇总聚合（口径与 deliveredSummary 一致） */
export function deliveredSummary(d: Partial<RcDelivered>) {
  const staff = Array.isArray(d.staff) ? d.staff : [];
  const loads = Array.isArray(d.loads) ? d.loads : [];
  const ins = Array.isArray(d.instruments) ? d.instruments : [];
  const cons = Array.isArray(d.consumables) ? d.consumables : [];
  const labor = Array.isArray(d.labor) ? d.labor : [];
  let manDays = 0; staff.forEach(r => { manDays += staffTotal(r); });
  let loadQty = 0; loads.forEach(r => { if (String(r.type).includes('去离子')) return; loadQty += num(r.count); });
  let insQty = 0; ins.forEach(r => { insQty += num(r.demand); });
  let consCat = 0; cons.forEach(r => { if (r.name) consCat++; });
  let laborDays = 0; labor.forEach(r => { laborDays += laborCalc(r).manDays; });
  return { manDays, loadQty, insQty, consCat, laborDays };
}

/** 岗位补贴总额（元） */
export function subsidyTotal(rows: { count: number | string; days: number | string; rate: number | string }[]) {
  return rows.reduce((s, r) => s + num(r.count) * num(r.days) * num(r.rate), 0);
}
