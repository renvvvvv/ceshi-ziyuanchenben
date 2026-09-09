/**
 * 旧资源配置详情页已由新版工作台（/resource-config 内嵌 /rc/index.html）取代，
 * 保留路由兼容历史链接：直接跳回模块主页。
 */
import { Navigate, useParams } from 'react-router-dom';

export default function ResourceConfigDetail() {
  const { id } = useParams();
  // 工作台通过自己的项目切换器定位项目；旧链接带 id 也统一回主页
  return <Navigate to="/resource-config" replace />;
}
