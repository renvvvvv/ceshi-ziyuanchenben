-- =============================================
-- 数据中心测试验证管理平台 - PostgreSQL 数据库初始化
-- =============================================

-- pgvector 扩展（AI 知识库向量检索）
CREATE EXTENSION IF NOT EXISTS vector;

-- 知识向量表（AI 测试专家 RAG 检索）
CREATE TABLE IF NOT EXISTS knowledge_embeddings (
    id          TEXT PRIMARY KEY,
    file        TEXT NOT NULL,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    embedding   vector(1024)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding
ON knowledge_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

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
    assigned_member_ids    TEXT,        -- 关联人员 ID 列表（JSON 字符串）
    -- 2026-07-19 新增：计划/实际交付日期 + 测试管理链接
    planned_delivery_date  TEXT,
    actual_delivery_date   TEXT,
    doc_link               TEXT
);

-- 兼容升级：旧库可能缺这些列
ALTER TABLE test_projects ADD COLUMN IF NOT EXISTS planned_manpower INTEGER;
ALTER TABLE test_projects ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE test_projects ADD COLUMN IF NOT EXISTS assigned_member_ids TEXT;
-- 2026-07-19 新增列兼容升级
ALTER TABLE test_projects ADD COLUMN IF NOT EXISTS planned_delivery_date TEXT;
ALTER TABLE test_projects ADD COLUMN IF NOT EXISTS actual_delivery_date TEXT;
ALTER TABLE test_projects ADD COLUMN IF NOT EXISTS doc_link TEXT;

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

-- 2026-07-19 兼容升级：补充前端显示所需的列
ALTER TABLE historical_projects ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE historical_projects ADD COLUMN IF NOT EXISTS manager TEXT;
ALTER TABLE historical_projects ADD COLUMN IF NOT EXISTS planned_delivery_date TEXT;
ALTER TABLE historical_projects ADD COLUMN IF NOT EXISTS actual_delivery_date TEXT;
ALTER TABLE historical_projects ADD COLUMN IF NOT EXISTS status TEXT DEFAULT '已完成';
ALTER TABLE historical_projects ADD COLUMN IF NOT EXISTS planned_manpower INTEGER;
ALTER TABLE historical_projects ADD COLUMN IF NOT EXISTS business_type TEXT;
ALTER TABLE historical_projects ADD COLUMN IF NOT EXISTS description TEXT;

-- 团队成员表
CREATE TABLE IF NOT EXISTS team_members (
    id              SERIAL PRIMARY KEY,
    name            TEXT    NOT NULL,
    employee_id     TEXT    NOT NULL UNIQUE,
    status          TEXT    NOT NULL DEFAULT '空闲',
    skills          TEXT    NOT NULL DEFAULT '[]',
    current_projects TEXT   NOT NULL DEFAULT '[]',
    email           TEXT,
    phone           TEXT,
    position        TEXT,                          -- 岗位（2026-07-19 新增）
    projects        TEXT    NOT NULL DEFAULT '[]', -- 详细项目 [{projectName,startDate,endDate}]（2026-07-19 新增）
    upcoming_projects TEXT  NOT NULL DEFAULT '[]', -- 即将开始的项目（2026-07-19 新增）
    leave_start_date TEXT,                         -- 休假开始日期（2026-07-19 新增）
    leave_end_date  TEXT,                          -- 休假结束日期（2026-07-19 新增）
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 2026-07-19 ALTER：兼容已部署的库（即使表已存在也能加列）
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS position TEXT;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS projects TEXT NOT NULL DEFAULT '[]';
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS upcoming_projects TEXT NOT NULL DEFAULT '[]';
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS leave_start_date TEXT;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS leave_end_date TEXT;

-- 插入默认数据（仅首次初始化）
INSERT INTO team_members (name, employee_id, status, skills, current_projects, email, phone)
SELECT '张家晟', 'EMP001', '空闲', '["电力系统","项目管理","UPS测试"]', '["乌兰D5数据中心测试验证"]', 'zhangjs@example.com', '13800001001'
WHERE NOT EXISTS (SELECT 1 FROM team_members WHERE employee_id = 'EMP001');

INSERT INTO team_members (name, employee_id, status, skills, current_projects, email, phone)
SELECT '李铭', 'EMP002', '空闲', '["暖通系统","节能测试","BA系统"]', '["乌兰D3扩容测试","广州天河数据中心测试"]', 'liming@example.com', '13800001002'
WHERE NOT EXISTS (SELECT 1 FROM team_members WHERE employee_id = 'EMP002');

-- 知识库文档表（树形结构 + markdown + 可选外部链接）
-- 2026-07-19 新增：支持本地 KB 系统，可作为飞书 iframe 的替代/补充
CREATE TABLE IF NOT EXISTS kb_documents (
    id              SERIAL PRIMARY KEY,
    parent_id       INTEGER REFERENCES kb_documents(id) ON DELETE CASCADE,
    title           TEXT    NOT NULL,
    content_md      TEXT    NOT NULL DEFAULT '',
    external_url    TEXT,                  -- 外部链接（飞书等 URL，可选）
    sort_order      INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kb_parent ON kb_documents(parent_id);
CREATE INDEX IF NOT EXISTS idx_kb_sort ON kb_documents(parent_id, sort_order);

-- 知识库默认数据：根目录 + 3 个分类
-- 注意：必须先把 sequence 设到 100，避免后续不带 id 的 INSERT 用到 1（与根节点冲突）
SELECT setval('kb_documents_id_seq', 100, false);

INSERT INTO kb_documents (id, parent_id, title, sort_order)
SELECT 1, NULL, '智航测试部知识库', 0
WHERE NOT EXISTS (SELECT 1 FROM kb_documents WHERE id = 1);

INSERT INTO kb_documents (parent_id, title, sort_order)
SELECT 1, '电力系统测试', 1
WHERE NOT EXISTS (SELECT 1 FROM kb_documents WHERE parent_id = 1 AND title = '电力系统测试');

INSERT INTO kb_documents (parent_id, title, sort_order)
SELECT 1, '暖通系统测试', 2
WHERE NOT EXISTS (SELECT 1 FROM kb_documents WHERE parent_id = 1 AND title = '暖通系统测试');

INSERT INTO kb_documents (parent_id, title, sort_order)
SELECT 1, '弱电消防测试', 3
WHERE NOT EXISTS (SELECT 1 FROM kb_documents WHERE parent_id = 1 AND title = '弱电消防测试');

-- 如果之前已有数据，把 sequence 同步到 MAX(id) 之后
SELECT setval('kb_documents_id_seq', GREATEST(100, (SELECT COALESCE(MAX(id), 100) FROM kb_documents)));

-- 考勤人工校准表（2026-07-19 新增）
-- key = {member_id, project_name, cycle_start}
-- 支持一人多项目一周期
CREATE TABLE IF NOT EXISTS attendance_adjustments (
    id              SERIAL PRIMARY KEY,
    member_id       TEXT    NOT NULL,
    project_name    TEXT    NOT NULL,
    cycle_start     TEXT    NOT NULL,        -- YYYY-MM-DD，19 日周期起点
    project_start   TEXT,                    -- 人工覆盖的项目起始日（YYYY-MM-DD）
    project_end     TEXT,                    -- 人工覆盖的项目结束日
    leave_days      INTEGER,                 -- 人工校准请假天数
    position        TEXT,                    -- 项目级岗位（某人在某项目的角色）
    attend_days     INTEGER,                 -- 直接录入的实际出勤天数（有值时优先于 onDuty-leave 推算）
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(member_id, project_name, cycle_start)
);

CREATE INDEX IF NOT EXISTS idx_attendance_adj_member
    ON attendance_adjustments(member_id, cycle_start);

-- 测试管理制度文档（文件上传到 uploads/ 目录，元数据存此表）
CREATE TABLE IF NOT EXISTS test_docs (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    category    TEXT NOT NULL,
    description TEXT DEFAULT '',
    file_name   TEXT,
    file_size   TEXT,
    file_type   TEXT,
    file_path   TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 测试资源配置模块（收编自单文件资源配置工具，2026-08-28）
-- 设计：主表存标量字段 + data JSONB 存 10 个子模块数组
--（personnel/staff/subsidy/external/loads/instruments/consumables/labor/safety/cert），
-- 与原工具 JSON 导出格式逐字对齐，存量备份可直接导入
-- ============================================================
CREATE TABLE IF NOT EXISTS rc_projects (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    mw          TEXT DEFAULT '',
    site        TEXT DEFAULT '',
    manager     TEXT DEFAULT '',
    test_days   INT DEFAULT 40,
    start_date  TEXT,
    end_date    TEXT,
    remark      TEXT DEFAULT '',
    status      TEXT NOT NULL DEFAULT '配置中',   -- 配置中 | 已交付
    data        JSONB NOT NULL DEFAULT '{}',      -- 10 个子模块数组（详见前端 resourceConfig.ts 类型）
    created_by  TEXT DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rc_projects_status ON rc_projects(status);
CREATE INDEX IF NOT EXISTS idx_rc_projects_updated ON rc_projects(updated_at DESC);

-- 自有资源库（部门级，跨项目共用：假负载/仪表/PDU/机柜）
CREATE TABLE IF NOT EXISTS rc_assets (
    id          SERIAL PRIMARY KEY,
    cat         TEXT NOT NULL CHECK (cat IN ('load','ins','pdu','cabinet')),
    name        TEXT NOT NULL,
    spec        TEXT DEFAULT '',                  -- spec 中的功率数字有语义（假负载匹配用）
    count       INT NOT NULL DEFAULT 0 CHECK (count >= 0),
    note        TEXT DEFAULT '',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rc_assets_cat ON rc_assets(cat);

-- 已交付配置存档（完整项目快照，只读）
CREATE TABLE IF NOT EXISTS rc_delivered (
    id          SERIAL PRIMARY KEY,
    project_id  INT,
    name        TEXT NOT NULL,
    saved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    snapshot    JSONB NOT NULL                    -- 完整 rc_projects 行快照
);
