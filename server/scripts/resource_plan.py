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
  V200.1 (2026-06-12)
    - 新增项目类型自动识别：风冷新建/混合/增项，按类型自动配置人员参数
    - 新增 detect_project_type() 和 get_type_config()
    - calc_parallel 支持 per-type PARALLEL_MIN（增项=1）
    - calc_hvac 支持 hvac_light 模式（混合/增项强制风冷轻路径）
    - calc_gen/calc_fixed 按项目类型调整（增项无柴发、减固定人员）
    - 配置新增 project_type_config 段，按类型配置 staff/parallel/hvac/gen/fixed

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

__version__ = "200.2.0"

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


def has_frontend_cooling(at: str) -> bool:
    """是否有前端冷源测试：水冷、液冷、双冷源均有"""
    return norm_ac(at) in ("液冷", "水冷", "双冷源")


# ============================================================================
# 输入解析
# ============================================================================


def make_input(d: dict) -> dict:
    """解析输入JSON，返回标准化输入字典

    支持三种格式:
      cabinet_power=12                  → 单一功率，全部风冷
      cabinet_power=[[12,2400]]         → 风冷多功率
      cabinet_power=[["液冷",30,800],["风冷",12,1600]] → 风液混合
    """
    raw = d["cabinet_power"]
    is_hybrid = False
    liquid_specs, air_specs = [], []

    if isinstance(raw, list) and len(raw) > 0 and isinstance(raw[0], list) and len(raw[0]) == 3:
        # 风液混合: [["液冷",30,800], ["风冷",12,1600]]
        is_hybrid = True
        for ac_type, p, c in raw:
            if norm_ac(ac_type) in ("液冷", "水冷", "双冷源"):
                liquid_specs.append((int(p), int(c)))
            else:
                air_specs.append((int(p), int(c)))
        cabs = sum(c for _, c in liquid_specs + air_specs)
        specs = liquid_specs + air_specs
        liquid_disp = "+".join(f"{p}kW×{c}" for p, c in liquid_specs)
        air_disp = "+".join(f"{p}kW×{c}" for p, c in air_specs)
        disp = f"液冷:{liquid_disp} 风冷:{air_disp}"
    elif isinstance(raw, list):
        specs = [(int(p), int(c)) for p, c in raw]
        cabs = sum(c for _, c in specs)
        disp = "+".join(f"{p}kW×{c}" for p, c in specs)
        # 功率 >= 25kW 视为液冷机柜，< 25kW 为风冷机柜
        for p, c in specs:
            if int(p) >= 25:
                liquid_specs.append((int(p), int(c)))
            else:
                air_specs.append((int(p), int(c)))
        if liquid_specs and air_specs:
            is_hybrid = True
    else:
        p = int(raw)
        specs = [(p, int(d["total_cabinets"]))]
        cabs = int(d["total_cabinets"])
        disp = f"{int(raw)}kW"
        # 机柜功率 >= 25kW → 液冷机柜
        if p >= 25:
            liquid_specs.append((p, cabs))
        else:
            air_specs.append((p, cabs))

    def _resolve_parallel(new_key, old_key, d_):
        return d_.get(new_key) or d_.get(old_key)

    target_dur = d.get("target_duration")
    proj_type_override = d.get("project_type")
    cert = d.get("cert_name", "")
    cert_scope = d.get("cert_scope", "")
    pdu_type = d.get("pdu_type", "C19")
    has_gen_load = d.get("has_gen_load", False)

    return {
        "mw": float(d["total_mw"]),
        "project_type_override": proj_type_override,
        "dur": int(d["total_duration"]),
        "target_dur": int(target_dur) if target_dur is not None else None,
        "cabs": cabs,
        "cp_spec": specs,
        "cp_disp": disp,
        "ac": norm_ac(d["ac_type"]),
        "tight": d.get("tight_schedule", False),
        "is_hybrid": is_hybrid,
        "liquid_specs": liquid_specs,
        "air_specs": air_specs,
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
        "cert_name": cert,
        "cert_scope": cert_scope,
        "pdu_type": pdu_type,
        "has_gen_load": bool(has_gen_load),
    }


# ============================================================================
# 项目类型自动识别
# ============================================================================


def detect_project_type(inp: dict) -> str:
    """根据空调类型和机柜类型自动识别项目类型

    支持输入JSON中显式指定: \"project_type\": \"阿里巴拿马3.0\"

    风冷:   风冷空调 + 风冷机柜
    水冷:   水冷/冷冻水空调 + 风冷机柜
    液冷:   水冷/冷冻水空调 + 液冷机柜
    风液混合: 水冷空调 + 风冷+液冷机柜
    阿里巴拿马3.0: 显式指定（水冷空调+风冷机柜，精简要配置）
    """
    # 用户显式覆盖
    if inp.get("project_type_override"):
        return inp["project_type_override"]
    ac = inp["ac"]
    has_liquid_cabs = len(inp.get("liquid_specs", [])) > 0
    has_air_cabs = len(inp.get("air_specs", [])) > 0
    is_water_ac = ac in ("液冷", "水冷", "双冷源")

    if is_water_ac:
        if has_liquid_cabs and has_air_cabs:
            return "风液混合"
        elif has_liquid_cabs:
            return "液冷"
        else:
            return "水冷"
    else:
        return "风冷"


def is_small_project(inp: dict) -> bool:
    """小型/增项项目：柜数/MW < 25 或 无配电变压器"""
    mw = inp["mw"]
    cabs = inp["cabs"]
    if cabs > 0 and cabs / mw < 25:
        return True
    has_power = sum(n for _, n in inp["trans"]["power"]) > 0
    has_hybrid = sum(n for _, n in inp["trans"]["hybrid"]) > 0
    if not has_power and not has_hybrid:
        return True
    return False


def get_type_config(cfg: dict, proj_type: str, is_small: bool = False) -> dict:
    """获取项目类型的配置，小型项目自动轻量化"""
    ptc = cfg.get("project_type_config", {})
    base = dict(ptc.get(proj_type, {}))
    if is_small and proj_type in ("风冷", "水冷"):
        # 小型项目：降 staff、降并行下限、减固定人员
        base["staff_per_transformer"] = {"it": 3, "power": 1, "hybrid": 2}
        base["parallel_min"] = 1
        base["skip_gen"] = True
        base["fixed_count"] = 2
    return base


# ============================================================================
# 并行数计算
# ============================================================================


def calc_parallel(count: int, per_days: int, total_dur: int, user_val=None, pmin: int = None) -> dict:
    """计算并行组数与工期

    用户指定 → 精确使用；未指定 → ceil(总台×单台天/工期)，限制 pmin~5
    """
    if pmin is None:
        pmin = PARALLEL_MIN

    if count <= 0:
        return {"台数": 0, "单台天数": per_days, "并行数": 0, "实际工期": 0, "计算最小并行": 0}

    min_p = math.ceil(count * per_days / total_dur)
    if user_val is not None and user_val > 0:
        p = int(user_val)
    else:
        p = max(pmin, min(min_p, PARALLEL_MAX))

    dur = math.ceil(count / p) * per_days
    return {"台数": count, "单台天数": per_days, "并行数": p, "实际工期": dur, "计算最小并行": min_p}


# ============================================================================
# 电气人员（IT / 动力 / 混合）
# ============================================================================


def calc_elec(trans_key: str, staff_key: str, inp: dict, cfg: dict, type_cfg: dict = None) -> dict:
    """通用电气链路人员计算

    变压器人员按项目类型配置；标准工期6天/台，紧凑(tight)4天/台
    风液混合: IT每组+1人（液冷机柜测试额外人力）
    """
    if type_cfg is None:
        type_cfg = {}

    count = sum(n for _, n in inp["trans"][trans_key])
    per_days = 4 if inp["tight"] else cfg["days_per_transformer"]["total"]
    if per_days <= 0:
        per_days = 6

    pmin = type_cfg.get("parallel_min", PARALLEL_MIN)
    para = calc_parallel(count, per_days, inp["dur"], inp["parallel"].get(trans_key), pmin=pmin)

    # Use type-specific staff if available, otherwise fall back to global config
    type_staff = type_cfg.get("staff_per_transformer", {})
    pp = type_staff.get(staff_key) if staff_key in type_staff else cfg["staff_per_transformer"].get(staff_key, 4)

    hybrid_extra = type_cfg.get("hybrid_it_extra", cfg.get("hybrid_it_extra", 1))
    if inp.get("is_hybrid") and trans_key == "it":
        pp += hybrid_extra

    on_site = pp * para["并行数"]
    md = on_site * para["实际工期"]

    return {**para, "每台人数": pp, "在场": on_site, "人天": md}


# ============================================================================
# 负载计算
# ============================================================================


def calc_loads(inp: dict, cfg: dict, it_parallel: int = 0, type_cfg: dict = None) -> dict:
    """计算负载需求

    机架式负载：按机柜数×柜功率/假负载功率×覆盖率（>50%机柜需同时压测）
    液冷负载：按变压器链路配置，最低2链路同时压测，冗余1.1
    集中式负载：按动力+混合变压器最大容量查表（冷型无关）。
    """
    r = cfg["load_config"]["redundancy"]
    pw_cfg = cfg["power_load_config"]
    owned = cfg["owned_loads"]
    liquid_kw = (type_cfg or {}).get("liquid_load_kw") or cfg.get("liquid_load_config", {}).get("load_kw", 30)
    trans_cap = max(c for c, _ in inp["trans"]["it"]) if inp["trans"]["it"] else 0

    total_it = sum(n for _, n in inp["trans"]["it"])
    load_base = it_parallel if it_parallel > 0 else total_it
    details = []
    total_6, total_8, total_liquid = 0, 0, 0

    # 判断机柜类型：液冷机柜 vs 风冷机柜（与空调类型无关！）
    has_liquid_cabs = len(inp.get("liquid_specs", [])) > 0
    has_air_cabs = len(inp.get("air_specs", [])) > 0 or (not inp.get("is_hybrid") and not has_liquid_cabs)
    is_hybrid_project = inp.get("is_hybrid") or (has_liquid_cabs and has_air_cabs)
    # 覆盖率动态计算：每并行组需测柜数越多，覆盖率越高
    if is_hybrid_project:
        coverage = (type_cfg or {}).get("load_coverage") or cfg.get("load_config", {}).get("coverage_hybrid", 0.85)
    else:
        coverage = (type_cfg or {}).get("load_coverage")
        if coverage is None:
            air_cabs = sum(c for _, c in (inp.get("air_specs", []) or inp.get("cp_spec", [])))
            if air_cabs > 0 and load_base > 0:
                cabs_per_group = air_cabs / load_base
                coverage = max(0.47, min(cabs_per_group * 0.0008, 0.70))
            else:
                coverage = cfg.get("load_config", {}).get("coverage", 0.52)

    # 液冷负载：按变压器链路配置，最低2链路同时压测，冗余1.1
    # 混合项目液冷柜不能复用，需按机柜数加覆盖
    if has_liquid_cabs:
        per_link = math.ceil(trans_cap * 1000 / liquid_kw)
        liquid_links = max(load_base, 2)
        total_liquid = math.ceil(per_link * liquid_links * r - 1e-12)
        if is_hybrid_project:
            liquid_cabs = sum(c for _, c in inp.get("liquid_specs", []))
            cov_liq = (type_cfg or {}).get("coverage_liquid_hybrid") or cfg.get("load_config", {}).get("coverage_liquid_hybrid", 1.0)
            total_liquid = max(total_liquid, math.ceil(liquid_cabs * cov_liq * r - 1e-12))
        details.append(f"液冷{trans_cap}MW变压器→每链路{per_link}台30kW, {liquid_links}链路→{total_liquid}台")

    # 风冷负载：机柜数×柜功率/假负载功率×覆盖率（默认55%机柜同时压测）
    # 柜功率<12kW→6kW假负载, ≥12kW→8kW假负载(12kW两者皆可,默认8kW)
    air_specs = inp.get("air_specs", []) if inp.get("is_hybrid") else (inp["cp_spec"] if has_air_cabs else [])
    if air_specs:
        for cp, cnt in air_specs:
            cp_kw = int(cp)
            # type_cfg可配置6kW负载的机柜功率上限(默认12kW, 即≤12用6kW)
            max_6kw = (type_cfg or {}).get("load_6kw_max_kw", 12)
            if cp_kw <= max_6kw:
                load_kw, total_6_add = 6, math.ceil(cnt * cp_kw / 6 * coverage * r - 1e-12)
                total_6 += total_6_add
                details.append(f"{cp}kW×{cnt}柜→6kW:{total_6_add}台")
            else:
                load_kw, total_8_add = 8, math.ceil(cnt * cp_kw / 8 * coverage * r - 1e-12)
                total_8 += total_8_add
                details.append(f"{cp}kW×{cnt}柜→8kW:{total_8_add}台")

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
        "30kW": {"总需求": total_liquid, "需租赁": max(0, total_liquid)},
        "500kW": {"总需求": l500, "需租赁": max(0, l500)},
        "300kW": {"总需求": l300, "需租赁": max(0, l300)},
    }


# ============================================================================
# 暖通
# ============================================================================


def calc_hvac(inp: dict, type_cfg: dict = None) -> dict:
    """计算暖通链路人员需求

    空调间数=IT台数×2, 机房数=IT台数×1
    液冷路径: 功能ceil(空调间数×2/工期),场景ceil(机房数×1/工期);每组3/5人;前端冷源3人;安装检查ceil(MW/10)×4
    风冷路径: 功能ceil(空调间数×3/工期),场景ceil(机房数×1/工期);每组1/2人;无前端冷源;安装检查ceil(MW/10)×1
    hvac_light: 混合/增项项目强制走风冷轻路径（基础设施利旧）
    """
    if type_cfg is None:
        type_cfg = {}

    hvac_light = type_cfg.get("hvac_light", False)

    it_cnt = sum(n for _, n in inp["trans"]["it"])
    if it_cnt <= 0:
        return {"空调间数": 0, "机房数": 0,
                "功能测试": {"组数": 0, "每组人数": 3, "在场": 0, "人天": 0},
                "场景压测": {"组数": 0, "每组人数": 5, "在场": 0, "人天": 0},
                "前端冷源": {"人数": 0, "人天": 0},
                "安装检查": {"人数": 0, "人天": 0},
                "暖通总组数": 0, "峰值在场": 0, "总人天": 0}

    ac_rm, idc_rm, d = it_cnt * 2, it_cnt, inp["dur"]

    # hvac_light: 强制风冷轻路径（混合项目的液冷部分通常复用现有冷源）
    use_liquid = is_liquid(inp["ac"]) and not hvac_light

    if use_liquid:
        # 水冷/液冷/双冷源
        fg = max(1, math.ceil(ac_rm * 2 / d))
        sg = max(1, math.ceil(idc_rm * 1 / d))
        # type_cfg 可覆盖每组人数和安装检查系数
        ac_pp = type_cfg.get("hvac_ac_per_group", 3)
        fp, sp = fg * ac_pp, sg * 5
        fm, sm = ac_rm * ac_pp * 2, idc_rm * 5 * 1
        cp, cm = 3, 3 * d
        install_mult = type_cfg.get("hvac_install_per_mw", 4)
        ip = math.ceil(inp["mw"] / 10) * install_mult
        im = ip * 1
    else:
        # 风冷
        fg = max(1, math.ceil(ac_rm * 3 / d))
        sg = max(1, math.ceil(idc_rm * 1 / d))
        fp, sp = fg * 1, sg * 2
        fm, sm = ac_rm * 1 * 3, idc_rm * 2 * 1
        cp, cm = 0, 0
        install_mult = type_cfg.get("hvac_install_per_mw", 1)
        ip = math.ceil(inp["mw"] / 10) * install_mult
        im = ip * 1
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


def calc_weak(elec_groups: int, hvac_groups: int, skip_recorders: bool = False, type_cfg: dict = None) -> dict:
    """弱电链路：按组数配置，一组电气/暖通配一个弱电记录员"""
    if type_cfg is None:
        type_cfg = {}
    # 如果配置了 fixed weak_count，直接使用
    wc = type_cfg.get("weak_count")
    if wc is not None:
        return {"主测": 1, "记录员": wc - 1, "小计": wc}
    if skip_recorders:
        return {"主测": 1, "电气记录员": elec_groups, "暖通记录员": 0,
                "记录员小计": elec_groups, "小计": 1 + elec_groups}
    return {"主测": 1, "电气记录员": elec_groups, "暖通记录员": hvac_groups,
            "记录员小计": elec_groups + hvac_groups, "小计": 1 + elec_groups + hvac_groups}


def calc_fire(cabs: int, type_cfg: dict = None) -> dict:
    """消防链路：基础2人(1主测+1测试员)，超850柜每+850+1人，上限5人。可按项目类型配置固定人数。"""
    if type_cfg and type_cfg.get("fire_count"):
        n = type_cfg["fire_count"]
        return {"主测": 1, "测试员": n - 1, "小计": n}
    extra = 0 if cabs <= 850 else min(math.floor((cabs - 850) / 850), 3)
    return {"主测": 1, "测试员": 1 + extra, "小计": 2 + extra}


def calc_fixed(type_cfg: dict = None) -> dict:
    """固定管理：根据项目类型调整人数（弱电/消防主测已在专业链路计数）"""
    if type_cfg is None:
        type_cfg = {}
    n = type_cfg.get("fixed_count", 4)
    if n <= 2:
        return {"项目经理": 1, "资料员": 1, "小计": 2}
    elif n == 3:
        return {"项目经理": 1, "电气主测": 1, "暖通主测": 1, "小计": 3}
    elif n == 5:
        return {"项目经理": 1, "电气主测": 2, "暖通主测": 2, "小计": 5}
    else:
        return {"项目经理": 1, "资料员": 1, "电气主测": 1, "暖通主测": 1, "小计": 4}


def calc_gen(type_cfg: dict = None) -> dict:
    """柴发链路（增项项目无新建柴发，跳过）"""
    if type_cfg is None:
        type_cfg = {}
    if type_cfg.get("skip_gen", False):
        return {"主测": 0, "记录员": 0, "小计": 0}
    return {"主测": 1, "记录员": 1, "小计": 2}


# ============================================================================
# 工器具
# ============================================================================


def calc_tools(elec_groups: int, total_cabinets: int,
               it_parallel: int = 0, pw_parallel: int = 0, hb_parallel: int = 0,
               type_cfg: dict = None, dur: int = 28) -> dict:
    """计算工器具需求（基于实际项目数据校准）

    电气工具按IT并行组为主分配，动力/混合组共享；暖通工具按机房数分配。
    风液混合类型通过 tool_adjust 补偿额外的工具需求。
    天数按项目工期，即工器具按全程配置。
    """
    it_n = it_parallel or max(elec_groups // 2, 1)
    pw_hb_n = max(pw_parallel + hb_parallel, 0)
    hvac_rooms = math.ceil(total_cabinets / 300)

    # 电气：以单套IT变压器链路为基准（王志强标准）
    # 每链路: 电能435×2, 万用表×3, 钳形电流表×3(含381×1), 热成像×4, 相序仪×2, 971×2, 噪声×1
    elec_per = {
        "电能质量分析仪435": 2 * it_n,
        "电能质量分析仪1775": max(it_n // 2, 1),
        "万用表": 3 * it_n,
        "钳形电流表": 3 * it_n,
        "钳形电流表381": 1 * it_n,
        "钳形电流表319": 0,
        "热成像": 4 * it_n,
        "相序仪": 2 * it_n,
        "温湿度仪971": 2 * it_n,
        "点温枪": 1,
        "振动仪": 1,
        "噪声仪": 1 * it_n,
        "电池内阻仪": 1,
        "PDU测试仪": max(2, round(total_cabinets / 150)),  # ~2台/300柜机房
    }
    # 暖通：以单个机房为单位（~300柜/机房），王志强标准
    # 971×4, 风速仪×2, 热成像×2（工具共用，不乘机房数）
    hvac_per = {
        "温湿度仪971_暖通": 4,
        "风速仪": 2,
        "热成像_暖通": 2,
    }

    # 应用项目类型的工具系数调整（乘法缩放，解决固定偏移不随项目规模缩放的问题）
    if type_cfg:
        coef = type_cfg.get("tool_coef", {})
        for k, v in coef.items():
            if k in elec_per and elec_per[k] > 0:
                elec_per[k] = max(0, round(elec_per[k] * v))
            if k in hvac_per and hvac_per[k] > 0:
                hvac_per[k] = max(0, round(hvac_per[k] * v))
        # 加法调整保留给固定值工具（如点温枪、电池内阻仪等基数=1的工具）
        adjust = type_cfg.get("tool_adjust", {})
        for k, v in adjust.items():
            if k in elec_per:
                elec_per[k] = max(0, elec_per[k] + v)
            if k in hvac_per:
                hvac_per[k] = max(0, hvac_per[k] + v)

    return {
        "电气工器具": elec_per,
        "暖通工器具": hvac_per,
        "暖通基准机房数": hvac_rooms,
        "天数": dur,
    }


# ============================================================================
# 人员职级映射
# ============================================================================


def build_rank_summary(it, pw, hb, hvac, gen, weak, fire, fixed) -> dict:
    """按职级汇总人员: TO-3(主测/经理), TO-4(测试员), TO-6(记录员)"""
    # TO-3: 主测 + 项目经理
    t3 = {
        "测试经理": fixed.get("项目经理", 0),
        "电气主测": fixed.get("电气主测", 0),
        "柴发主测": gen.get("主测", 0),
        "暖通主测": fixed.get("暖通主测", 0),
        "消防主测": fire.get("主测", 0),
        "弱电主测": weak.get("主测", 0),
    }
    t3["小计"] = sum(t3.values())

    # TO-4: 测试员
    weak_testers = weak.get("电气记录员", 0)
    t4 = {
        "电气测试员": it.get("在场", 0) + pw.get("在场", 0) + hb.get("在场", 0),
        "暖通测试员": hvac.get("峰值在场", 0),
        "弱电测试员": weak_testers,
        "消防测试员": fire.get("测试员", fire.get("小计", 0) - fire.get("主测", 0)),
    }
    t4["小计"] = sum(t4.values())

    # TO-6: 记录员
    t6 = {
        "记录员": weak.get("暖通记录员", 0) + gen.get("记录员", 0),
    }
    t6["小计"] = sum(t6.values())

    return {"公司属性": "测试服务部", "TO-3": t3, "TO-4": t4, "TO-6": t6}


# ============================================================================
# PDU / 线缆 / 连接器
# ============================================================================


PDU_DEFAULTS = {"C14": ("10A", "C13/C15电源线", "IEC C14"),
                 "C19": ("16A", "C20电源线", "IEC C19"),
                 "GB": ("32A", "国标电源线", "GB 1002")}


def calc_pdu(total_cabinets: int, pdu_type: str = "C19") -> dict:
    """机柜PDU规格、线缆和工业连接器配置，默认C19(16A)"""
    pdu_count = total_cabinets * 2  # 每柜2条PDU
    current, cable, connector = PDU_DEFAULTS.get(pdu_type, PDU_DEFAULTS["C19"])
    return {
        "机柜数量": total_cabinets,
        "PDU数量": pdu_count,
        "PDU类型": pdu_type,
        "额定电流": current,
        "线缆规格": cable,
        "工业连接器": connector,
    }


# ============================================================================
# 主计算引擎
# ============================================================================


def calculate(inp: dict, cfg: dict) -> dict:
    """主计算函数：自动识别项目类型，按类型配置参数

    如果 inp 中有 target_dur，则作为目标工期参与并行计算（压缩工期模式）。
    """
    proj_type = detect_project_type(inp)
    small = is_small_project(inp)
    type_cfg = get_type_config(cfg, proj_type, small)

    # 工期：优先使用 target_dur（压缩工期），否则用原始工期
    eff_dur = inp.get("target_dur") or inp["dur"]
    # 如果压缩工期，自动启用紧凑排期（4天/台）
    is_compressed = inp.get("target_dur") is not None and inp["target_dur"] < inp["dur"]

    # 临时覆盖工期和紧凑标志
    orig_dur = inp["dur"]
    orig_tight = inp.get("tight", False)
    if eff_dur != orig_dur:
        inp["dur"] = eff_dur
    if is_compressed:
        inp["tight"] = True

    it = calc_elec("it", "it", inp, cfg, type_cfg)
    pw = calc_elec("power", "power", inp, cfg, type_cfg)
    hb = calc_elec("hybrid", "hybrid", inp, cfg, type_cfg)

    elec_on = it["在场"] + pw["在场"] + hb["在场"]
    elec_groups = it["并行数"] + pw["并行数"] + hb["并行数"]

    hvac = calc_hvac(inp, type_cfg)
    gen = calc_gen(type_cfg)
    weak = calc_weak(elec_groups, hvac["暖通总组数"], type_cfg.get("skip_recorders", False), type_cfg)
    fire = calc_fire(inp["cabs"], type_cfg)
    fixed = calc_fixed(type_cfg)
    loads = calc_loads(inp, cfg, it_parallel=it["并行数"], type_cfg=type_cfg)
    tools = calc_tools(elec_groups, inp["cabs"],
                       it["并行数"], pw["并行数"], hb["并行数"],
                       type_cfg, eff_dur)

    d = eff_dur
    peak = elec_on + hvac["峰值在场"] + gen["小计"] + weak["小计"] + fire["小计"] + fixed["小计"]
    total_md = (it["人天"] + pw["人天"] + hb["人天"] + hvac["总人天"]
                + gen["小计"] * d + weak["小计"] * d + fire["小计"] * d + fixed["小计"] * d)

    # 恢复原始值
    inp["dur"] = orig_dur
    inp["tight"] = orig_tight

    # 人员职级映射
    ranks = build_rank_summary(it, pw, hb, hvac, gen, weak, fire, fixed)
    # PDU配置
    pdu = calc_pdu(inp["cabs"], inp.get("pdu_type", "C19"))
    # 柴发负载
    gen_load = {"规格": "2500KVA 阻容一体", "数量": 1, "电缆": "10KV高压电缆"} if inp.get("has_gen_load") else {"规格": "", "数量": 0, "电缆": ""}

    cert_name = inp.get("cert_name", "")
    cert_scope = inp.get("cert_scope", "")

    return {"项目信息": {"总容量": f"{inp['mw']}MW",
                         "工期": f"{eff_dur}天",
                         "原始工期": f"{orig_dur}天",
                         "机柜功率": inp["cp_disp"], "机柜数": inp["cabs"], "空调": inp["ac"],
                         "项目类型": proj_type},
            "IT链路": it, "动力链路": pw, "混合链路": hb,
            "暖通": hvac, "柴发": gen, "弱电": weak, "消防": fire, "固定人员": fixed,
            "负载": loads, "工器具": tools,
            "职级配置": ranks, "PDU配置": pdu, "柴发负载": gen_load,
            "认证需求": {"证书名称": cert_name, "认证范围": cert_scope} if cert_name else None,
            "汇总": {"峰值同时在场": peak, "总人天": total_md}}


def calculate_scenarios(inp: dict, cfg: dict, target_dur: int = None) -> dict:
    """多版本工期计算

    如果指定 target_dur，则只计算该压缩版本。
    否则默认输出 3 个版本：标准（6天/台，原始工期）、紧凑（6天/台，75%工期）、压缩（4天/台，50%工期）。

    越压缩 → 并行组数越多 → 峰值越高，这是正确的商业逻辑。
    """
    base_dur = inp["dur"]

    if target_dur is not None:
        scenarios = [(f"压缩至{target_dur}天", target_dur)]
    else:
        tight_dur = max(int(base_dur * 0.75), 7)
        comp_dur = max(int(base_dur * 0.5), 5)
        scenarios = [
            (f"标准({base_dur}天)", base_dur, False),       # 6天/台
            (f"紧凑({tight_dur}天)", tight_dur, False),      # 6天/台, 压缩工期 → 更多并行
            (f"压缩({comp_dur}天)", comp_dur, True),          # 4天/台, 更压缩 → 最多并行
        ]

    results = {}
    for item in scenarios:
        if len(item) == 3:
            label, dur, tight = item
        else:
            label, dur = item
            tight = (dur < base_dur * 0.6)

        inp_copy = dict(inp)
        if dur != base_dur:
            inp_copy["target_dur"] = dur
        else:
            inp_copy["target_dur"] = None
        if tight:
            inp_copy["tight"] = True
        results[label] = calculate(inp_copy, cfg)

    # Build summary
    summary = {}
    for label, r in results.items():
        summary[label] = {
            "工期": r["项目信息"]["工期"],
            "峰值同时在场": r["汇总"]["峰值同时在场"],
            "总人天": r["汇总"]["总人天"],
            "IT并行组数": r["IT链路"]["并行数"],
            "动力并行组数": r["动力链路"]["并行数"],
            "混合并行组数": r["混合链路"]["并行数"],
            "每台IT人数": r["IT链路"]["每台人数"],
        }

    return {"多版本对比": summary, "详细结果": results}


# ============================================================================
# CLI
# ============================================================================


def main():
    import argparse
    ap = argparse.ArgumentParser(description=f"数据中心测试资源规划 V{__version__}")
    ap.add_argument("--input", "-i", help="输入JSON文件路径")
    ap.add_argument("json_str", nargs="?", help="JSON字符串")
    ap.add_argument("--output", "-o", help="输出JSON文件路径")
    ap.add_argument("--target-duration", "-t", type=int, help="指定压缩工期（天），不指定则输出标准+紧凑+压缩三个版本")
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
    elif not sys.stdin.isatty():
        d = json.load(sys.stdin)
    else:
        print("错误：请提供 --input 或 JSON字符串"); sys.exit(1)

    inp = make_input(d)

    # 如果命令行指定了 target-duration，覆盖输入中的值
    if args.target_duration is not None:
        inp["target_dur"] = args.target_duration
        result = calculate(inp, cfg)
    elif inp.get("target_dur") is not None:
        # 输入 JSON 中指定了 target_duration
        result = calculate(inp, cfg)
    else:
        # 默认：输出多版本
        result = calculate_scenarios(inp, cfg)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"结果已保存: {args.output}")

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

