import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import './App.css';

dayjs.locale('zh-cn');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          // 星云紫主题（白底科技感）
          colorPrimary: '#6366f1',
          colorInfo: '#6366f1',
          colorSuccess: '#16a34a',
          colorWarning: '#d97706',
          colorError: '#dc2626',
          colorLink: '#6366f1',
          colorBgBase: '#ffffff',
          colorBgContainer: '#ffffff',
          colorBgElevated: '#ffffff',
          colorBgLayout: '#fafafd',
          colorTextBase: '#1e1b2e',
          colorText: '#1e1b2e',
          colorTextSecondary: '#46436a',
          colorTextTertiary: '#6b6892',
          colorTextQuaternary: '#9d9ab8',
          colorBorder: '#e9e7f4',
          colorBorderSecondary: '#eeedf8',
          borderRadius: 10,
          boxShadow: '0 8px 24px rgba(99,102,241,0.10)',
          boxShadowSecondary: '0 8px 24px rgba(99,102,241,0.12)',
          fontFamily: "'Outfit', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
        components: {
          Table: {
            headerBg: '#f6f5fc',
            headerColor: '#46436a',
            rowHoverBg: '#f8f7fd',
            borderColor: '#e9e7f4',
            colorBgContainer: '#ffffff',
            colorText: '#1e1b2e',
            headerSplitColor: 'transparent',
          },
          Select: {
            colorBgContainer: '#ffffff',
            colorBgElevated: '#ffffff',
            colorBorder: '#e9e7f4',
            colorText: '#1e1b2e',
            colorTextPlaceholder: '#9d9ab8',
            optionSelectedBg: '#f1f0fe',
          },
          Input: {
            colorBgContainer: '#ffffff',
            colorBorder: '#e9e7f4',
            colorText: '#1e1b2e',
            colorTextPlaceholder: '#9d9ab8',
            activeShadow: '0 0 0 2px rgba(99,102,241,0.12)',
          },
          DatePicker: {
            colorBgContainer: '#ffffff',
            colorBgElevated: '#ffffff',
            colorBorder: '#e9e7f4',
            colorText: '#1e1b2e',
            colorTextPlaceholder: '#9d9ab8',
          },
          Button: {
            defaultBg: '#ffffff',
            defaultBorderColor: '#e9e7f4',
            defaultColor: '#46436a',
            primaryShadow: '0 4px 12px rgba(99,102,241,0.25)',
          },
          Modal: {
            contentBg: '#ffffff',
            headerBg: 'transparent',
            titleColor: '#1e1b2e',
          },
          Card: {
            colorBgContainer: '#ffffff',
            borderRadiusLG: 14,
          },
          Tag: {
            defaultBg: '#f1f0fe',
          },
          Menu: {
            itemBg: 'transparent',
            itemColor: '#46436a',
            itemSelectedColor: '#6366f1',
            itemSelectedBg: '#f1f0fe',
            itemHoverColor: '#6366f1',
            itemHoverBg: '#f8f7fd',
            activeBarHeight: 0,
            activeBarBorderWidth: 0,
          },
          Popover: { colorBgElevated: '#ffffff' },
          Tooltip: { colorBgSpotlight: '#1e1b2e', colorTextLightSolid: '#ffffff' },
          Dropdown: { colorBgElevated: '#ffffff' },
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
);
