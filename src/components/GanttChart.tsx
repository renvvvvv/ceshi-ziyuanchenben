import { useMemo } from 'react';
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
  '测试中': { bg: 'rgba(77, 159, 255, 0.15)', text: '#4d9fff' },
  '未开始': { bg: 'rgba(250, 173, 20, 0.15)', text: '#faad14' },
  '已完成': { bg: 'rgba(82, 196, 26, 0.15)', text: '#52c41a' },
  '阻塞': { bg: 'rgba(255, 77, 79, 0.15)', text: '#ff4d4f' },
};

const barColors: Record<string, string> = {
  '测试中': 'linear-gradient(135deg, #4d9fff, #69b1ff)',
  '未开始': 'linear-gradient(135deg, #faad14, #ffc53d)',
  '已完成': 'linear-gradient(135deg, #52c41a, #73d13d)',
  '阻塞': 'linear-gradient(135deg, #ff4d4f, #ff7875)',
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
  const dayWidth = UNIT_DAY_WIDTH[unit];
  const tickInterval = UNIT_TICK[unit].interval;

  const {
    ticks,
    majorGroups,
    projectBars,
    totalDays,
    totalWidth,
    todayOffsetPx,
    todayTickIndex,
  } = useMemo(() => {
    if (projects.length === 0) {
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

    // 计算全局时间范围，两端各留余量
    const allStarts = projects.map((p) => dayjs(p.startDate));
    const allEnds = projects.map((p) => dayjs(p.endDate || dayjs().add(1, 'month')));
    const globalStart = allStarts
      .reduce((a, b) => (a.isBefore(b) ? a : b))
      .subtract(2, 'day')
      .startOf('day');
    const globalEnd = allEnds
      .reduce((a, b) => (a.isAfter(b) ? a : b))
      .add(2, 'day')
      .startOf('day');
    const daysTotal = Math.max(globalEnd.diff(globalStart, 'day'), 1);

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

    // 项目条
    const bars: ProjectBar[] = projects
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
  }, [projects, unit, dayWidth, tickInterval]);

  if (projects.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.4)' }}>
        暂无进行中或未开始的项目
      </div>
    );
  }

  const showToday = todayTickIndex >= 0 && todayOffsetPx <= totalWidth;
  // 每个刻度的像素宽度
  const tickWidth = tickInterval * dayWidth;

  return (
    <div className="gantt-container">
      {/* 图例 */}
      <div className="gantt-legend">
        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginRight: 16 }}>图例：</span>
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
            <span style={{ color: statusColors[status]?.text || '#fff' }}>{status}</span>
          </span>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 8, fontSize: 11 }}>
          <span
            style={{
              display: 'inline-block',
              width: 1,
              height: 14,
              background: '#ff4d4f',
              marginRight: 4,
            }}
          />
          <span style={{ color: '#ff4d4f' }}>今天</span>
        </span>
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
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>项目名称</span>
            </div>
            {/* 右侧时间轴表头 */}
            <div style={{ position: 'relative', width: totalWidth, minWidth: totalWidth, height: '100%' }}>
              {/* 上层：主刻度分组 */}
              <div
                style={{
                  position: 'relative',
                  height: HEADER_MAJOR_HEIGHT,
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
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
                      color: 'rgba(255,255,255,0.65)',
                      borderRight: '1px solid rgba(255,255,255,0.12)',
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
                      borderRight: '1px solid rgba(255,255,255,0.06)',
                      boxSizing: 'border-box',
                      ...(showToday && idx === todayTickIndex
                        ? { background: 'rgba(255, 77, 79, 0.08)' }
                        : {}),
                    }}
                  >
                    <span
                      style={{
                        fontSize: t.isMajor ? 10 : 9,
                        whiteSpace: 'nowrap',
                        color: t.isMajor ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)',
                        fontFamily: "'Outfit', 'Noto Sans SC', sans-serif",
                        lineHeight: 1,
                        ...(showToday && idx === todayTickIndex
                          ? { color: '#ff4d4f', fontWeight: 700 }
                          : {}),
                      }}
                    >
                      {t.label}
                    </span>
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
                      <span style={{ color: '#fff', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {project.name}
                      </span>
                      <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {project.customer} · {project.city}
                        {project.plannedManpower ? ` · ${project.plannedManpower}人` : ''}
                      </span>
                    </div>
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
                            ? '1px solid rgba(255,255,255,0.13)'
                            : '1px solid rgba(255,255,255,0.04)',
                          boxSizing: 'border-box',
                          position: 'relative',
                          ...(showToday && idx === todayTickIndex
                            ? { background: 'rgba(255,77,79,0.04)' }
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
                        <span className="gantt-bar-label">
                          {dayjs(project.startDate).format('MM/DD')} — {project.endDate ? dayjs(project.endDate).format('MM/DD') : '至今'}
                          {project.plannedManpower ? ` · ${project.plannedManpower}人` : ''}
                        </span>
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
