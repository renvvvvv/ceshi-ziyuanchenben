-- =============================================
-- 数据中心测试验证管理平台 - PostgreSQL 数据库初始化
-- =============================================

-- 资源计算历史记录
CREATE TABLE IF NOT EXISTS resource_calc_history (
    id              SERIAL PRIMARY KEY,
    batch_id        TEXT,                        -- 群算批次ID（NULL=单算）
    total_mw        DOUBLE PRECISION NOT NULL,
    total_duration  INTEGER NOT NULL,
    cabinet_power   INTEGER NOT NULL,
    it_transformers TEXT    NOT NULL,
    power_transformers TEXT  NOT NULL,
    total_cabinets  INTEGER NOT NULL,
    ac_type         TEXT    NOT NULL,
    peak_staff      INTEGER NOT NULL,
    total_man_days  INTEGER NOT NULL,
    result_json     TEXT    NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rc_batch ON resource_calc_history(batch_id);
CREATE INDEX IF NOT EXISTS idx_rc_created ON resource_calc_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rc_mw ON resource_calc_history(total_mw);

-- 测试项目表（含 2026-07-18 前后端打通改造新增的 3 个字段）
CREATE TABLE IF NOT EXISTS test_projects (
    id              SERIAL PRIMARY KEY,
    name            TEXT    NOT NULL,
    customer        TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT '未开始',
    manager         TEXT    NOT NULL,
    start_date      TEXT    NOT NULL,
    end_date        TEXT,
    it_output       DOUBLE PRECISION NOT NULL DEFAULT 0,
    business_type   TEXT,
    description     TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    -- 2026-07-18 新增：支撑前端 Project 完整字段
    planned_manpower       INTEGER,    -- 计划投入人力
    city                   TEXT,       -- 项目城市
    assigned_member_ids    TEXT        -- 关联人员 ID 列表（JSON 字符串）
);

-- 兼容升级：旧库可能缺这些列
ALTER TABLE test_projects ADD COLUMN IF NOT EXISTS planned_manpower INTEGER;
ALTER TABLE test_projects ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE test_projects ADD COLUMN IF NOT EXISTS assigned_member_ids TEXT;

CREATE INDEX IF NOT EXISTS idx_tp_status ON test_projects(status);
CREATE INDEX IF NOT EXISTS idx_tp_updated ON test_projects(updated_at DESC);

-- 历史项目表
CREATE TABLE IF NOT EXISTS historical_projects (
    id              SERIAL PRIMARY KEY,
    name            TEXT    NOT NULL,
    it_output       DOUBLE PRECISION NOT NULL,
    start_date      TEXT    NOT NULL,
    end_date        TEXT    NOT NULL,
    customer        TEXT    NOT NULL,
    doc_link        TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 团队成员表
CREATE TABLE IF NOT EXISTS team_members (
    id              SERIAL PRIMARY KEY,
    name            TEXT    NOT NULL,
    employee_id     TEXT    NOT NULL UNIQUE,
    status          TEXT    NOT NULL DEFAULT '在线',
    skills          TEXT    NOT NULL DEFAULT '[]',
    current_projects TEXT   NOT NULL DEFAULT '[]',
    email           TEXT,
    phone           TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 插入默认数据（仅首次初始化）
INSERT INTO team_members (name, employee_id, status, skills, current_projects, email, phone)
SELECT '张家晟', 'EMP001', '在线', '["电力系统","项目管理","UPS测试"]', '["乌兰D5数据中心测试验证"]', 'zhangjs@example.com', '13800001001'
WHERE NOT EXISTS (SELECT 1 FROM team_members WHERE employee_id = 'EMP001');

INSERT INTO team_members (name, employee_id, status, skills, current_projects, email, phone)
SELECT '李铭', 'EMP002', '忙碌', '["暖通系统","节能测试","BA系统"]', '["乌兰D3扩容测试","广州天河数据中心测试"]', 'liming@example.com', '13800001002'
WHERE NOT EXISTS (SELECT 1 FROM team_members WHERE employee_id = 'EMP002');
