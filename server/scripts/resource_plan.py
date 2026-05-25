#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据中心测试资源规划计算脚本 V10
- 标准架构：IT 6人/台，动力 4人/台
- 暖通：液冷按空调间/机房计算（功能测试、场景压测、前端冷源、安装检查）
- 弱电：主测1人 + ceil(电气在场/4) + 暖通组数
- 消防：基础2人（1主测+1测试员），每+850柜+1人，上限5人
- 负载：IT按1.1MW单元×冗余，动力按最大容量查表
"""

import json
import math
import os
import sys
from typing import Optional

# ============ 空调类型归一化 ============

_AC_TYPE_MAP = {
    "liquid": "液冷", "water": "水冷", "dual": "双冷源",
    "air": "风冷", "air-cooled": "风冷",
    "液冷": "液冷", "水冷": "水冷", "双冷源": "双冷源", "风冷": "风冷", "冷冻水": "水冷",
}

def normalize_ac_type(ac_type: str) -> str:
    return _AC_TYPE_MAP.get(ac_type.lower().strip(), ac_type)

def is_liquid_cooled(ac_type: str) -> bool:
    return normalize_ac_type(ac_type) in ["液冷", "双冷源", "水冷"]


# ============ 数据结构 ============

def make_project_input(d: dict) -> dict:
    result = {
        "total_mw": float(d["total_mw"]),
        "total_duration": int(d["total_duration"]),
        "cabinet_power": int(d.get("cabinet_power", 0)),
        "it_transformers": [(float(c), int(n)) for c, n in d["it_transformers"]],
        "power_transformers": [(float(c), int(n)) for c, n in d["power_transformers"]],
        "total_cabinets": int(d.get("total_cabinets", 0)),
        "ac_type": normalize_ac_type(d["ac_type"]),
        "max_parallel_it": d.get("max_parallel_it"),
        "max_parallel_power": d.get("max_parallel_power"),
    }
    if "cabinet_power_segments" in d:
        result["cabinet_power_segments"] = d["cabinet_power_segments"]
    return result


# ============ 并行数计算 ============

def calc_parallel(total_units: int, days_per_unit: int,
                 total_duration: int, user_parallel: Optional[int] = None) -> dict:
    total_workload = total_units * days_per_unit
    min_parallel = math.ceil(total_workload / total_duration)
    actual_parallel = max(min_parallel, user_parallel) if user_parallel is not None else min_parallel
    return {"total_units": total_units, "days_per_unit": days_per_unit,
            "total_workload": total_workload, "total_duration": total_duration,
            "min_parallel": min_parallel, "user_parallel": user_parallel,
            "actual_parallel": actual_parallel}


# ============ 电气人员 ============

def calc_it_staff(input_data: dict, config: dict) -> dict:
    per_unit = config["staff_per_transformer"]["it"]
    days_per_unit = config["days_per_transformer"]["total"]
    it_count = sum(count for _, count in input_data["it_transformers"])
    para = calc_parallel(it_count, days_per_unit, input_data["total_duration"], input_data.get("max_parallel_it"))
    parallel = para["actual_parallel"]
    actual_dur = math.ceil(it_count / parallel) * days_per_unit
    return {"架构": "标准架构", "单台人数": per_unit, "总台数": it_count,
            "单台天数": days_per_unit, "所需并行数": parallel,
            "实际测试工期": actual_dur, "同时在场人数": per_unit * parallel,
            "总人天": per_unit * parallel * actual_dur}


def calc_power_staff(input_data: dict, config: dict) -> dict:
    per_unit = config["staff_per_transformer"]["power"]
    days_per_unit = config["days_per_transformer"]["total"]
    pw_count = sum(count for _, count in input_data["power_transformers"])
    para = calc_parallel(pw_count, days_per_unit, input_data["total_duration"], input_data.get("max_parallel_power"))
    parallel = para["actual_parallel"]
    actual_dur = math.ceil(pw_count / parallel) * days_per_unit
    return {"单台人数": per_unit, "总台数": pw_count, "单台天数": days_per_unit,
            "所需并行数": parallel, "实际测试工期": actual_dur,
            "同时在场人数": per_unit * parallel, "总人天": per_unit * parallel * actual_dur}


# ============ 负载 ============

def calc_loads(input_data: dict, config: dict) -> dict:
    redundancy = config["load_config"]["redundancy"]
    it_load_cfg = config["it_load_per_mw"]
    power_load_cfg = config["power_load_config"]
    owned = config["owned_loads"]

    total_it = sum(count for _, count in input_data["it_transformers"])
    total_mw = input_data["total_mw"]
    total_6kw = 0.0
    total_8kw = 0.0
    power_desc = ""

    # 多功率段支持
    segments = input_data.get("cabinet_power_segments", [])
    if segments:
        for seg in segments:
            seg_power = seg["power"]
            seg_count = seg["count"]
            cp_key = str(seg_power)
            if cp_key not in it_load_cfg:
                continue
            seg_mw = seg_power * seg_count / 1000.0
            it_cfg = it_load_cfg[cp_key]
            total_6kw += total_it * it_cfg["6kw"] * redundancy * seg_mw / total_mw
            total_8kw += total_it * it_cfg["8kw"] * redundancy * seg_mw / total_mw
        power_desc = "+".join(f"{s['power']}kW" for s in segments)
    else:
        cp_key = str(input_data["cabinet_power"])
        if cp_key not in it_load_cfg:
            return {"error": f"不支持的单机柜功率: {input_data['cabinet_power']}kW"}
        it_cfg = it_load_cfg[cp_key]
        total_6kw = total_it * it_cfg["6kw"] * redundancy
        total_8kw = total_it * it_cfg["8kw"] * redundancy
        power_desc = f"{input_data['cabinet_power']}kW"

    total_6kw = math.ceil(total_6kw)
    total_8kw = math.ceil(total_8kw)

    total_pw = sum(count for _, count in input_data["power_transformers"])
    if total_pw > 0:
        max_cap = max(cap for cap, _ in input_data["power_transformers"])
        pc = power_load_cfg["1.3"] if max_cap <= 1.3 else power_load_cfg["2.3"] if max_cap <= 2.3 else power_load_cfg["3.1"]
        total_500kw, total_300kw = pc["500kw"], pc["300kw"]
    else:
        total_500kw = total_300kw = 0

    return {
        "IT负载配置": {"单机柜功率": power_desc, "IT变压器总台数": total_it,
                     "每台1.1MW配置": f"6kW:{total_6kw}台, 8kW:{total_8kw}台"},
        "6kW": {"总需求": total_6kw, "自有": min(total_6kw, owned["6kw"]), "需租赁": max(0, total_6kw - owned["6kw"])},
        "8kW": {"总需求": total_8kw, "自有": min(total_8kw, owned["8kw"]), "需租赁": max(0, total_8kw - owned["8kw"])},
        "500kW": {"总需求": total_500kw, "需租赁": max(0, total_500kw)},
        "300kW": {"总需求": total_300kw, "需租赁": max(0, total_300kw)},
    }


# ============ 固定人员 / 柴发 ============

def calc_fixed_staff() -> dict:
    return {"项目经理": 1, "资料员": 1, "电气主测": 1, "暖通主测": 1, "弱电主测": 1, "消防主测": 1, "小计": 6}

def calc_generator() -> dict:
    return {"主测": 1, "记录员": 1, "小计": 2}


# ============ 暖通 ============

def calc_hvacr(input_data: dict) -> dict:
    it_count = sum(count for _, count in input_data["it_transformers"])
    ac_rooms = it_count * 2
    idc_rooms = it_count
    dur = input_data["total_duration"]

    func_grp = max(1, math.ceil(ac_rooms * 2 / dur))
    scen_grp = max(1, math.ceil(idc_rooms * 1 / dur))

    func_peak = func_grp * 3
    scen_peak = scen_grp * 5
    func_md = ac_rooms * 3 * 2
    scen_md = idc_rooms * 5 * 1

    if is_liquid_cooled(input_data["ac_type"]):
        cold_peak, cold_md = 3, 3 * dur
    else:
        cold_peak, cold_md = 0, 0

    inst_peak = math.ceil(input_data["total_mw"] / 10) * 4
    inst_md = inst_peak * 1

    return {
        "空调间数": ac_rooms, "机房数": idc_rooms,
        "功能测试": {"组数": func_grp, "每组人数": 3, "同时在场": func_peak, "人天": func_md},
        "场景压测": {"组数": scen_grp, "每组人数": 5, "同时在场": scen_peak, "人天": scen_md},
        "前端冷源": {"人数": cold_peak, "人天": cold_md},
        "安装检查": {"人数": inst_peak, "人天": inst_md},
        "暖通总组数": func_grp + scen_grp + (1 if cold_peak > 0 else 0) + 1,
        "峰值同时在场": max(func_peak, scen_peak, cold_peak, inst_peak),
        "总人天": func_md + scen_md + cold_md + inst_md,
    }


# ============ 弱电 / 消防 ============

def calc_weak_current(elec_count: int, hvacr_groups: int = 0) -> dict:
    rec = math.ceil(elec_count / 4) + hvacr_groups
    return {"主测": 1, "电气记录员": math.ceil(elec_count / 4),
            "暖通记录员": hvacr_groups, "记录员小计": rec, "小计": 1 + rec}

def calc_fire(cabinet_count: int) -> dict:
    extra = 0 if cabinet_count <= 850 else min(math.floor((cabinet_count - 850) / 850), 3)
    return {"主测": 1, "测试员": 1 + extra, "小计": 2 + extra}


# ============ 主计算 ============

def calculate_resource(input_data: dict, config: dict) -> dict:
    it = calc_it_staff(input_data, config)
    pw = calc_power_staff(input_data, config)
    hvac = calc_hvacr(input_data)
    gen = calc_generator()
    weak = calc_weak_current(it["同时在场人数"] + pw["同时在场人数"], hvac["暖通总组数"])
    fire = calc_fire(input_data["total_cabinets"])
    fixed = calc_fixed_staff()
    loads = calc_loads(input_data, config)

    dur = input_data["total_duration"]
    it_md = it["同时在场人数"] * it.get("实际测试工期", dur)
    pw_md = pw["同时在场人数"] * pw.get("实际测试工期", dur)

    return {
        "项目信息": {"总容量": f"{input_data['total_mw']}MW", "工期": f"{dur}天",
                   "单机柜功率": " + ".join(f"{s['power']}kW×{s['count']}" for s in input_data.get("cabinet_power_segments", [])) or f"{input_data['cabinet_power']}kW",
                   "总机柜": f"{input_data['total_cabinets']}个", "空调": input_data["ac_type"]},
        "IT链路": it, "动力链路": pw, "暖通": hvac,
        "柴发": gen, "弱电": weak, "消防": fire, "固定人员": fixed, "负载": loads,
        "汇总": {
            "峰值同时在场": it["同时在场人数"] + pw["同时在场人数"] + hvac["峰值同时在场"]
                         + gen["小计"] + weak["小计"] + fire["小计"] + fixed["小计"],
            "总人天": it_md + pw_md + hvac["总人天"]
                    + gen["小计"] * dur + weak["小计"] * dur + fire["小计"] * dur + fixed["小计"] * dur,
        }
    }


# ============ CLI ============

def main():
    import argparse
    parser = argparse.ArgumentParser(description='数据中心测试资源规划 V10')
    parser.add_argument('--input', '-i', help='输入JSON文件')
    parser.add_argument('json_str', nargs='?', help='JSON字符串')
    parser.add_argument('--output', '-o', help='输出结果JSON文件')
    args = parser.parse_args()

    if args.input:
        with open(args.input, 'r', encoding='utf-8') as f:
            d = json.load(f)
    elif args.json_str:
        d = json.loads(args.json_str)
    else:
        print("错误：需要输入参数（--input 或 JSON字符串）")
        sys.exit(1)

    script_dir = os.path.dirname(os.path.abspath(__file__))
    for cfg in ["config_v7.json", "../config_v7.json", "../config_v6.json"]:
        p = os.path.join(script_dir, cfg)
        if os.path.exists(p):
            with open(p, 'r', encoding='utf-8') as f:
                config = json.load(f)
            break
    else:
        print("错误：未找到配置文件")
        sys.exit(1)

    input_data = make_project_input(d)
    result = calculate_resource(input_data, config)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"结果已保存: {args.output}")

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
