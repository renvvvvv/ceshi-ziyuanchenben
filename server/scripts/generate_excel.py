#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据中心测试资源规划 Excel 报告 V10
基于模板.xlsx 格式输出，精确匹配所有行号
"""

import json
import math
import sys
from openpyxl import load_workbook


def create_template_excel(result: dict, template_path: str, output_path: str):
    wb = load_workbook(template_path)
    ws = wb.active

    duration = int(result["项目信息"]["工期"].replace("天", ""))
    it = result["IT链路"]
    pw = result["动力链路"]
    hvac = result["暖通"]
    weak = result["弱电"]
    fire = result["消防"]
    gen = result["柴发"]
    fixed = result["固定人员"]
    loads = result["负载"]

    elec_on_site = it["同时在场人数"] + pw["同时在场人数"]
    elec_dur = max(it.get("实际测试工期", duration), pw.get("实际测试工期", duration))

    hvac_peak = max(
        hvac["功能测试"]["同时在场"], hvac["场景压测"]["同时在场"],
        hvac.get("前端冷源", {}).get("人数", 0),
        hvac.get("安装检查", {}).get("人数", 0)
    )

    # ========== 1. 人员投入清单 ==========
    staff_rows = [
        (3, 1, duration),           # 测试经理
        (4, 1, duration),           # 电气主测
        (5, gen["主测"], duration), # 柴发主测
        (6, 1, duration),           # 暖通主测
        (7, fire["主测"], duration),# 消防主测
        (8, weak["主测"], duration),# 弱电主测
        (9, elec_on_site, elec_dur),# 电气测试员
        (10, hvac_peak, duration),  # 暖通测试员
        (11, weak["电气记录员"], duration), # 弱电测试员
        (12, fire["测试员"], duration),    # 消防测试员
        (13, gen["记录员"] + weak["暖通记录员"], duration), # 记录员
    ]
    for r, c, d in staff_rows:
        ws.cell(row=r, column=3, value=c)
        ws.cell(row=r, column=4, value=d)
        ws.cell(row=r, column=5, value=f"=C{r}*D{r}")

    # ========== 2. 工器具清单 ==========
    tools = [
        (18, "电能质量分析仪", 6, duration, "FLUKE 435",
         "１、配套６０００Ａ电流环至少6套；２、剩余至少２０００Ａ以上；３、配套数据传输线；4、要求435-2；5、配套内存卡2张；"),
        (19, "电能质量分析仪", 2, duration, "FLUKE 1775",
         "１、至少２０００Ａ以上电流环；\n2、配套数据传输线；"),
        (20, "热成像", 2, duration, "FLUKE Ti32", ""),
        (21, "点温枪", 4, duration, "阈值750℃", ""),
        (22, "开口钳形电流表", 6, duration, "/", ""),
        (23, "PDU相序仪", 6, duration, "/", ""),
        (24, "欧标转国标转接头", 10, duration, "１６Ａ", "ＰＤＵ欧标"),
        (25, "欧标转国标转接头", 10, duration, "１０Ａ", "ＰＤＵ欧标"),
        (26, "钳形电流表", 2, duration, "FLUKE 3８１", "配有大线圈，量程1500~2000A至少2台"),
        (27, "温湿度仪", 4, duration, "FLUKE 971", ""),
        (28, "万用表", 6, duration, "FLUKE１８Ｂ＋", ""),
        (29, "振动仪", 2, duration, "/", ""),
        (30, "风速仪", 2, duration, "/", ""),
        (31, "噪声仪", 2, duration, "/", ""),
        (32, "电池内阻仪", 2, duration, "福禄克、日置", ""),
        (33, "HOBO", 3, duration, "/", "但机房最小需量，字节脚本单通道3需布置3台；"),
    ]
    for r, name, cnt, d, model, desc in tools:
        ws.cell(row=r, column=2, value=name)
        ws.cell(row=r, column=3, value=cnt)
        ws.cell(row=r, column=4, value=d)
        ws.cell(row=r, column=5, value=f"=C{r}*D{r}")
        ws.cell(row=r, column=6, value=model if model else None)
        ws.cell(row=r, column=7, value=desc if desc else None)

    # ========== 3. 假负载清单 ==========
    spare = 0.1
    fakes = [
        (38, "风冷机架式假负载", math.ceil(loads["6kW"]["总需求"] * (1 + spare)), elec_dur, spare, "6KW/台"),
        (39, "风冷机架式假负载", math.ceil(loads["8kW"]["总需求"] * (1 + spare)), elec_dur, spare, "8KW/台"),
        (40, "风冷机架式假负载", math.ceil(loads["500kW"]["总需求"] * (1 + spare)), duration, 0, "500KW/台（0~500kw可调，每档≤10kw）\n电缆长度预估：130m；"),
        (41, "风冷机架式假负载", math.ceil(loads["300kW"]["总需求"] * (1 + spare)), duration, 0, "300KW/台（0~300kw可调，每档≤10kw）\n电缆长度预估：80m；"),
        (42, "风冷机架式假负载", 2, duration, 0, "2000KW/台（0~300kw可调，每档≤10kw）\n电缆长度预估：100m；"),
    ]
    for r, name, cnt, d, sp, spec in fakes:
        ws.cell(row=r, column=2, value=name)
        ws.cell(row=r, column=3, value=cnt)
        ws.cell(row=r, column=4, value=d)
        ws.cell(row=r, column=5, value=f"=C{r}*D{r}")
        ws.cell(row=r, column=6, value=sp)
        ws.cell(row=r, column=7, value=spec)

    # ========== 4. 劳务清单 ==========
    total_md = result["汇总"]["总人天"]
    ws.cell(row=47, column=2, value=total_md)
    ws.cell(row=47, column=3, value=total_md)

    # ========== 5. 机柜及PDU清单 ==========
    cab_num = int(''.join(c for c in result["项目信息"]["总机柜"] if c.isdigit()))
    ws.cell(row=51, column=2, value="机柜")
    ws.cell(row=51, column=3, value=cab_num)
    ws.cell(row=51, column=4, value=duration)
    ws.cell(row=51, column=5, value=f"=C51*D51")
    ws.cell(row=52, column=2, value="PDU")
    ws.cell(row=52, column=3, value=cab_num * 2)
    ws.cell(row=52, column=4, value=duration)
    ws.cell(row=52, column=5, value=f"=C52*D52")

    # ========== 6. 参考项目依据 ==========
    ws.cell(row=56, column=2,
            value=f"参考项目：{result['项目信息']['总容量']} {result['项目信息']['空调']} 项目，工期{result['项目信息']['工期']}")

    wb.save(output_path)
    print(f"✅ 模板格式Excel已生成: {output_path}")
    print(f"   总人天: {total_md}, 峰值: {result['汇总']['峰值同时在场']}")


def main():
    if len(sys.argv) < 4:
        print("Usage: python generate_excel.py <result.json> <模板.xlsx> <output.xlsx>")
        sys.exit(1)

    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        data = json.load(f)

    create_template_excel(data, sys.argv[2], sys.argv[3])


if __name__ == "__main__":
    main()
