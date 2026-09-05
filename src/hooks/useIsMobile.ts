import { Grid } from 'antd';

/**
 * 移动端判定：≤767px 视为手机。
 * 与 MainLayout 的抽屉断点(lg=992)解耦：768-991px 平板走抽屉菜单但保持桌面内容布局。
 *
 * 用法：const isMobile = useIsMobile();
 * 约定：所有条件样式必须写成 isMobile ? <移动值> : <原桌面值>，保证桌面渲染路径不变。
 */
export function useIsMobile(): boolean {
  const screens = Grid.useBreakpoint();
  return !screens.md;
}
