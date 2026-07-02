import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import type { Project } from '../types';

interface GanttChartProps {
  projects: Project[];
}

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

/** 每天固定像素宽度 */
const DAY_WIDTH = 28;
/** 左侧项目名宽度 */
const LABEL_WIDTH = 260;
/** 表头：月份层高度 */
const HEADER_MONTH_HEIGHT = 24;
/** 表头：日期层高度 */
const HEADER_DATE_HEIGHT = 30;

interface DayTick {
  date: dayjs.Dayjs;
  offset: number; // 距全局起点的天数（从0开始）
  isMonthStart: boolean;
}

interface MonthGroup {
  label: string;
  startOffset: number;
  widthDays: number;
}

interface ProjectBar {
  project: Project;
  leftPx: number;
  widthPx: number;
}

function GanttChart({ projects }: GanttChartProps) {
  const navigate = useNavigate();

  const {
    allDays,
    monthGroups,
    projectBars,
    totalDays,
    totalWidth,
    todayOffsetPx,
    todayIndex,
  } = useMemo<{
    allDays: DayTick[];
    monthGroups: MonthGroup[];
    projectBars: ProjectBar[];
    totalDays: number;
    totalWidth: number;
    todayOffsetPx: number;
    todayIndex: number; // 今天在第几天（用于高亮当天列）
  }>(() => {
    if (projects.length === 0) {
      return {
        allDays: [],
        monthGroups: [],
        projectBars: [],
        totalDays: 0,
        totalWidth: 0,
        todayOffsetPx: -1,
        todayIndex: -1,
      };
    }

    // 计算全局时间范围，两端各留 2 天余量
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

    // ====== 核心改动：每一天都生成一个刻度 ======
    const daysArr: DayTick[] = [];
    let cursor = globalStart.clone();
    let idx = 0;
    while (cursor.isBefore(globalEnd) || cursor.isSame(globalEnd, 'day')) {
      const offset = cursor.diff(globalStart, 'day');
      daysArr.push({
        date: cursor.clone(),
        offset,
        isMonthStart: cursor.date() === 1,
      });
      cursor = cursor.add(1, 'day');
      idx += 1;
    }

    // 月份分组（上层表头）
    const groups: MonthGroup[] = [];
    const crossYear = globalStart.year() !== globalEnd.year();
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

    // 项目条：按日偏移 × DAY_WIDTH 像素定位
    const bars: ProjectBar[] = projects
      .map((project) => {
        const pStart = dayjs(project.startDate);
        const pEnd = dayjs(project.endDate || dayjs().add(1, 'month'));
        const startOffset = Math.max(pStart.diff(globalStart, 'day'), 0);
        const duration = Math.max(pEnd.diff(pStart, 'day'), 1);
        return {
          project,
          leftPx: startOffset * DAY_WIDTH,
          widthPx: duration * DAY_WIDTH,
        };
      })
      .sort((a, b) => dayjs(a.project.startDate).diff(dayjs(b.project.startDate)));

    // 计算今天的位置
    const todayDay = dayjs().startOf('day').diff(globalStart, 'day');
    const tIdx = daysArr.findIndex(
      (d) => d.date.format('YYYY-MM-DD') === dayjs().startOf('day').format('YYYY-MM-DD'),
    );

    return {
      allDays: daysArr,
      monthGroups: groups,
      projectBars: bars,
      totalDays: daysTotal,
      totalWidth: daysTotal * DAY_WIDTH,
      todayOffsetPx: todayDay * DAY_WIDTH,
      todayIndex: tIdx >= 0 ? tIdx : -1,
    };
  }, [projects]);

  if (projects.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 48, color: 'rgba(255,255,255,0.4)' }}>
        暂无进行中或未开始的项目
      </div>
    );
  }

  const showToday = todayIndex >= 0 && todayOffsetPx <= totalWidth;

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
          <div className="gantt-header-row" style={{ height: HEADER_MONTH_HEIGHT + HEADER_DATE_HEIGHT }}>
            {/* 左上：项目名 */}
            <div
              className="gantt-label-col gantt-sticky-label"
              style={{ width: LABEL_WIDTH, minWidth: LABEL_WIDTH, flexDirection: 'column', justifyContent: 'center', height: '100%' }}
            >
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>项目名称</span>
            </div>
            {/* 右侧时间轴表头 —— 每一天一列 */}
            <div style={{ position: 'relative', width: totalWidth, minWidth: totalWidth, height: '100%' }}>
              {/* 上层：月份分组 */}
              <div
                style={{
                  position: 'relative',
                  height: HEADER_MONTH_HEIGHT,
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {monthGroups.map((g, idx) => (
                  <div
                    key={idx}
                    style={{
                      position: 'absolute',
                      left: g.startOffset * DAY_WIDTH,
                      width: g.widthDays * DAY_WIDTH,
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
              {/* 下层：每日刻度（每一格宽度=DAY_WIDTH） */}
              <div
                style={{
                  position: 'relative',
                  height: HEADER_DATE_HEIGHT,
                  display: 'flex',
                  flexDirection: 'row',
                }}
              >
                {allDays.map((d, idx) => (
                  <div
                    key={idx}
                    style={{
                      flexShrink: 0,
                      width: DAY_WIDTH,
                      minWidth: DAY_WIDTH,
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRight: '1px solid rgba(255,255,255,0.06)',
                      boxSizing: 'border-box',
                      ...(showToday && idx === todayIndex
                        ? {
                            background: 'rgba(255, 77, 79, 0.08)',
                          }
                        : {}),
                    }}
                  >
                    <span
                      style={{
                        fontSize: d.isMonthStart ? 10 : 8,
                        whiteSpace: 'nowrap',
                        color: d.isMonthStart ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)',
                        fontFamily: "'Outfit', 'Noto Sans SC', sans-serif",
                        lineHeight: 1,
                        ...(showToday && idx === todayIndex
                          ? { color: '#ff4d4f', fontWeight: 700 }
                          : {}),
                      }}
                    >
                      {d.date.date()}
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

                  {/* 时间线区域 —— 每日网格线 + 项目条 */}
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
                    {/* 每一天的网格背景列（用 flex 布局，每格宽 DAY_WIDTH） */}
                    {allDays.map((d, idx) => (
                      <div
                        key={idx}
                        style={{
                          flexShrink: 0,
                          width: DAY_WIDTH,
                          minWidth: DAY_WIDTH,
                          height: '100%',
                          borderRight: d.isMonthStart
                            ? '1px solid rgba(255,255,255,0.13)'
                            : '1px solid rgba(255,255,255,0.04)',
                          boxSizing: 'border-box',
                          position: 'relative',
                          ...(showToday && idx === todayIndex
                            ? { background: 'rgba(255,77,79,0.04)' }
                            : {}),
                        }}
                      />
                    ))}

                    {/* 今天标记线（绝对定位覆盖在 flex 列上方） */}
                    {showToday && (
                      <div className="gantt-today-line" style={{ left: todayOffsetPx }}>
                        <div className="gantt-today-dot" />
                      </div>
                    )}

                    {/* 项目条（绝对定位在时间线区域内） */}
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
                          width: Math.max(widthPx, DAY_WIDTH),
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
