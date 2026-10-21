/**
 * 轻量运营追踪中间件（纯内存，重启清零；供 /api/status 聚合）
 * - 模块调用计数（按 URL 前缀映射业务模块，按日重置）
 * - 用户活跃（username → 最近请求时间 → 在线 5 分钟 / 今日活跃）
 * - 最近错误（5xx）与慢请求（>1.5s）环形保留 20 条
 */
import { Request, Response, NextFunction } from 'express';

/** 本地日期（容器 TZ=Asia/Shanghai），日切按北京时间而非 UTC */
const localDate = () => new Date().toLocaleDateString('en-CA');

const MODULE_MAP: Array<[RegExp, string]> = [
  [/^\/api\/kb\/qa/, 'AI测试专家'],
  [/^\/api\/kb/, '知识库'],
  [/^\/api\/auth/, '登录鉴权'],
  [/^\/api\/projects\/members/, '人员池'],
  [/^\/api\/projects\/history/, '历史项目'],
  [/^\/api\/projects/, '项目管理'],
  [/^\/api\/drawing/, '图纸路由'],
  [/^\/api\/syslogs/, '故障日志'],
  [/^\/api\/report-review/, '测试报告审核'],
  [/^\/api\/attendance/, '人员考勤'],
  [/^\/api\/resource-calc/, '资源计算器'],
  [/^\/api\/rc/, '资源配置'],
  [/^\/api\/test-docs/, '测试管理制度'],
];

interface Issue { time: string; method: string; url: string; status: number; ms: number; user?: string }

const state = {
  date: localDate(),
  moduleHits: new Map<string, number>(),
  userLastSeen: new Map<string, number>(),
  issues: [] as Issue[],
};

function resetIfNewDay() {
  const today = localDate();
  if (state.date !== today) {
    state.date = today;
    state.moduleHits.clear();
    state.userLastSeen.clear();
    state.issues = [];
  }
}

export function trackActivity(req: Request, res: Response, next: NextFunction) {
  resetIfNewDay();
  const url = req.originalUrl || req.url || '';
  // 健康/状态探测不计入模块热度
  if (!/^\/api\/(health|status)/.test(url)) {
    for (const [re, mod] of MODULE_MAP) {
      if (re.test(url)) {
        state.moduleHits.set(mod, (state.moduleHits.get(mod) || 0) + 1);
        break;
      }
    }
  }
  const u = (req as any).user?.username as string | undefined;
  if (u) state.userLastSeen.set(u, Date.now());

  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const bad = res.statusCode >= 500;
    const slow = ms > 1500;
    if ((bad || slow) && state.issues.length < 20) {
      state.issues.push({
        time: new Date().toISOString(), method: req.method,
        url: url.slice(0, 120), status: res.statusCode, ms, user: u,
      });
    }
  });
  next();
}

export function getTrackingSnapshot() {
  resetIfNewDay();
  const now = Date.now();
  const online5min = [...state.userLastSeen.values()].filter(t => now - t < 5 * 60_000).length;
  const activeToday = state.userLastSeen.size;
  return {
    modules_today: Object.fromEntries([...state.moduleHits.entries()].sort((a, b) => b[1] - a[1])),
    users: { active_5min: online5min, active_today_tracked: activeToday },
    issues: state.issues.slice(-10),
  };
}
