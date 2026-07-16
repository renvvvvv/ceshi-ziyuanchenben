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
          colorPrimary: '#4d9fff',
          colorBgBase: '#0a1628',
          colorTextBase: '#ffffff',
          borderRadius: 8,
          fontFamily: "'Outfit', 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        },
        components: {
          Table: {
            headerBg: 'rgba(0, 0, 0, 0.25)',
            headerColor: 'rgba(255,255,255,0.6)',
            rowHoverBg: 'rgba(255,255,255,0.04)',
            borderColor: 'rgba(255,255,255,0.08)',
            colorBgContainer: 'transparent',
            colorText: 'rgba(255,255,255,0.9)',
          },
          Select: {
            colorBgContainer: 'rgba(13, 31, 60, 0.95)',
            colorBgElevated: 'rgba(13, 31, 60, 0.95)',
            colorBorder: 'rgba(255,255,255,0.15)',
            colorText: 'rgba(255,255,255,0.85)',
            colorTextPlaceholder: 'rgba(255,255,255,0.4)',
            optionSelectedBg: 'rgba(77,159,255,0.15)',
          },
          Input: {
            colorBgContainer: 'rgba(255,255,255,0.06)',
            colorBorder: 'rgba(255,255,255,0.15)',
            colorText: 'rgba(255,255,255,0.85)',
            colorTextPlaceholder: 'rgba(255,255,255,0.35)',
          },
          DatePicker: {
            colorBgContainer: 'rgba(255,255,255,0.06)',
            colorBgElevated: 'rgba(13, 31, 60, 0.95)',
            colorBorder: 'rgba(255,255,255,0.15)',
            colorText: 'rgba(255,255,255,0.85)',
            colorTextPlaceholder: 'rgba(255,255,255,0.35)',
          },
          Button: {
            defaultBg: 'rgba(255,255,255,0.06)',
            defaultBorderColor: 'rgba(255,255,255,0.15)',
            defaultColor: 'rgba(255,255,255,0.6)',
          },
          Modal: {
            contentBg: 'rgba(13, 31, 60, 0.96)',
            headerBg: 'transparent',
            titleColor: 'rgba(255,255,255,0.95)',
          },
        },
      }}
    >
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
);
