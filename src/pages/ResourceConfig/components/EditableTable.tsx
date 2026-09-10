/**
 * 资源配置 · 通用可编辑表格（AntD Table 内联编辑引擎）
 *
 * 列定义 Column：text/number/select/textarea/date 之一；
 * rows 为「任意行对象数组」，单元格编辑即时回写 onChange(rows)。
 * footer 可传合计行；locked 时整表只读。
 */
import { ReactNode } from 'react';
import { Table, Input, InputNumber, Select, Button, Popconfirm, Tooltip } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { num, uid } from '../types';

export interface EditColumn<T> {
  key: keyof T & string;
  title: string;
  width?: number;
  type?: 'text' | 'number' | 'select' | 'textarea' | 'date';
  options?: { value: string; label: string }[];
  placeholder?: string;
  readonly?: boolean;                    // 展示列（如自动核算值）
  render?: (v: any, row: T, idx: number) => ReactNode;  // 只读列自定义渲染
  align?: 'left' | 'right' | 'center';
}

interface Props<T extends Record<string, any>> {
  columns: EditColumn<T>[];
  rows: T[];
  onChange: (rows: T[]) => void;
  newRow: () => T;
  locked?: boolean;
  rowKey?: (r: T, i: number) => string;
  footer?: ReactNode;                     // 合计行/说明（由页面自行拼装）
  addLabel?: string;
  minWidth?: number;
  size?: 'small' | 'middle';
}

export default function EditableTable<T extends Record<string, any>>({
  columns, rows, onChange, newRow, locked, footer, addLabel = '添加一行', minWidth = 900, size = 'small',
}: Props<T>) {
  const setCell = (i: number, key: string, v: unknown) => {
    const next = rows.map((r, idx) => idx === i ? { ...r, [key]: v } : r);
    onChange(next);
  };
  const del = (i: number) => onChange(rows.filter((_, idx) => idx !== i));

  const cols: any[] = [
    { title: '#', width: 44, fixed: 'left' as const, render: (_: any, __: T, i: number) => <span style={{ color: '#9d9ab8' }}>{i + 1}</span> },
    ...columns.map(c => ({
      title: c.title, width: c.width, align: c.align,
      render: (_: any, row: T, i: number) => {
        if (c.render && (c.readonly || locked)) return c.render(row[c.key], row, i);
        if (locked || c.readonly) return <span>{c.type === 'number' ? num(row[c.key]) : String(row[c.key] ?? '')}</span>;
        const v = row[c.key];
        const common = { style: { width: '100%' }, size: 'small' as const, placeholder: c.placeholder, bordered: false };
        switch (c.type) {
          case 'number':
            return <InputNumber {...common} value={num(v)} min={0}
              onChange={x => setCell(i, c.key, x ?? 0)} />;
          case 'select':
            return <Select {...common} value={v ?? undefined} options={c.options} allowClear showSearch
              onChange={x => setCell(i, c.key, x)} />;
          case 'textarea':
            return <Input.TextArea {...common} value={String(v ?? '')} autoSize={{ minRows: 1, maxRows: 4 }}
              onChange={e => setCell(i, c.key, e.target.value)} />;
          case 'date':
            return <Input {...common} value={String(v ?? '')} placeholder="如 09-10"
              onChange={e => setCell(i, c.key, e.target.value)} />;
          default:
            return <Input {...common} value={String(v ?? '')}
              onChange={e => setCell(i, c.key, e.target.value)} />;
        }
      },
    })),
    ...(!locked ? [{
      title: '操作', width: 60, fixed: 'right' as const,
      render: (_: any, __: T, i: number) => (
        <Popconfirm title="删除该行？" onConfirm={() => del(i)}>
          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
        </Popconfirm>
      ),
    }] : []),
  ];

  return (
    <div>
      <Table
        size={size} bordered
        columns={cols} dataSource={rows}
        rowKey={(r: any, i) => String(r?.id ?? i)}
        pagination={false}
        scroll={{ x: minWidth }}
        footer={footer ? () => footer : undefined}
        locale={{ emptyText: '暂无数据，点击下方按钮添加' }}
      />
      {!locked && (
        <Button size="small" type="dashed" block icon={<PlusOutlined />}
          style={{ marginTop: 8 }}
          onClick={() => onChange([...rows, newRow()])}>
          {addLabel}
        </Button>
      )}
    </div>
  );
}

export const genRowId = uid;
export const today = () => dayjs().format('MM-DD');
export type { Dayjs };
