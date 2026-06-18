import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from 'antd';
import MainLayout from './layouts/MainLayout';
import ErrorBoundary from './components/ErrorBoundary';

// 懒加载页面组件（代码分割）
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Projects = lazy(() => import('./pages/Projects'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail'));
const History = lazy(() => import('./pages/History'));
const TeamPool = lazy(() => import('./pages/TeamPool'));
const TestGuide = lazy(() => import('./pages/TestGuide'));
const ResourceCalculator = lazy(() => import('./pages/ResourceCalculator'));

// 加载中组件
function PageLoading() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '400px',
    }}>
      <Spin size="large" />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<MainLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:id" element={<ProjectDetail />} />
            <Route path="history" element={<History />} />
            <Route path="team-pool" element={<TeamPool />} />
            <Route path="test-guide" element={<TestGuide />} />
            <Route path="resource-calculator" element={<ResourceCalculator />} />
          </Route>
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export default App;
