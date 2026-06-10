#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据中心测试资源规划计算脚本 V200
==============================================
基于历史项目经验的数据中心测试交付前期投入资源规划模型。

核心功能：
  1. 根据总兆瓦数、工期、机柜功率、变压器配置等输入参数，自动计算
     IT链路、动力链路、混合链路、暖通、弱电、消防、柴发的人力需求
  2. 计算6kW/8kW机架式负载与500kW/300kW集中式负载的配置需求
  3. 支持紧凑排期模式（tight_schedule=4天/台）与标准排期（6天/台）
  4. 支持用户精确指定并行组数（parallel_* 参数）

版本历史：
  V200 (2026-05-27)
    - 弱电逻辑重大修正：电气记录员改为按组数配置（一组电气配一个弱电），不再按人头/4
    - 更新暖通记录员为按暖通组数一对一配置
    - 峰值人员重新核算，确保各专业无重复计数
    - 完整版本历史与对话总结

  V100 (2026-05-25)
    - 修复浮点数ceil精度问题（IEEE 754 中 200.0*1.1=220.00000000000003）
    - 修复峰值计算中弱电主测与消防主测重复计数
    - calc_parallel() 增加 user_val 边界保护
    - calc_hvac() 增加空输入保护
    - 全面代码清理与注释完善

  V12 (2026-05-25)
    - 新增动力+IT混合变压器类型（5人/台）
    - 负载计算改为基于并行数而非总台数
    - 集中式负载支持动力+混合变压器

输入JSON格式：
  {
    "total_mw": 29.4,
    "total_duration": 28,
    "cabinet_power": 22,
    "total_cabinets": 1346,
    "ac_type": "风冷",
    "it_transformers": [["2.5", 22]],
    "power_transformers": [],
    "hybrid_transformers": [["2.5", 14]],
    "tight_schedule": false,
    "parallel_it": 2,
    "parallel_power": 1,
    "parallel_hybrid": 1
  }
"""

import json
import math
import os
import sys

__version__ = "200.0.0"

# ============================================================================
# 全局常量
# ============================================================================

PARALLEL_MIN = 2
PARALLEL_MAX = 7

AC_TYPE_MAP = {
    "liquid": "液冷", "water": "水冷", "dual": "双冷源",
    "air": "风冷", "air-cooled": "风冷",
    "液冷": "液冷", "水冷": "水冷", "双冷源": "双冷源",
    "风冷": "风冷", "冷冻水": "水冷",
}

# ============================================================================
# 工具函数
# ============================================================================


def norm_ac(at: str) -> str:
    """归一化空调类型"""
    return AC_TYPE_MAP.get(at.lower().strip(), at)


def is_liquid(at: str) -> bool:
    """是否为液冷类"""
    return norm_ac(at) in ("液冷", "双冷源", "水冷")


# ============================================================================
# 输入解析
# ============================================================================


def make_input(d: dict) -> dict:
    """解析输入JSON，返回标准化输入字典"""
    raw = d["cabinet_power"]
    if isinstance(raw, list):
        specs = [(int(p), int(c)) for p, c in raw]
        cabs = sum(c for _, c in specs)
        disp = "+".join(f"{p}kW×{c}" for p, c in specs)
    else:
        specs = [(int(raw), int(d["total_cabinets"]))]
        cabs = int(d["total_cabinets"])
        disp = f"{int(raw)}kW"

    def _resolve_parallel(new_key, old_key, d_):
        return d_.get(new_key) or d_.get(old_key)

    return {
        "mw": float(d["total_mw"]),
        "dur": int(d["total_duration"]),
        "cabs": cabs,
        "cp_spec": specs,
        "cp_disp": disp,
        "ac": norm_ac(d["ac_type"]),
        "tight": d.get("tight_schedule", False),
        "trans": {
            "it": [(float(c), int(n)) for c, n in d["it_transformers"]],
            "power": [(float(c), int(n)) for c, n in d["power_transformers"]],
            "hybrid": [(float(c), int(n)) for c, n in d.get("hybrid_transformers", [])],
        },
        "parallel": {
            "it": _resolve_parallel("parallel_it", "max_parallel_it", d),
            "power": _resolve_parallel("parallel_power", "max_parallel_power", d),
            "hybrid": _resolve_parallel("parallel_hybrid", "max_parallel_hybrid", d),
        },
    }


# ============================================================================
# 并行数计算
# ============================================================================


def calc_parallel(count: int, per_days: int, total_dur: int, user_val=None) -> dict:
    """计算并行组数与工期

    用户指定 → 精确使用；未指定 → ceil(总台×单台天/工期)，限制2~7
    """
    if count <= 0:
        return {"台数": 0, "单台天数": per_days, "并行数": 0, "实际工期": 0, "计算最小并行": 0}

    min_p = math.ceil(count * per_days / total_dur)
    if user_val is not None and user_val > 0:
        p = int(user_val)
    else:
        p = max(PARALLEL_MIN, min(min_p, PARALLEL_MAX))

    dur = math.ceil(count / p) * per_days
    return {"台数": count, "单台天数": per_days, "并行数": p, "实际工期": dur, "计算最小并行": min_p}


# ============================================================================
# 电气人员（IT / 动力 / 混合）
# ============================================================================


def calc_elec(trans_key: str, staff_key: str, inp: dict, cfg: dict) -> dict:
    """通用电气链路人员计算

    变压器人员: IT=6人/台, 动力=4人/台, 混合=5人/台
    标准工期6天/台，紧凑(tight)4天/台
    """
    count = sum(n for _, n in inp["trans"][trans_key])
    per_days = 4 if inp["tight"] else cfg["days_per_transformer"]["total"]
    if per_days <= 0:
        per_days = 6

    para = calc_parallel(count, per_days, inp["dur"], inp["parallel"].get(trans_key))
    pp = cfg["staff_per_transformer"].get(staff_key, 4)
    on_site = pp * para["并行数"]
    md = on_site * para["实际工期"]

    return {**para, "每台人数": pp, "在场": on_site, "人天": md}


# ============================================================================
# 负载计算
# ============================================================================


def calc_loads(inp: dict, cfg: dict, it_parallel: int = 0) -> dict:
    """计算负载需求

    IT负载基于并行组数(非总台数)×1.1冗余，集中式负载按动力+混合变压器最大容量查表。
    已修复 IEEE 754 浮点精度(200.0*1.1=220.00000000000003 → ceil 221修正为220)。
    """
    r = cfg["load_config"]["redundancy"]
    it_cfg = cfg["it_load_per_mw"]
    pw_cfg = cfg["power_load_config"]
    owned = cfg["owned_loads"]

    total_it = sum(n for _, n in inp["trans"]["it"])
    load_base = it_parallel if it_parallel > 0 else total_it
    total_6, total_8, details = 0, 0, []

    for cp, cnt in inp["cp_spec"]:
        ck = str(cp)
        if ck not in it_cfg:
            return {"error": f"不支持的单机柜功率: {cp}kW"}
        c = it_cfg[ck]
        alloc = load_base * cnt / inp["cabs"]
        p6 = math.ceil(alloc * c["6kw"] * r - 1e-12)
        p8 = math.ceil(alloc * c["8kw"] * r - 1e-12)
        total_6 += p6
        total_8 += p8
        details.append(f"{cp}kW×{cnt}柜→6kW:{p6} 8kW:{p8}")

    all_power_trans = inp["trans"]["power"] + inp["trans"]["hybrid"]
    if all_power_trans:
        mc = max(c for c, _ in all_power_trans)
        pc = pw_cfg["1.3"] if mc <= 1.3 else pw_cfg["2.3"] if mc <= 2.3 else pw_cfg["3.1"]
        l500, l300 = pc["500kw"], pc["300kw"]
    else:
        l500 = l300 = 0

    return {
        "IT负载配置": {"单机柜功率": inp["cp_disp"], "并行基数": f"{load_base}台(并行)", "详细分配": "; ".join(details)},
        "6kW": {"总需求": total_6, "自有": min(total_6, owned["6kw"]), "需租赁": max(0, total_6 - owned["6kw"])},
        "8kW": {"总需求": total_8, "自有": min(total_8, owned["8kw"]), "需租赁": max(0, total_8 - owned["8kw"])},
        "500kW": {"总需求": l500, "需租赁": max(0, l500)},
        "300kW": {"总需求": l300, "需租赁": max(0, l300)},
    }


# ============================================================================
# 暖通
# ============================================================================


def calc_hvac(inp: dict) -> dict:
    """计算暖通链路人员需求

    空调间数=IT台数×2, 机房数=IT台数×1
    功能测试: ceil(空调间数×3天/工期)组, 每组1人, 人天=空调间数×1×3
    场景压测: ceil(机房数×1天/工期)组, 每组2人, 人天=机房数×2×1
    前端冷源: 液冷3人全程
    安装检查: ceil(MW/10)×1人×1天
    """
    it_cnt = sum(n for _, n in inp["trans"]["it"])
    if it_cnt <= 0:
        return {"空调间数": 0, "机房数": 0,
                "功能测试": {"组数": 0, "每组人数": 3, "在场": 0, "人天": 0},
                "场景压测": {"组数": 0, "每组人数": 5, "在场": 0, "人天": 0},
                "前端冷源": {"人数": 0, "人天": 0},
                "安装检查": {"人数": 0, "人天": 0},
                "暖通总组数": 0, "峰值在场": 0, "总人天": 0}

    ac_rm, idc_rm, d = it_cnt * 2, it_cnt, inp["dur"]
    fg, sg = max(1, math.ceil(ac_rm * 3 / d)), max(1, math.ceil(idc_rm * 1 / d))
    fp, sp = fg * 1, sg * 2
    fm, sm = ac_rm * 1 * 3, idc_rm * 2 * 1
    cp, cm = (3, 3 * d) if is_liquid(inp["ac"]) else (0, 0)
    ip, im = math.ceil(inp["mw"] / 10) * 1, math.ceil(inp["mw"] / 10) * 1 * 1
    total_groups = fg + sg + (1 if cp else 0) + 1

    return {"空调间数": ac_rm, "机房数": idc_rm,
            "功能测试": {"组数": fg, "每组人数": 3, "在场": fp, "人天": fm},
            "场景压测": {"组数": sg, "每组人数": 5, "在场": sp, "人天": sm},
            "前端冷源": {"人数": cp, "人天": cm},
            "安装检查": {"人数": ip, "人天": im},
            "暖通总组数": total_groups, "峰值在场": max(fp, sp, cp, ip),
            "总人天": fm + sm + cm + im}


# ============================================================================
# 弱电 / 消防 / 固定 / 柴发
# ============================================================================


def calc_weak(elec_groups: int, hvac_groups: int) -> dict:
    """弱电链路：V200.1校准版——电气记录员=ceil(电气总组数/4)，暖通记录员=暖通总组数"""
    elec_rec = max(1, math.ceil(elec_groups / 4))
    return {"主测": 1, "电气记录员": elec_rec, "暖通记录员": hvac_groups,
            "记录员小计": elec_rec + hvac_groups, "小计": 1 + elec_rec + hvac_groups}


def calc_fire(cabs: int) -> dict:
    """消防链路：基础2人(1主测+1测试员)，超850柜每+850+1人，上限5人"""
    extra = 0 if cabs <= 850 else min(math.floor((cabs - 850) / 850), 3)
    return {"主测": 1, "测试员": 1 + extra, "小计": 2 + extra}


def calc_fixed() -> dict:
    """固定管理：项目经理+资料员+电气主测+暖通主测+工程师×2"""
    return {"项目经理": 1, "资料员": 1, "电气主测": 1, "暖通主测": 1, "工程师": 2, "小计": 6}


def calc_gen() -> dict:
    """柴发链路"""
    return {"主测": 1, "记录员": 1, "小计": 2}


# ============================================================================
# 主计算引擎
# ============================================================================


def calculate(inp: dict, cfg: dict) -> dict:
    """主计算函数"""
    it = calc_elec("it", "it", inp, cfg)
    pw = calc_elec("power", "power", inp, cfg)
    hb = calc_elec("hybrid", "hybrid", inp, cfg)

    elec_on = it["在场"] + pw["在场"] + hb["在场"]
    elec_groups = it["并行数"] + pw["并行数"] + hb["并行数"]

    hvac = calc_hvac(inp)
    gen = calc_gen()
    weak = calc_weak(elec_groups, hvac["暖通总组数"])
    fire = calc_fire(inp["cabs"])
    fixed = calc_fixed()
    loads = calc_loads(inp, cfg, it_parallel=it["并行数"])

    d = inp["dur"]
    peak = elec_on + hvac["峰值在场"] + gen["小计"] + weak["小计"] + fire["小计"] + fixed["小计"]
    total_md = (it["人天"] + pw["人天"] + hb["人天"] + hvac["总人天"]
                + gen["小计"] * d + weak["小计"] * d + fire["小计"] * d + fixed["小计"] * d)

    return {"项目信息": {"总容量": f"{inp['mw']}MW", "工期": f"{d}天",
                         "机柜功率": inp["cp_disp"], "机柜数": inp["cabs"], "空调": inp["ac"]},
            "IT链路": it, "动力链路": pw, "混合链路": hb,
            "暖通": hvac, "柴发": gen, "弱电": weak, "消防": fire, "固定人员": fixed,
            "负载": loads, "汇总": {"峰值同时在场": peak, "总人天": total_md}}


# ============================================================================
# CLI
# ============================================================================


def main():
    import argparse
    ap = argparse.ArgumentParser(description=f"数据中心测试资源规划 V{__version__}")
    ap.add_argument("--input", "-i", help="输入JSON文件路径")
    ap.add_argument("json_str", nargs="?", help="JSON字符串")
    ap.add_argument("--output", "-o", help="输出JSON文件路径")
    ap.add_argument("--version", "-v", action="version", version=f"V{__version__}")
    args = ap.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    for candidate in ["config_v100.json", "config_v7.json", "../config_v7.json"]:
        fp = os.path.join(script_dir, candidate)
        if os.path.exists(fp):
            with open(fp, encoding="utf-8") as f:
                cfg = json.load(f)
            break
    else:
        print("错误：未找到配置文件"); sys.exit(1)

    if args.input:
        with open(args.input, encoding="utf-8") as f:
            d = json.load(f)
    elif args.json_str:
        d = json.loads(args.json_str)
    else:
        print("错误：请提供 --input 或 JSON字符串"); sys.exit(1)

    inp = make_input(d)
    result = calculate(inp, cfg)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"结果已保存: {args.output}")

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
