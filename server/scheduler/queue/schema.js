export const JOB_COLUMNS = [
  'jobId', 'parentJobId', 'topic', 'groupName', 'taskId', 'partitionId', 'uniqueKey', 'activeKey',
  'classname', 'methodName', 'paramStr', 'result', 'status', 'weight', 'runtime',
  'maxRunMilliSecond', 'createIP', 'workIP', 'traceId', 'createTime', 'lastUpdateTime',
  'createMachineId', 'onlyLocal',
];

export const WORK_COLUMNS = [
  'id', 'hostport', 'status', 'lastUpdateTime', 'partitionIds', 'role', 'version', 'topic',
];

const MYSQL = [
  `CREATE TABLE IF NOT EXISTS t_sched_job (
    jobId VARCHAR(64) NOT NULL PRIMARY KEY,
    parentJobId VARCHAR(64) NULL,
    topic VARCHAR(64) NOT NULL,
    groupName VARCHAR(128) NULL,
    taskId VARCHAR(64) NULL,
    partitionId SMALLINT NOT NULL,
    uniqueKey VARCHAR(191) NULL,
    activeKey VARCHAR(191) NULL,
    classname VARCHAR(128) NOT NULL,
    methodName VARCHAR(64) NOT NULL,
    paramStr LONGTEXT NULL,
    result LONGTEXT NULL,
    status TINYINT NOT NULL,
    weight INT NOT NULL DEFAULT 0,
    runtime BIGINT NULL,
    maxRunMilliSecond INT NOT NULL,
    createIP VARCHAR(64) NULL,
    workIP VARCHAR(64) NULL,
    traceId VARCHAR(64) NULL,
    createTime BIGINT NOT NULL,
    lastUpdateTime BIGINT NOT NULL,
    createMachineId VARCHAR(64) NULL,
    onlyLocal TINYINT NOT NULL DEFAULT 0,
    KEY idx_claim (topic, status, partitionId, weight, createTime),
    KEY idx_task (topic, groupName, createTime),
    KEY idx_task_id (topic, taskId),
    UNIQUE KEY uk_active (activeKey)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS t_work_status (
    id VARCHAR(128) NOT NULL PRIMARY KEY,
    hostport VARCHAR(128) NOT NULL,
    status TINYINT NOT NULL,
    lastUpdateTime BIGINT NOT NULL,
    partitionIds TEXT NULL,
    role VARCHAR(16) NOT NULL,
    version VARCHAR(32) NULL,
    topic VARCHAR(64) NOT NULL,
    KEY idx_topic_status (topic, status, lastUpdateTime)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS t_sched_config (
    k VARCHAR(64) NOT NULL PRIMARY KEY,
    v TEXT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

const SQLITE = [
  `CREATE TABLE IF NOT EXISTS t_sched_job (
    jobId TEXT PRIMARY KEY, parentJobId TEXT, topic TEXT NOT NULL, groupName TEXT, taskId TEXT,
    partitionId INTEGER NOT NULL, uniqueKey TEXT, activeKey TEXT,
    classname TEXT NOT NULL, methodName TEXT NOT NULL, paramStr TEXT, result TEXT,
    status INTEGER NOT NULL, weight INTEGER NOT NULL DEFAULT 0, runtime INTEGER,
    maxRunMilliSecond INTEGER NOT NULL, createIP TEXT, workIP TEXT, traceId TEXT,
    createTime INTEGER NOT NULL, lastUpdateTime INTEGER NOT NULL,
    createMachineId TEXT, onlyLocal INTEGER NOT NULL DEFAULT 0
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS uk_active ON t_sched_job(activeKey)',
  'CREATE INDEX IF NOT EXISTS idx_claim ON t_sched_job(topic, status, partitionId, weight, createTime)',
  'CREATE INDEX IF NOT EXISTS idx_task ON t_sched_job(topic, groupName, createTime)',
  'CREATE INDEX IF NOT EXISTS idx_task_id ON t_sched_job(topic, taskId)',
  `CREATE TABLE IF NOT EXISTS t_work_status (
    id TEXT PRIMARY KEY, hostport TEXT NOT NULL, status INTEGER NOT NULL,
    lastUpdateTime INTEGER NOT NULL, partitionIds TEXT, role TEXT NOT NULL,
    version TEXT, topic TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_topic_status ON t_work_status(topic, status, lastUpdateTime)',
  `CREATE TABLE IF NOT EXISTS t_sched_config (k TEXT PRIMARY KEY, v TEXT)`,
];

export function ddl(dialect) { return dialect === 'mysql' ? MYSQL : SQLITE; }

export async function ensureSchema(driver, dialect) {
  for (const sql of ddl(dialect)) await driver.exec(sql);
}
