import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// 协作数据表（按端口）：群成员维护表 + 成员拥有的 command + 群消息记录
export function createCollabDb({ file, logger = console } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS member (
      group_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      username TEXT, employee_id TEXT, host TEXT, port INTEGER,
      public_key TEXT, updated_at INTEGER,
      PRIMARY KEY (group_id, machine_id)
    );
    CREATE TABLE IF NOT EXISTS member_command (
      group_id TEXT NOT NULL,
      machine_id TEXT NOT NULL,
      name TEXT NOT NULL,
      updated_at INTEGER,
      PRIMARY KEY (group_id, machine_id, name)
    );
    CREATE TABLE IF NOT EXISTS message (
      id TEXT PRIMARY KEY,
      group_id TEXT,
      src TEXT,
      target TEXT,
      message TEXT,
      command TEXT,
      update_time INTEGER
    );
  `);

  const upsertMember = db.prepare(`INSERT INTO member (group_id, machine_id, username, employee_id, host, port, public_key, updated_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(group_id,machine_id) DO UPDATE SET
    username=excluded.username, employee_id=excluded.employee_id, host=excluded.host, port=excluded.port,
    public_key=excluded.public_key, updated_at=excluded.updated_at`);
  const delCmd = db.prepare('DELETE FROM member_command WHERE group_id = ? AND machine_id = ?');
  const delMember = db.prepare('DELETE FROM member WHERE group_id = ? AND machine_id = ?');
  const insCmd = db.prepare(`INSERT INTO member_command (group_id, machine_id, name, updated_at) VALUES (?,?,?,?)
    ON CONFLICT(group_id,machine_id,name) DO UPDATE SET updated_at=excluded.updated_at`);
  const listMembers = db.prepare('SELECT * FROM member WHERE group_id = ? ORDER BY username, machine_id');
  const listAllMembers = db.prepare('SELECT * FROM member ORDER BY group_id, username, machine_id');
  const listCmd = db.prepare('SELECT * FROM member_command WHERE group_id = ? AND (? IS NULL OR machine_id = ?) ORDER BY machine_id, name');
  const insMsg = db.prepare(`INSERT INTO message (id, group_id, src, target, message, command, update_time) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET message=excluded.message, command=COALESCE(excluded.command, message.command), update_time=excluded.update_time`);
  const listMsg = db.prepare('SELECT * FROM message WHERE (? IS NULL OR group_id = ?) AND update_time > ? ORDER BY update_time ASC LIMIT ?');

  const mRow = (r) => (r ? {
    groupId: r.group_id, machineId: r.machine_id, username: r.username, employeeId: r.employee_id,
    host: r.host, port: r.port, publicKey: r.public_key, updatedAt: r.updated_at,
  } : null);

  return {
    // 成员维护表：每位成员一行（含地址与公钥）
    registerMember(m, now = Date.now()) {
      if (!m || !m.groupId || !m.machineId) return null;
      try {
        upsertMember.run(String(m.groupId), String(m.machineId), m.username || '', m.employeeId || '',
          m.host || '', Number(m.port) || 0, m.publicKey || '', Number(now));
      } catch (e) { logger?.warn?.('member upsert failed', (e && e.message) || e); }
      return mRow(listMembers.all(String(m.groupId)).find((r) => r.machine_id === String(m.machineId)));
    },
    // 某成员拥有的 command（整表覆盖该成员那一组，避免残留旧命令）
    setCommands({ groupId, machineId, commands = [] }, now = Date.now()) {
      if (!groupId || !machineId) return [];
      try {
        delCmd.run(String(groupId), String(machineId));
        for (const name of commands) if (name) insCmd.run(String(groupId), String(machineId), String(name), Number(now));
      } catch (e) { logger?.warn?.('member_command write failed', (e && e.message) || e); }
      return this.listCommands({ groupId, machineId });
    },
    listMembers(groupId) { return (groupId ? listMembers.all(String(groupId)) : listAllMembers.all()).map(mRow); },
    // 群主清理：删掉成员表与命令缓存里的这些机器
    removeMembers({ groupId, machineIds = [] } = {}) {
      if (!groupId) return 0;
      let n = 0;
      for (const id of machineIds) {
        if (!id) continue;
        try {
          delCmd.run(String(groupId), String(id));
          n += Number(delMember.run(String(groupId), String(id)).changes) || 0;
        } catch (e) { logger?.warn?.('member delete failed', (e && e.message) || e); }
      }
      return n;
    },
    listCommands({ groupId, machineId = null } = {}) {
      if (!groupId) return [];
      return listCmd.all(String(groupId), machineId ? String(machineId) : null, machineId ? String(machineId) : null)
        .map((r) => ({ groupId: r.group_id, machineId: r.machine_id, name: r.name, updatedAt: r.updated_at }));
    },
    // 群消息记录：src → target，command 为远程执行时的命令原文
    addMessage({ id, groupId = null, src, target = null, message = '', command = null, updateTime = Date.now() }) {
      if (!id) return null;
      try {
        insMsg.run(String(id), groupId || null, src || '', target || null, String(message || ''), command || null, Number(updateTime));
      } catch (e) { logger?.warn?.('message insert failed', (e && e.message) || e); }
      return { id, groupId, src, target, message, command, updateTime };
    },
    listMessages({ groupId = null, afterTime = 0, limit = 500 } = {}) {
      return listMsg.all(groupId || null, groupId || null, Number(afterTime) || 0, Number(limit) || 500)
        .map((r) => ({ id: r.id, groupId: r.group_id, src: r.src, target: r.target, message: r.message, command: r.command, updateTime: r.update_time }));
    },
    close() { try { db.close(); } catch { /* ignore */ } },
    db,   // 供自检（如核对同库多表）
  };
}
