import { useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import type { Project } from '../types';

export type GanttUnit = 'day' | 'week' | 'month' | 'quarter' | 'year';

interface GanttChartProps {
  projects: Project[];
  unit?: GanttUnit;
}

// 不同单位对应的每天像素宽度
const UNIT_DAY_WIDTH: Record<GanttUnit, number> = {
  day:     28,  // 每天 28px
  week:    16,  // 每周 ~112px
  month:   6,   // 每月 ~180px
  quarter: 3,   // 每季 ~270px
  year:    1.5, // 每年 ~547px
};

// 不同单位的刻度间隔（天数）和格式
const UNIT_TICK: Record<GanttUnit, { interval: number; majorEvery: number }> = {
  day:     { interval: 1,   majorEvery: 1 },   // 每天一个刻度，每月一个主刻度
  week:    { interval: 7,   majorEvery: 4 },   // 每周一个刻度，每4周一个主刻度
  month:   { interval: 30,  majorEvery: 1 },   // 每月一个刻度
  quarter: { interval: 90,  majorEvery: 1 },   // 每季一个刻度
  year:    { interval: 365, majorEvery: 1 },   // 每年一个刻度
};

const statusColors: Record<string, { bg: string; text: string }> = {
  '测试中': { bg: 'rgba(99,102,241, 0.15)', text: '#6366f1' },
  '未开始': { bg: 'rgba(217, 119, 6, 0.15)', text: '#d97706' },
  '已完成': { bg: 'rgba(22, 163, 74, 0.15)', text: '#16a34a' },
  '阻塞': { bg: 'rgba(220, 38, 38, 0.15)', text: '#dc2626' },
};

const barColors: Record<string, string> = {
  '测试中': 'linear-gradient(135deg, #6366f1, #818cf8)',
  '未开始': 'linear-gradient(135deg, #d97706, #f59e0b)',
  '已完成': 'linear-gradient(135deg, #16a34a, #73d13d)',
  '阻塞': 'linear-gradient(135deg, #dc2626, #f87171)',
};

/** 左侧项目名宽度 */
const LABEL_WIDTH = 260;
/** 表头：上层（主刻度）高度 */
const HEADER_MAJOR_HEIGHT = 24;
/** 表头：下层（次刻度）高度 */
const HEADER_MINOR_HEIGHT = 30;

interface Tick {
  date: dayjs.Dayjs;
  offset: number;        // 距全局起点的天数
  isMajor: boolean;      // 是否为主刻度（月份/季度/年份起点）
  label: string;         // 显示文本
}

interface MajorGroup {
  label: string;
  startOffset: number;
  widthDays: number;
}

interface ProjectBar {
  project: Project;
  leftPx: number;
  widthPx: number;
}

/** 格式化刻度标签 */
function formatTickLabel(date: dayjs.Dayjs, unit: GanttUnit, isMajor: boolean): string {
  switch (unit) {
    case 'day':
      if (isMajor) return date.format('M月');
      return String(date.date());
    case 'week':
      if (isMajor) return date.format('M月');
      return `W${Math.ceil(date.date() / 7)}`;
    case 'month':
      if (isMajor) return date.format('YYYY年');
      return date.format('M月');
    case 'quarter':
      if (isMajor) return date.format('YYYY年');
      return `Q${Math.floor(date.month() / 3) + 1}`;
    case 'year':
      if (isMajor) return date.format('YYYY年');
      return date.format('YY');
    default:
      return date.format('MM-DD');
  }
}

/** 判断是否为主刻度（月份/季度/年份的起点） */
function isMajorTick(date: dayjs.Dayjs, unit: GanttUnit): boolean {
  switch (unit) {
    case 'day':
    case 'week':
      return date.date() === 1; // 每月1号
    case 'month':
      return date.month() === 0; // 1月
    case 'quarter':
      return date.month() === 0; // 1月（Q1起点）
    case 'year':
      return date.month() === 0 && date.date() === 1;
    default:
      return false;
  }
}

function GanttChart({ projects, unit = 'day' }: GanttChartProps) {
  const navigate = useNavigate();
  const tickInterval = UNIT_TICK[unit].interval;

  // 过滤无效日期项目（缺开始日期的会渲染出 Invalid Date 且条形像素为 NaN）
  const validProjects = useMemo(
    () => projects.filter((p) => p.startDate && dayjs(p.startDate).isValid()),
    [projects],
  );
  const skippedCount = projects.length - validProjects.length;

  // 容器宽度：dayWidth 自适应（时间轴一屏放下，条形比例真实，不再超宽滚动）
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 时间范围（不依赖 dayWidth，先独立计算）
  // 起点始终包含"今天"：全部项目都在未来时，今天红线仍应可见
  const range = useMemo(() => {
    if (validProjects.length === 0) return null;
    const allStarts = validProjects.map((p) => dayjs(p.startDate));
    const allEnds = validProjects.map((p) => dayjs(p.endDate || dayjs().add(1, 'month')));
    const today = dayjs().startOf('day');
    const globalStart = [
      allStarts.reduce((a, b) => (a.isBefore(b) ? a : b)),
      today,
    ].reduce((a, b) => (a.isBefore(b) ? a : b))
      .subtract(2, 'day')
      .startOf('day');
    const globalEnd = allEnds
      .reduce((a, b) => (a.isAfter(b) ? a : b))
      .add(2, 'day')
      .startOf('day');
    return { globalStart, globalEnd, daysTotal: Math.max(globalEnd.diff(globalStart, 'day'), 1) };
  }, [validProjects]);

  // 自适应每日像素：按容器宽平铺时必须扣除左侧项目名列与容器内边距，
  // 否则 totalWidth + LABEL_WIDTH 恒超出容器，横向滚动条永远存在。
  // 下限取 min(3, base)：year/quarter 单位的基础宽度小于 3 时不能强行抬高。
  const dayWidth = useMemo(() => {
    const base = UNIT_DAY_WIDTH[unit];
    if (containerWidth > 0 && range && range.daysTotal > 0) {
      const usable = containerWidth - LABEL_WIDTH - 56;
      const fit = usable / range.daysTotal;
      const floor = Math.min(3, base);
      return Math.max(floor, Math.min(base, fit));
    }
    return base;
  }, [containerWidth, range, unit]);

  const {
    ticks,
    majorGroups,
    projectBars,
    totalDays,
    totalWidth,
    todayOffsetPx,
    todayTickIndex,
  } = useMemo(() => {
    if (validProjects.length === 0 || !range) {
      return {
        ticks: [] as Tick[],
        majorGroups: [] as MajorGroup[],
        projectBars: [] as ProjectBar[],
        totalDays: 0,
        totalWidth: 0,
        todayOffsetPx: -1,
        todayTickIndex: -1,
      };
    }

    // 全局时间范围（已在上方 range 中计算）
    const { globalStart, globalEnd, daysTotal } = range;

    // 生成刻度
    const tickArr: Tick[] = [];
    let cursor = globalStart.clone();
    let dayOffset = 0;
    while (cursor.isBefore(globalEnd) || cursor.isSame(globalEnd, 'day')) {
      const major = isMajorTick(cursor, unit);
      tickArr.push({
        date: cursor.clone(),
        offset: dayOffset,
        isMajor: major,
        label: formatTickLabel(cursor, unit, major),
      });
      cursor = cursor.add(tickInterval, 'day');
      dayOffset += tickInterval;
    }

    // 主刻度分组（上层表头）
    const groups: MajorGroup[] = [];
    const crossYear = globalStart.year() !== globalEnd.year();

    if (unit === 'day' || unit === 'week') {
      // 按月分组
      let monthCursor = globalStart.startOf('month');
      while (monthCursor.isBefore(globalEnd)) {
        const monthEnd = monthCursor.endOf('month').add(1, 'day');
        const s = Math.max(monthCursor.diff(globalStart, 'day'), 0);
        const e = Math.min(monthEnd.diff(globalStart, 'day'), daysTotal);
        groups.push({
          label: monthCursor.format(crossYear ? 'YYYY年M月' : 'M月'),
          startOffset: s,
          widthDays: Math.max(e - s, 1),
        });
        monthCursor = monthCursor.add(1, 'month');
      }
    } else if (unit === 'month') {
      // 按年分组
      let yearCursor = globalStart.startOf('year');
      while (yearCursor.isBefore(globalEnd)) {
        const yearEnd = yearCursor.endOf('year').add(1, 'day');
        const s = Math.max(yearCursor.diff(globalStart, 'day'), 0);
        const e = Math.min(yearEnd.diff(globalStart, 'day'), daysTotal);
        groups.push({
          label: yearCursor.format('YYYY年'),
          startOffset: s,
          widthDays: Math.max(e - s, 1),
        });
        yearCursor = yearCursor.add(1, 'year');
      }
    } else if (unit === 'quarter') {
      // 按年分组
      let yearCursor = globalStart.startOf('year');
      while (yearCursor.isBefore(globalEnd)) {
        const yearEnd = yearCursor.endOf('year').add(1, 'day');
        const s = Math.max(yearCursor.diff(globalStart, 'day'), 0);
        const e = Math.min(yearEnd.diff(globalStart, 'day'), daysTotal);
        groups.push({
          label: yearCursor.format('YYYY年'),
          startOffset: s,
          widthDays: Math.max(e - s, 1),
        });
        yearCursor = yearCursor.add(1, 'year');
      }
    } else {
      // year: 按年分组
      let yearCursor = globalStart.startOf('year');
      while (yearCursor.isBefore(globalEnd)) {
        const yearEnd = yearCursor.endOf('year').add(1, 'day');
        const s = Math.max(yearCursor.diff(globalStart, 'day'), 0);
        const e = Math.min(yearEnd.diff(globalStart, 'day'), daysTotal);
        groups.push({
          label: yearCursor.format('YYYY年'),
          startOffset: s,
          widthDays: Math.max(e - s, 1),
        });
        yearCursor = yearCursor.add(1, 'year');
      }
    }

    // 项目条（仅含日期有效的项目，validProjects 已过滤）
    const bars: ProjectBar[] = validProjects
      .map((project) => {
        const pStart = dayjs(project.startDate);
        const pEnd = dayjs(project.endDate || dayjs().add(1, 'month'));
        const startOffset = Math.max(pStart.diff(globalStart, 'day'), 0);
        const duration = Math.max(pEnd.diff(pStart, 'day'), 1);
        return {
          project,
          leftPx: startOffset * dayWidth,
          widthPx: duration * dayWidth,
        };
      })
      .sort((a, b) => dayjs(a.project.startDate).diff(dayjs(b.project.startDate)));

    // 今天的位置
    const todayDay = dayjs().startOf('day').diff(globalStart, 'day');
    const tIdx = tickArr.findIndex(
      (t) => t.date.format('YYYY-MM-DD') === dayjs().startOf('day').format('YYYY-MM-DD'),
    );

    return {
      ticks: tickArr,
      majorGroups: groups,
      projectBars: bars,
      totalDays: daysTotal,
      totalWidth: daysTotal * dayWidth,
      todayOffsetPx: todayDay * dayWidth,
      todayTickIndex: tIdx >= 0 ? tIdx : -1,
    };
  }, [validProjects, range, unit, dayWidth, tickInterval]);

  if (validProjects.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: '#6b6892' }}>
        {projects.length === 0 ? '暂无进行中或未开始的项目' : '当前项目均未设置开始日期，无法绘制甘特图'}
      </div>
    );
  }

  // 今天红线：只要今天落在时间轴范围内就显示（不要求刻度恰好命中今天）
  const showToday = todayOffsetPx >= 0 && todayOffsetPx <= totalWidth;
  // 每个刻度的像素宽度；压缩显示时（tickWidth 过小）隐藏次要刻度文字防重叠
  const tickWidth = tickInterval * dayWidth;
  const showMinorLabels = tickWidth >= 14;

  return (
    <div className="gantt-container" ref={containerRef}>
      {/* 图例 */}
      <div className="gantt-legend">
        <span style={{ color: '#6b6892', fontSize: 11, marginRight: 16 }}>图例：</span>
        {Object.entries(barColors).map(([status, gradient]) => (
          <span key={status} style={{ display: 'inline-flex', alignItems: 'center', marginRight: 16, fontSize: 11 }}>
            <span
              style={{
                display: 'inline-block',
                width: 12,
                height: 12,
                borderRadius: 3,
                background: gradient,
                marginRight: 4,
              }}
            />
            <span style={{ color: statusColors[status]?.text || '#1e1b2e' }}>{status}</span>
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 8, fontSize: 11 }}>
          <span
            style={{
              display: 'inline-block',
              width: 1,
              height: 14,
              background: '#dc2626',
              marginRight: 4,
            }}
          />
          <span style={{ color: '#dc2626' }}>今天</span>
        </span>
        {skippedCount > 0 && (
          <span style={{ marginLeft: 12, fontSize: 11, color: '#d97706' }}>
            ⚠ {skippedCount} 个项目未设置开始日期，未在图中展示
          </span>
        )}
      </div>

      {/* 甘特图主体（横向滚动容器） */}
      <div className="gantt-body">
        <div style={{ minWidth: LABEL_WIDTH + totalWidth }}>
          {/* 双层表头 */}
          <div className="gantt-header-row" style={{ height: HEADER_MAJOR_HEIGHT + HEADER_MINOR_HEIGHT }}>
            {/* 左上：项目名 */}
            <div
              className="gantt-label-col gantt-sticky-label"
              style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH, flexDirection: 'column', justifyContent: 'center', height: '100%' }}
            >
              <span style={{ color: '#6b6892', fontSize: 12 }}>项目名称</span>
            </div>
            {/* 右侧时间轴表头 */}
            <div style={{ position: 'relative', width: totalWidth, minWidth: totalWidth, height: '100%' }}>
              {/* 上层：主刻度分组 */}
              <div
                style={{
                  position: 'relative',
                  height: HEADER_MAJOR_HEIGHT,
                  borderBottom: '1px solid #e9e7f4',
                }}
              >
                {majorGroups.map((g, idx) => (
                  <div
                    key={idx}
                    style={{
                      position: 'absolute',
                      left: g.startOffset * dayWidth,
                      width: g.widthDays * dayWidth,
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#46436a',
                      borderRight: '1px solid #d9d5f0',
                      fontFamily: "'Outfit', 'Noto Sans SC', sans-serif",
                    }}
                  >
                    {g.label}
                  </div>
                ))}
              </div>
              {/* 下层：次刻度 */}
              <div
                style={{
                  position: 'relative',
                  height: HEADER_MINOR_HEIGHT,
                  display: 'flex',
                  flexDirection: 'row',
                }}
              >
                {ticks.map((t, idx) => (
                  <div
                    key={idx}
                    style={{
                      flexShrink: 0,
                      width: tickWidth,
                      minWidth: tickWidth,
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRight: '1px solid #e9e7f4',
                      boxSizing: 'border-box',
                      ...(showToday && idx === todayTickIndex
                        ? { background: 'rgba(220, 38, 38, 0.08)' }
                        : {}),
                    }}
                  >
                    {(t.isMajor || showMinorLabels) && (
                      <span
                        style={{
                          fontSize: t.isMajor ? 10 : 9,
                          whiteSpace: 'nowrap',
                          color: t.isMajor ? '#46436a' : '#9d9ab8',
                          fontFamily: "'Outfit', 'Noto Sans SC', sans-serif",
                          lineHeight: 1,
                          ...(showToday && idx === todayTickIndex
                            ? { color: '#dc2626', fontWeight: 700 }
                            : {}),
                        }}
                      >
                        {t.label}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 项目行 */}
          <div className="gantt-rows">
            {projectBars.map(({ project, leftPx, widthPx }) => {
              const colors = statusColors[project.status] || statusColors['未开始'];
              const barGradient = barColors[project.status] || barColors['未开始'];

              return (
                <div
                  key={project.id}
                  className="gantt-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/projects/${project.id}`)}
                >
                  {/* 项目标签（横向滚动时固定） */}
                  <div
                    className="gantt-label-col gantt-sticky-label"
                    style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH, height: '100%' }}
                  >
                    <Tooltip
                      title={
                        <div style={{ fontSize: 12 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>{project.name}</div>
                          <div>客户：{project.customer || '-'}</div>
                          <div>城市：{project.city || '-'}</div>
                          <div>状态：{project.status}</div>
                          <div>计划人力：{project.plannedManpower ?? '-'} 人</div>
                        </div>
                      }
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden', minWidth: 0, flex: 1 }}>
                        <span style={{ color: '#1e1b2e', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', minWidth: 0 }}>
                          {project.name}
                        </span>
                        <span style={{ color: '#6b6892', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', minWidth: 0 }}>
                          {project.customer}{project.city ? ` · ${project.city}` : ''}
                          {project.plannedManpower ? ` · ${project.plannedManpower}人` : ''}
                        </span>
                      </div>
                    </Tooltip>
                    <Tag
                      style={{
                        background: colors.bg,
                        color: colors.text,
                        border: `1px solid ${colors.text}44`,
                        borderRadius: 4,
                        fontSize: 11,
                        flexShrink: 0,
                        marginLeft: 8,
                      }}
                    >
                      {project.status}
                    </Tag>
                  </div>

                  {/* 时间线区域 */}
                  <div
                    className="gantt-timeline-col"
                    style={{
                      position: 'relative',
                      width: totalWidth,
                      minWidth: totalWidth,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'row',
                    }}
                  >
                    {/* 网格背景列 */}
                    {ticks.map((t, idx) => (
                      <div
                        key={idx}
                        style={{
                          flexShrink: 0,
                          width: tickWidth,
                          minWidth: tickWidth,
                          height: '100%',
                          borderRight: t.isMajor
                            ? '1px solid #e9e7f4'
                            : '1px solid #f8f7fd',
                          boxSizing: 'border-box',
                          position: 'relative',
                          ...(showToday && idx === todayTickIndex
                            ? { background: 'rgba(220,38,38,0.04)' }
                            : {}),
                        }}
                      />
                    ))}

                    {/* 今天标记线 */}
                    {showToday && (
                      <div className="gantt-today-line" style={{ left: todayOffsetPx }}>
                        <div className="gantt-today-dot" />
                      </div>
                    )}

                    {/* 项目条 */}
                    <Tooltip
                      title={
                        <div style={{ fontSize: 12 }}>
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>{project.name}</div>
                          <div>状态：{project.status}</div>
                          <div>开始：{dayjs(project.startDate).format('YYYY-MM-DD')}</div>
                          <div>结束：{project.endDate ? dayjs(project.endDate).format('YYYY-MM-DD') : '未定'}</div>
                          <div>IT产出：{project.itOutput} MW</div>
                          <div>计划人力：{project.plannedManpower ?? '-'} 人</div>
                          <div>周期：{Math.max(dayjs(project.endDate || dayjs().add(1, 'month')).diff(project.startDate, 'day'), 1)} 天</div>
                        </div>
                      }
                    >
                      <div
                        className="gantt-bar"
                        style={{
                          left: leftPx,
                          width: Math.max(widthPx, tickWidth),
                          background: barGradient,
                          boxShadow: `0 2px 8px ${colors.text}33`,
                        }}
                      >
                        {(() => {
                          // 根据 bar 像素宽度自适应渲染 label，避免窄 bar 被截断后产生乱字符
                          const barWidth = Math.max(widthPx, tickWidth);
                          const startMD = dayjs(project.startDate).format('MM/DD');
                          const endMD = project.endDate ? dayjs(project.endDate).format('MM/DD') : '至今';
                          if (barWidth < 56) {
                            // 极窄 bar：留空，详细信息走 Tooltip
                            return <span className="gantt-bar-label" />;
                          }
                          if (barWidth < 120) {
                            // 窄 bar：只显示开始日期
                            return <span className="gantt-bar-label">{startMD}</span>;
                          }
                          if (barWidth < 200) {
                            // 中等 bar：显示开始 — 结束日期
                            return <span className="gantt-bar-label">{startMD} — {endMD}</span>;
                          }
                          // 宽 bar：完整信息
                          const parts = [`${startMD} — ${endMD}`];
                          if (project.plannedManpower) parts.push(`${project.plannedManpower}人`);
                          if (project.itOutput) parts.push(`${project.itOutput}MW`);
                          return <span className="gantt-bar-label">{parts.join(' · ')}</span>;
                        })()}
                      </div>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default GanttChart;
