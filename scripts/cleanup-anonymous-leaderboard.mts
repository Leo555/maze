/**
 * 一次性清洗脚本：从所有排行榜 ZSET 中移除「无昵称」的 member。
 *
 * 背景：
 *   产品策略调整为「昵称 = 上榜资格」后，老数据中仍有 nick 缺失的 member
 *   （早期版本允许通关后立即上榜，没有强制设昵称）。这些条目在新前端
 *   会被 getOverallTop / getLevelTop 过滤掉，但留在 KV 里会污染：
 *     - ZCARD 通过率统计
 *     - admin/users 列表（按综合榜倒排分页）
 *
 * 清洗范围：
 *   - lb:overall
 *   - lb:lvl:1 .. lb:lvl:100
 *
 * 用法：
 *   1. 设置真 Vercel KV 凭据环境变量：
 *      KV_REST_API_URL=...
 *      KV_REST_API_TOKEN=...
 *   2. 先 dry-run 检查会被删除的数量：
 *      npx tsx scripts/cleanup-anonymous-leaderboard.mts --dry-run
 *   3. 确认无误后执行真删：
 *      npx tsx scripts/cleanup-anonymous-leaderboard.mts --apply
 *
 * 安全：
 *   - 默认 dry-run，必须显式 --apply 才会真改 KV
 *   - 严格用 nick:{code} 是否存在判定，不会误删合法玩家
 *   - 单次运行幂等：重复执行不会产生副作用（已删除的不在榜上，自动跳过）
 */

import { kv } from '@vercel/kv';

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY || process.argv.includes('--dry-run');

interface CleanupStat {
  zsetKey: string;
  total: number;
  withoutNick: number;
  removed: string[]; // 仅 dry-run 时记录前几个 code 用于检查
}

/** 处理单个 ZSET：列出所有 member → 批量查 nick → 删除无 nick 的 */
async function cleanupZSet(zsetKey: string): Promise<CleanupStat> {
  // 0..-1 = 全部
  const members = (await kv.zrange(zsetKey, 0, -1)) as string[];
  const total = members.length;
  if (total === 0) {
    return { zsetKey, total: 0, withoutNick: 0, removed: [] };
  }

  // mget nick:{code} 一次性拉
  const nickKeys = members.map((c) => `nick:${c}`);
  // @vercel/kv 的 mget 签名是变参 args
  const nicks = (await kv.mget<string[]>(...nickKeys)) as (string | null)[];

  const toRemove: string[] = [];
  for (let i = 0; i < members.length; i++) {
    const n = nicks[i];
    if (!n || typeof n !== 'string' || n.length === 0) {
      toRemove.push(members[i]);
    }
  }

  if (toRemove.length === 0) {
    return { zsetKey, total, withoutNick: 0, removed: [] };
  }

  if (!DRY_RUN) {
    // ZREM 一次性删除多个 member（@vercel/kv 支持 zrem 变参）
    // 分批 100 个一组防止单次命令过大
    const BATCH = 100;
    for (let i = 0; i < toRemove.length; i += BATCH) {
      const slice = toRemove.slice(i, i + BATCH);
      await kv.zrem(zsetKey, ...slice);
    }
  }

  return {
    zsetKey,
    total,
    withoutNick: toRemove.length,
    removed: toRemove.slice(0, 5),
  };
}

async function main(): Promise<void> {
  console.log(
    `[cleanup] mode = ${DRY_RUN ? 'DRY-RUN（不会修改 KV）' : 'APPLY（真删）'}`
  );

  const stats: CleanupStat[] = [];

  // 综合榜
  stats.push(await cleanupZSet('lb:overall'));

  // 100 个关卡榜（顺序处理，避免一次打开 100 个连接）
  for (let lv = 1; lv <= 100; lv++) {
    stats.push(await cleanupZSet(`lb:lvl:${lv}`));
  }

  // 汇总
  console.log('\n=== 清洗汇总 ===');
  let grand = 0;
  for (const s of stats) {
    if (s.withoutNick > 0) {
      console.log(
        `${s.zsetKey.padEnd(16)}  total=${s.total}  无昵称=${s.withoutNick}  样例=[${s.removed.join(', ')}${s.withoutNick > 5 ? ', ...' : ''}]`
      );
      grand += s.withoutNick;
    }
  }
  console.log('---');
  console.log(`总计需要清理 ${grand} 条无昵称 ZSET 记录`);
  if (DRY_RUN) {
    console.log('提示：以上为 DRY-RUN 结果。确认无误后用 --apply 真实执行清理。');
  } else {
    console.log('已执行清理。');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
