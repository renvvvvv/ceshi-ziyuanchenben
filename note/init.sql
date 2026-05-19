-- =============================================
-- 数据中心测试验证平台 - SQLite 数据库初始化
-- =============================================

-- 资源计算历史记录
CREATE TABLE IF NOT EXISTS resource_calc_history (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    total_mw        REAL    NOT NULL,            -- 总兆瓦数(MW)
    total_duration  INTEGER NOT NULL,            -- 总工期(天)
    cabinet_power   INTEGER NOT NULL,            -- 单机柜压测功率(kW)
    it_transformers TEXT    NOT NULL,            -- IT变压器配置 JSON: [[容量,台数],...]
    power_transformers TEXT  NOT NULL,            -- 动力变压器配置 JSON
    total_cabinets  INTEGER NOT NULL,            -- 总机柜数
    ac_type         TEXT    NOT NULL,            -- 空调类型
    peak_staff      INTEGER NOT NULL,            -- 峰值同时在场人数
    total_man_days  INTEGER NOT NULL,            -- 总人天
    result_json     TEXT    NOT NULL,            -- 完整计算结果 JSON
    created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_rc_created ON resource_calc_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rc_mw ON resource_calc_history(total_mw);
CREATE INDEX IF NOT EXISTS idx_rc_customer ON resource_calc_history(ac_type);

-- 测试项目表
CREATE TABLE IF NOT EXISTS test_projects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,            -- 项目名称
    customer        TEXT    NOT NULL,            -- 客户
    status          TEXT    NOT NULL DEFAULT '未开始',  -- 未开始/测试中/已完成/阻塞
    priority        TEXT    NOT NULL DEFAULT '中',      -- 高/中/低
    manager         TEXT    NOT NULL,            -- 项目经理
    start_date      TEXT    NOT NULL,            -- 开始日期
    end_date        TEXT,                        -- 结束日期
    it_output       REAL    NOT NULL DEFAULT 0,  -- IT产出(MW)
    contract_amount REAL,                        -- 合同金额
    business_type   TEXT,                        -- 业务类型
    description     TEXT,                        -- 项目描述
    created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_tp_status ON test_projects(status);
CREATE INDEX IF NOT EXISTS idx_tp_updated ON test_projects(updated_at DESC);

-- 历史项目表
CREATE TABLE IF NOT EXISTS historical_projects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    it_output       REAL    NOT NULL,            -- IT产出(MW)
    start_date      TEXT    NOT NULL,
    end_date        TEXT    NOT NULL,
    customer        TEXT    NOT NULL,
    doc_link        TEXT,                        -- 测试管理链接
    created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 团队成员表
CREATE TABLE IF NOT EXISTS team_members (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL,
    employee_id     TEXT    NOT NULL UNIQUE,
    status          TEXT    NOT NULL DEFAULT '在线',  -- 在线/忙碌/离线
    skills          TEXT    NOT NULL DEFAULT '[]',    -- JSON数组
    current_projects TEXT   NOT NULL DEFAULT '[]',    -- JSON数组
    email           TEXT,
    phone           TEXT,
    created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 插入默认数据
INSERT OR IGNORE INTO team_members (name, employee_id, status, skills, current_projects, email, phone) VALUES
('张家晟', 'EMP001', '在线', '["电力系统","项目管理","UPS测试"]', '["乌兰D5数据中心测试验证"]', 'zhangjs@example.com', '13800001001'),
('李铭',   'EMP002', '忙碌', '["暖通系统","节能测试","BA系统"]',   '["乌兰D3扩容测试","广州天河数据中心测试"]', 'liming@example.com', '13800001002'),
('王磊',   'EMP003', '在线', '["弱电系统","网络测试","安防系统"]', '["安次D1-1/2测试验证","廊坊数据中心年度复测"]', 'wanglei@example.com', '13800001003'),
('赵明',   'EMP004', '离线', '["电力系统","高压测试","变压器测试"]', '[]', 'zhaoming@example.com', '13800001004'),
('陈静',   'EMP005', '在线', '["文档管理","质量控制","数据分析"]', '["上海浦东数据中心测试"]', 'chenjing@example.com', '13800001005'),
('刘洋',   'EMP006', '忙碌', '["暖通系统","给排水","消防测试"]', '["廊坊数据中心扩容测试"]', 'liuyang@example.com', '13800001006'),
('孙伟',   'EMP007', '在线', '["弱电系统","综合布线","光纤测试"]', '["安次D2-1测试验证"]', 'sunwei@example.com', '13800001007'),
('周晓',   'EMP008', '离线', '["电力系统","发电机测试","ATS测试"]', '[]', 'zhouxiao@example.com', '13800001008');
