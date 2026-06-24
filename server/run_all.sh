#!/bin/bash
# ============================================================================
# 数据中心测试资源规划 V100 - 一键运行所有测试用例
# ============================================================================
# 用法: bash run_all.sh
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPTS="$SCRIPT_DIR/scripts"
TEST_INPUT="$SCRIPT_DIR/test6/input"
TEST_OUTPUT="$SCRIPT_DIR/test6/output"
CONFIG="$SCRIPT_DIR/config_v100.json"
TEMPLATE="$SCRIPT_DIR/../模板.xlsx"  # 调整模板路径

mkdir -p "$TEST_OUTPUT"

echo "========================================"
echo " 数据中心测试资源规划 V100 测试套件"
echo "========================================"
echo ""

# 检查模板文件
if [ ! -f "$TEMPLATE" ]; then
    TEMPLATE="$SCRIPT_DIR/../Desktop/模板.xlsx"
fi
if [ ! -f "$TEMPLATE" ]; then
    echo "⚠️  未找到模板文件，跳过Excel生成"
    TEMPLATE=""
fi

total=0
passed=0
failed=0

for input_file in "$TEST_INPUT"/*.json; do
    name=$(basename "$input_file" .json)
    result_file="$TEST_OUTPUT/result_${name}.json"
    excel_file="$TEST_OUTPUT/${name}.xlsx"
    total=$((total + 1))

    echo "【运行】$name ..."

    # 执行计算
    python3 "$SCRIPTS/resource_plan.py" -i "$input_file" -o "$result_file" 2>/dev/null

    if [ $? -eq 0 ] && [ -f "$result_file" ]; then
        # 提取关键指标
        peak=$(python3 -c "import json; d=json.load(open('$result_file')); print(d['汇总']['峰值同时在场'])")
        md=$(python3 -c "import json; d=json.load(open('$result_file')); print(d['汇总']['总人天'])")
        echo "  ✅ 成功 | 峰值=$peak | 总人天=$md"
        passed=$((passed + 1))

        # 生成Excel
        if [ -n "$TEMPLATE" ] && [ -f "$TEMPLATE" ]; then
            python3 "$SCRIPTS/generate_excel.py" "$result_file" "$TEMPLATE" "$excel_file" 2>/dev/null && \
                echo "  📊 Excel已生成"
        fi
    else
        echo "  ❌ 失败"
        failed=$((failed + 1))
    fi

    echo ""
done

echo "========================================"
echo " 测试完成: 总计 $total | 通过 $passed | 失败 $failed"
echo "========================================"
