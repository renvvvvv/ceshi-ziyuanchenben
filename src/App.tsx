import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import MainLayout from './layouts/MainLayout';
import ErrorBoundary from './components/ErrorBoundary';
import { DataProvider } from './store/DataContext';
import { AuthProvider, useAuth } from './store/AuthContext';

// 懒加载页面组件（代码分割）
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Projects = lazy(() => import('./pages/Projects'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const History = lazy(() => import('./pages/History'));
const HistoryDetail = lazy(() => import('./pages/HistoryDetail'));
const TeamPool = lazy(() => import('./pages/TeamPool'));
const TestGuide = lazy(() => import('./pages/TestGuide'));
const ResourceCalculator = lazy(() => import('./pages/ResourceCalculator'));
const Login = lazy(() => import('./pages/Login'));
const PermissionConfig = lazy(() => import('./pages/PermissionConfig'));

// 加载中组件（带淡入动画）
function PageLoading() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '400px',
      gap: 16,
      animation: 'pageFadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) both',
    }}>
      <Spin size="large" />
      <span style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-primary)', fontSize: 13 }}>
        加载中...
      </span>
    </div>
  );
}

// 路由守卫：未登录跳转登录页
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

// 权限守卫：无权限查看时跳转仪表盘
function RequirePermission({ module, children }: { module: import('./types').AppModule; children: React.ReactNode }) {
  const { canView } = useAuth();
  if (!canView(module)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { isAuthenticated } = useAuth();

  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        {/* 登录页（已登录则跳转仪表盘） */}
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <Login />}
        />

        {/* 主布局路由（需登录） */}
        <Route
          path="/"
          element={
            <RequireAuth>
              <MainLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="projects" element={<RequirePermission module="projects"><Projects /></RequirePermission>} />
          <Route path="projects/:id" element={<RequirePermission module="projects"><ProjectDetail /></RequirePermission>} />
          <Route path="history" element={<RequirePermission module="history"><History /></RequirePermission>} />
          <Route path="history/:id" element={<RequirePermission module="history"><HistoryDetail /></RequirePermission>} />
          <Route path="team-pool" element={<RequirePermission module="teamPool"><TeamPool /></RequirePermission>} />
          <Route path="test-guide" element={<RequirePermission module="testGuide"><TestGuide /></RequirePermission>} />
          <Route path="resource-calculator" element={<RequirePermission module="resourceCalc"><ResourceCalculator /></RequirePermission>} />
          <Route path="permission-config" element={<RequirePermission module="permissionConfig"><PermissionConfig /></RequirePermission>} />
        </Route>

        {/* 兜底：未匹配路由 */}
        <Route path="*" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />} />
      </Routes>
    </Suspense>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <DataProvider>
          <AppRoutes />
        </DataProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
