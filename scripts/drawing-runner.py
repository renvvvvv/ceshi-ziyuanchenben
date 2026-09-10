#!/usr/bin/env python3
"""图纸路由管线宿主机执行器（systemd 常驻）

与平台容器的分工：容器后端只写任务标记（uploads/drawing/<id>/JOB），
本进程轮询标记 → 解压归档 → 调用 wjsluyou 编排器 → 全程写 STATUS 供前端轮询。
共享目录即接口，容器无需安装任何工具链。

目录约定（<job> = uploads/drawing/<jobId>）：
  <job>/JOB          容器写入的任务标记 {id,title,battery}
  <job>/inbox/       容器存入的原始上传（zip/rar/dwg）
  <job>/src/         解压归档后的图纸文件夹（管线输入）
  <job>/out/         管线全部产物（txt/json/xlsx/日志/报告）
  <job>/STATUS       本进程写入的实时状态 {stage,detail,log,updated_at}
  <job>/out/sheets/  成品 Excel 逐 sheet 转储 JSON（前端可视化用）
"""
import json, os, subprocess, time, glob, shutil, sys

BASE = os.environ.get('DRAWING_UPLOAD_DIR', '/root/test-platform/uploads/drawing')
PIPE = os.environ.get('DRAWING_PIPELINE', '/root/drawing-tools/scripts/run_pipeline.py')
LOG_LINES = 40          # STATUS 内保留的日志尾行数
SHEET_ROW_CAP = 2000    # 单 sheet 可视化行数上限（导出仍是完整 xlsx）

JOB_N_DWG = {}  # jobId -> 图纸数（供 STATUS 携带，平台落库显示）

def write_status(job, stage, detail='', log=''):
    st = {'stage': stage, 'detail': detail, 'log': log.split('\n')[-LOG_LINES:],
          'n_dwgs': JOB_N_DWG.get(os.path.basename(job)),
          'updated_at': time.strftime('%Y-%m-%d %H:%M:%S')}
    tmp = os.path.join(job, 'STATUS.tmp')
    with open(tmp, 'w') as f: json.dump(st, f, ensure_ascii=False)
    os.replace(tmp, os.path.join(job, 'STATUS'))

def tail(path, n=LOG_LINES):
    try:
        lines = open(path, errors='replace').read().split('\n')
        return '\n'.join(lines[-n:])
    except Exception:
        return ''

def stage_from_log(out_dir):
    """从编排器日志推断当前阶段（编排器无进度回调，按日志尾部分析）"""
    t = tail(out_dir + '/pipeline.log', 5)
    if '完成：' in t: return '完成'
    if 'gen_routing' in t or '路由表.xlsx' in t: return '生成Excel'
    if 'mine_lv' in t or 'mine_g6' in t or 'txmatch' in t: return '路由挖掘'
    if '共 ' in t and ' 个 DWG' in t: return '格式转换'
    return '处理中'

def dump_sheets(out_dir):
    """成品 xlsx → 逐 sheet JSON（headers/rows/total），供前端表格可视化"""
    import openpyxl
    xlsx = os.path.join(out_dir, '路由表.xlsx')
    if not os.path.exists(xlsx): return None
    sd = os.path.join(out_dir, 'sheets'); os.makedirs(sd, exist_ok=True)
    wb = openpyxl.load_workbook(xlsx, read_only=True, data_only=True)
    index = []
    safe = lambda s, i: (s.replace('/', '_')[:40] or f'sheet{i}')
    for i, ws in enumerate(wb.worksheets):
        rows = []
        for row in ws.iter_rows(values_only=True):
            vals = ['' if v is None else str(v) for v in row]
            if any(v.strip() for v in vals): rows.append(vals)
        total = len(rows)
        name = safe(ws.title, i)
        json.dump({'name': ws.title, 'total': total, 'rows': rows[:SHEET_ROW_CAP]},
                  open(os.path.join(sd, f'{name}.json'), 'w'), ensure_ascii=False)
        index.append({'name': ws.title, 'total': total,
                      'truncated': total > SHEET_ROW_CAP, 'file': f'{name}.json'})
    json.dump(index, open(os.path.join(sd, 'index.json'), 'w'), ensure_ascii=False)
    return index

def run_job(job):
    m = json.load(open(os.path.join(job, 'JOB')))
    out_dir = os.path.join(job, 'out'); src = os.path.join(job, 'src')
    inbox = os.path.join(job, 'inbox')
    os.makedirs(out_dir, exist_ok=True); os.makedirs(src, exist_ok=True)
    write_status(job, '解压归档', '整理上传文件')
    n_dwgs = 0
    for f in sorted(glob.glob(os.path.join(inbox, '*'))):
        low = f.lower()
        if low.endswith('.zip') or low.endswith('.rar'):
            r = subprocess.run(['bsdtar', '-xf', f, '-C', src], capture_output=True, timeout=600)
            if r.returncode != 0:  # 解压失败要报真实原因，不能误报"没有 dwg"
                write_status(job, 'error', f'解压失败({os.path.basename(f)}): {r.stderr.decode(errors="replace")[:300]}')
                return
        elif low.endswith('.dwg'):
            os.makedirs(os.path.join(src, 'dwg_direct'), exist_ok=True)
            shutil.copy2(f, os.path.join(src, 'dwg_direct', os.path.basename(f)))
    n_dwgs = sum(1 for r, _, fs in os.walk(src) for fn in fs if fn.lower().endswith('.dwg'))
    JOB_N_DWG[os.path.basename(job)] = n_dwgs
    if n_dwgs == 0:
        write_status(job, 'error', '未在上传内容中发现任何 .dwg 文件', tail(out_dir + '/pipeline.log'))
        return
    write_status(job, '格式转换', f'共 {n_dwgs} 张 DWG，ODA 转换中（大图纸较慢，请耐心）')
    cmd = ['python3', '-u', PIPE, src, out_dir, '--title', m.get('title') or '测试界面路由表(平台) V1.0']
    if m.get('battery') and os.path.exists(os.path.join(inbox, m['battery'])):
        cmd += ['--battery', os.path.join(inbox, m['battery'])]
    for opt, key in (('--pairs', 'pairs'), ('--floors', 'floors')):
        if m.get(key): cmd += [opt, str(m[key])]
    with open(os.path.join(out_dir, 'pipeline.log'), 'a') as lg:
        p = subprocess.Popen(cmd, stdout=lg, stderr=lg)
    # 运行中：每 2s 刷新阶段 + 日志尾
    t0 = time.time()
    txt_out = os.path.join(out_dir, 'txt')
    while p.poll() is None:
        done_n = sum(1 for _ in glob.glob(os.path.join(txt_out, 'txt_*.txt')))
        detail = ''
        if n_dwgs and done_n > 0:
            pct = min(done_n / n_dwgs, 0.98)
            elapsed = time.time() - t0
            eta = max(0, int(elapsed * (1 - pct) / pct / 60)) + 1
            if done_n == 0:
                detail = 'ODA 批量转换中（该阶段无逐张进度，%d 张预计 %d 分钟）' % (n_dwgs, max(1, n_dwgs // 3))
            else:
                detail = '已完成 %d/%d 张（%d%%），预计还需约 %d 分钟' % (done_n, n_dwgs, int(pct*100), eta)
        write_status(job, stage_from_log(out_dir), detail, tail(out_dir + '/pipeline.log'))
        time.sleep(5)
    dur = int((time.time() - t0) / 60)
    # 空壳判定 + 告警展示（report.steps.gen=fail(empty-lv) 或 warnings 非空时降级提示）
    warns, gen_fail = [], False
    try:
        rep = json.load(open(os.path.join(out_dir, 'report.json')))
        warns = rep.get('warnings') or []
        gen_fail = str((rep.get('steps') or {}).get('gen', '')).startswith('fail')
    except Exception:
        pass
    ok = os.path.exists(os.path.join(out_dir, '路由表.xlsx')) and p.returncode == 0 and not gen_fail
    if ok:
        write_status(job, '生成可视化', 'Excel 完成，转储表格数据', tail(out_dir + '/pipeline.log'))
        dump_sheets(out_dir)
        extra = ('。注意：' + '；'.join(warns)) if warns else ''
        write_status(job, 'done', f'成功：{n_dwgs} 张图纸，总耗时 {dur} 分钟{extra}', tail(out_dir + '/pipeline.log'))
    else:
        write_status(job, 'error', f'管线失败（rc={p.returncode}，已运行 {dur} 分钟），详见日志', tail(out_dir + '/pipeline.log'))

def main():
    os.makedirs(BASE, exist_ok=True)
    # 启动清扫：上次崩溃遗留的运行中任务标记为失败
    for st in glob.glob(os.path.join(BASE, '*', 'STATUS')):
        job = os.path.dirname(st)
        try:
            if json.load(open(st)).get('stage') not in ('done', 'error') and os.path.exists(os.path.join(job, 'JOB')):
                write_status(job, 'error', '执行器重启，任务中断，请重新发起', tail(os.path.join(job, 'out', 'pipeline.log')))
        except Exception:
            pass
    print('drawing-runner 就绪，监听', BASE, flush=True)
    while True:
        for job in sorted(glob.glob(os.path.join(BASE, '*'))):
            if not os.path.isdir(job): continue
            if os.path.exists(os.path.join(job, 'JOB')) and not os.path.exists(os.path.join(job, 'STATUS')):
                print('执行任务', job, flush=True)
                try: run_job(job)
                except Exception as e:
                    try: write_status(job, 'error', f'执行器异常：{e}')
                    except Exception: pass  # 任务目录可能已被删除
        time.sleep(2)

if __name__ == '__main__':
    main()
