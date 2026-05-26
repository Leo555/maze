/**
 * KV 数据访问层（仅后端使用）
 *
 * Key 设计：
 *   user:{openid}      → CloudUser（主存储）
 *   code:{8位}         → CloudCodeIndex（编号 → openid 反向索引）
 *   meta:codeCounter   → 自增编号计数器
 *
 * 编号生成策略：
 *   - 起始 10000000，保证恒为 8 位
 *   - 用 INCR 取下一个值（原子操作，无碰撞）
 *   - 用一个简单的乱序映射，避免用户看出"我是第几个注册的"
 */

import { kv } from '@vercel/kv';
import type { CloudUser, CloudCodeIndex, SaveData } from '../../shared/types.js';

const COUNTER_KEY = 'meta:codeCounter';
const COUNTER_START = 10000000;
/** 与 COUNTER_START 同位数的乘法乱序常量（与 9 千万互质，保证 1:1 映射） */
const SHUFFLE_MUL = 7654321;
/** 加一个固定 salt 让起始值看起来不那么"幼稚"（远离 10000000） */
const SHUFFLE_SALT = 4815162;
/** 8 位编号上限（不含） */
const CODE_MOD = 90000000;

/**
 * 把单调递增的计数器 n 映射为 8 位编号字符串。
 * 输入：0, 1, 2, 3, ...
 * 输出：[10000000, 99999999] 内的看似随机的 8 位数
 *
 * 数学上：(n * SHUFFLE_MUL + SHUFFLE_SALT) % 90000000 + 10000000
 * gcd(SHUFFLE_MUL, 90000000) === 1 保证映射可逆且不冲突。
 */
function counterToCode(n: number): string {
  const v = ((n * SHUFFLE_MUL + SHUFFLE_SALT) % CODE_MOD + COUNTER_START);
  return String(v);
}

/** 给指定 openid 分配一个新的 8 位编号（INCR + 乱序映射） */
async function allocateCode(): Promise<string> {
  // INCR：原子自增，初始为 0（key 不存在时被认作 0）
  const n = await kv.incr(COUNTER_KEY);
  return counterToCode(n - 1); // 第一个用户 n=1 → 用 0 算编号
}

/** 查询 openid 对应的用户记录，没有则返回 null */
export async function getUser(openid: string): Promise<CloudUser | null> {
  return (await kv.get<CloudUser>(`user:${openid}`)) ?? null;
}

/** 查询编号对应的 openid，没有则返回 null */
export async function getOpenidByCode(code: string): Promise<string | null> {
  const idx = await kv.get<CloudCodeIndex>(`code:${code}`);
  return idx?.openid ?? null;
}

/**
 * 创建新用户：分配编号、写入两条 KV。
 * 仅在 openid 没有对应记录时调用。
 */
export async function createUser(
  openid: string,
  initialProgress: SaveData
): Promise<CloudUser> {
  const code = await allocateCode();
  const now = Date.now();
  const user: CloudUser = {
    openid,
    code,
    progress: initialProgress,
    createdAt: now,
    updatedAt: now,
  };
  // 写两条 KV（编号反向索引 + 用户主存储）
  // 这两步不在事务里也没关系：编号是单调递增分配的，不会被复用
  await Promise.all([
    kv.set(`user:${openid}`, user),
    kv.set(`code:${code}`, { openid, createdAt: now } as CloudCodeIndex),
  ]);
  return user;
}

/** 更新用户进度（不创建编号；用户必须已存在） */
export async function updateUserProgress(
  openid: string,
  progress: SaveData
): Promise<CloudUser | null> {
  const user = await getUser(openid);
  if (!user) return null;
  const next: CloudUser = { ...user, progress, updatedAt: Date.now() };
  await kv.set(`user:${openid}`, next);
  return next;
}

/** Get-or-create：保证返回一个有效的 CloudUser */
export async function ensureUser(
  openid: string,
  fallback: SaveData
): Promise<CloudUser> {
  const existing = await getUser(openid);
  if (existing) return existing;
  return createUser(openid, fallback);
}
