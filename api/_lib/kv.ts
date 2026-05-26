/**
 * KV 数据访问层（仅后端使用）
 *
 * v2 Key 设计：
 *   user:{userId}      → CloudUser（主存储；userId 是 UUID）
 *   code:{8位}         → CloudCodeIndex（编号 → userId）
 *   openid:{openid}    → CloudOpenidIndex（微信 openid → userId，仅微信用户）
 *   meta:codeCounter   → 自增编号计数器
 *
 * v1 历史兼容（用 openid 当主键的旧记录）：
 *   readLegacyByOpenid()：可读到老的 user:{openid} 记录
 *   迁移逻辑：当微信 callback 检测到老记录时，迁移到新 schema
 *
 * 编号生成策略不变：
 *   - 起始 10000000，恒为 8 位
 *   - INCR + 乱序映射避免暴露注册顺序
 */

import { kv } from '@vercel/kv';
import type {
  CloudUser,
  CloudCodeIndex,
  CloudOpenidIndex,
  SaveData,
} from '../../shared/types.js';

const COUNTER_KEY = 'meta:codeCounter';
const COUNTER_START = 10000000;
/** 与 COUNTER_START 同位数的乘法乱序常量（与 9 千万互质，保证 1:1 映射） */
const SHUFFLE_MUL = 7654321;
/** 加一个固定 salt 让起始值看起来不那么"幼稚"（远离 10000000） */
const SHUFFLE_SALT = 4815162;
/** 8 位编号上限（不含） */
const CODE_MOD = 90000000;

/**
 * 用户数据的 TTL：1 年（秒数）。
 * 每次 read / write 时都会续期到 1 年后，相当于"最后活跃时间起 1 年"。
 */
const USER_TTL_SECONDS = 365 * 24 * 60 * 60;

/** 生成 UUID v4（Edge Runtime 自带 crypto.randomUUID） */
function newUserId(): string {
  return crypto.randomUUID();
}

/** 生成 256-bit base64url token（私密，写云端凭据） */
function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // base64url 编码：纯 ASCII，cookie / URL 都安全
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * 把单调递增的计数器 n 映射为 8 位编号字符串。
 * 输入：0, 1, 2, 3, ...
 * 输出：[10000000, 99999999] 内的看似随机的 8 位数
 */
function counterToCode(n: number): string {
  const v = ((n * SHUFFLE_MUL + SHUFFLE_SALT) % CODE_MOD) + COUNTER_START;
  return String(v);
}

/** 给指定用户分配一个新的 8 位编号（INCR + 乱序映射） */
async function allocateCode(): Promise<string> {
  const n = await kv.incr(COUNTER_KEY);
  return counterToCode(n - 1);
}

// =========================== 读取 ===========================

/** 通过 userId 查用户。命中时续期 user + code + openid 三条索引 */
export async function getUserById(userId: string): Promise<CloudUser | null> {
  const user = await kv.get<CloudUser>(`user:${userId}`);
  if (user) {
    void kv.expire(`user:${userId}`, USER_TTL_SECONDS);
    void kv.expire(`code:${user.code}`, USER_TTL_SECONDS);
    if (user.openid) void kv.expire(`openid:${user.openid}`, USER_TTL_SECONDS);
  }
  return user ?? null;
}

/** 通过编号查 userId。命中时续期 */
export async function getUserIdByCode(code: string): Promise<string | null> {
  const idx = await kv.get<CloudCodeIndex>(`code:${code}`);
  if (idx) {
    void kv.expire(`code:${code}`, USER_TTL_SECONDS);
    void kv.expire(`user:${idx.userId}`, USER_TTL_SECONDS);
  }
  return idx?.userId ?? null;
}

/** 通过 openid 查 userId。命中时续期 */
export async function getUserIdByOpenid(openid: string): Promise<string | null> {
  const idx = await kv.get<CloudOpenidIndex>(`openid:${openid}`);
  if (idx) {
    void kv.expire(`openid:${openid}`, USER_TTL_SECONDS);
    void kv.expire(`user:${idx.userId}`, USER_TTL_SECONDS);
  }
  return idx?.userId ?? null;
}

/** 通过 token 校验后查用户。token 不匹配返回 null（防止 token 被篡改后访问别人账号） */
export async function getUserByToken(
  userId: string,
  token: string
): Promise<CloudUser | null> {
  const user = await getUserById(userId);
  if (!user) return null;
  if (user.token !== token) return null;
  return user;
}

/**
 * v1 历史兼容：旧 KV 存了 user:{openid}（openid 当 key），
 * 此函数能读到那批数据，便于迁移。
 */
export async function readLegacyUserByOpenid(
  openid: string
): Promise<{ openid: string; code: string; progress: SaveData } | null> {
  // 注意：旧 schema 的 value 形如 { openid, code, progress, createdAt, updatedAt }
  // 不含 userId / token —— 用宽松类型读出
  const legacy = await kv.get<{ openid?: string; code?: string; progress?: SaveData }>(
    `user:${openid}`
  );
  if (!legacy || !legacy.code || !legacy.progress) return null;
  // 注意：可能命中新 schema 的 user:{userId}（如果 openid 字符串恰好被某 UUID 用作 key），
  // 但 openid 字符串与 UUID 长度差异大，碰撞极不可能；保守起见还是判一下
  if (typeof legacy.openid !== 'string') return null;
  return {
    openid: legacy.openid,
    code: legacy.code,
    progress: legacy.progress,
  };
}

// =========================== 写入 ===========================

/**
 * 创建匿名账号：生成 userId / token / code，写入 user + code 索引。
 * 不绑定 openid（微信关联在另一个流程做）。
 */
export async function createAnonymousUser(
  initialProgress: SaveData
): Promise<CloudUser> {
  const userId = newUserId();
  const token = newToken();
  const code = await allocateCode();
  const now = Date.now();
  const user: CloudUser = {
    userId,
    code,
    token,
    progress: initialProgress,
    createdAt: now,
    updatedAt: now,
  };
  await Promise.all([
    kv.set(`user:${userId}`, user, { ex: USER_TTL_SECONDS }),
    kv.set(
      `code:${code}`,
      { userId, createdAt: now } as CloudCodeIndex,
      { ex: USER_TTL_SECONDS }
    ),
  ]);
  return user;
}

/** 更新进度（凭 userId；调用方应已通过 token 校验） */
export async function updateUserProgress(
  userId: string,
  progress: SaveData
): Promise<CloudUser | null> {
  const user = await getUserById(userId);
  if (!user) return null;
  const next: CloudUser = { ...user, progress, updatedAt: Date.now() };
  await Promise.all([
    kv.set(`user:${userId}`, next, { ex: USER_TTL_SECONDS }),
    kv.expire(`code:${user.code}`, USER_TTL_SECONDS),
    user.openid
      ? kv.expire(`openid:${user.openid}`, USER_TTL_SECONDS)
      : Promise.resolve(),
  ]);
  return next;
}

/**
 * 把 openid 绑定到指定 userId（写入 openid 索引 + user.openid 字段）。
 * 不做合并；调用方应该先确认 openid 没绑过别人。
 */
export async function bindOpenid(
  userId: string,
  openid: string
): Promise<CloudUser | null> {
  const user = await getUserById(userId);
  if (!user) return null;
  if (user.openid === openid) return user;
  const next: CloudUser = { ...user, openid, updatedAt: Date.now() };
  await Promise.all([
    kv.set(`user:${userId}`, next, { ex: USER_TTL_SECONDS }),
    kv.set(
      `openid:${openid}`,
      { userId, createdAt: Date.now() } as CloudOpenidIndex,
      { ex: USER_TTL_SECONDS }
    ),
  ]);
  return next;
}

/**
 * 替换用户进度（覆盖式，调用方负责传入 pickRicher 后的结果）
 */
export async function replaceProgress(
  userId: string,
  progress: SaveData
): Promise<CloudUser | null> {
  return updateUserProgress(userId, progress);
}

/**
 * v1 → v2 迁移辅助：
 *   - 把 user 记录的 code 字段改成 targetCode（老编号）
 *   - 让 code:{targetCode} 索引指向当前 userId
 *   - 把 openid 索引也指向当前 userId
 *   - 让 user.openid 字段就位
 *   - 顺手清掉 newUser 创建时自动分配的临时 code 索引（如果不等于 targetCode）
 */
export async function rebindCodeToUser(params: {
  userId: string;
  oldAutoCode: string;
  targetCode: string;
  openid: string;
}): Promise<void> {
  const { userId, oldAutoCode, targetCode, openid } = params;
  const user = await getUserById(userId);
  if (!user) return;

  const next: CloudUser = {
    ...user,
    code: targetCode,
    openid,
    updatedAt: Date.now(),
  };
  const ops: Array<Promise<unknown>> = [
    kv.set(`user:${userId}`, next, { ex: USER_TTL_SECONDS }),
    kv.set(
      `code:${targetCode}`,
      { userId, createdAt: Date.now() } as CloudCodeIndex,
      { ex: USER_TTL_SECONDS }
    ),
    kv.set(
      `openid:${openid}`,
      { userId, createdAt: Date.now() } as CloudOpenidIndex,
      { ex: USER_TTL_SECONDS }
    ),
  ];
  if (oldAutoCode && oldAutoCode !== targetCode) {
    // 临时 code 索引可以删掉，避免占用编号空间
    ops.push(kv.del(`code:${oldAutoCode}`));
  }
  await Promise.all(ops);
}

/**
 * v1 → v2 迁移辅助：删除老 user:{openid} 记录（迁移完成后避免重复触发迁移）
 */
export async function deleteLegacyOpenidRecord(openid: string): Promise<void> {
  await kv.del(`user:${openid}`);
}
