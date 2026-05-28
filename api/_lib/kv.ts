/**
 * KV 数据访问层（仅后端使用）
 *
 * 极简模型：
 *   - 唯一键：code:{8位}  →  { progress, updatedAt }
 *   - 无 user / token / openid 概念
 *   - 8 位 code 由前端生成，前端持有 = 拥有写权限
 */

import { kv } from '@vercel/kv';
import type { SaveData } from '../../shared/types.js';

/** 用户数据 TTL：1 年。每次读写都会续期 */
const TTL_SECONDS = 365 * 24 * 60 * 60;

interface CodeRecord {
  progress: SaveData;
  updatedAt: number;
}

export async function getProgress(code: string): Promise<SaveData | null> {
  const rec = await kv.get<CodeRecord>(`code:${code}`);
  if (!rec) return null;
  void kv.expire(`code:${code}`, TTL_SECONDS);
  return rec.progress;
}

export async function setProgress(
  code: string,
  progress: SaveData
): Promise<void> {
  const rec: CodeRecord = { progress, updatedAt: Date.now() };
  await kv.set(`code:${code}`, rec, { ex: TTL_SECONDS });
}
