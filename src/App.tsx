import { Routes, Route, Navigate } from 'react-router-dom';
import MainLayout from './layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import Projects from './pages/Projects';
import History from './pages/History';
import TeamPool from './pages/TeamPool';
import ProjectDetail from './pages/ProjectDetail';
import TestGuide from './pages/TestGuide';
import ResourceCalculator from './pages/ResourceCalculator';

function App() {
  return (
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
  );
}

export default App;
