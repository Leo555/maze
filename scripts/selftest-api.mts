/**
 * 后台 + 排行榜 API handler 集成测试。
 *
 * 运行方式：通过 kv-mock-loader 拦截 @vercel/kv 解析，使用内存 mock：
 *   tsx --import ./scripts/kv-mock-loader.mts scripts/selftest-api.mts
 *
 * 这样无需真 Vercel KV 凭据，也能跑后端业务逻辑全链路。
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// 设置后端依赖的环境变量
process.env.ADMIN_CODE = 'TestAdminToken12345';
process.env.ALLOWED_ORIGIN = 'http://localhost:5273';

// 直接 import mock，方便断言内部状态
const { __mockState: kvState } = (await import('./kv-mock.mts')) as {
  __mockState: {
    store: Map<string, unknown>;
    zsets: Map<string, Map<string, number>>;
    sets: Map<string, Set<string>>;
  };
};

// =====================================================================
// Mock VercelRequest/Response
// =====================================================================

interface MockReq {
  method?: string;
  url?: string;
  headers: Record<string, string>;
  body?: unknown;
  socket: { remoteAddress: string };
}

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  status(code: number): MockRes;
  setHeader(k: string, v: string): MockRes;
  send(s: string): MockRes;
}

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    headers: {},
    body: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
    send(s) {
      this.body = s;
      return this;
    },
  };
  return res;
}

function makeReq(opts: {
  method?: string;
  url?: string;
  origin?: string;
  body?: unknown;
  ip?: string;
  ua?: string;
}): MockReq {
  return {
    method: opts.method || 'GET',
    url: opts.url || '/',
    headers: {
      origin: opts.origin || 'http://localhost:5273',
      referer: opts.origin || 'http://localhost:5273',
      'user-agent': opts.ua || 'Mozilla/5.0 selftest',
      'x-forwarded-for': opts.ip || '127.0.0.1',
    },
    body: opts.body,
    socket: { remoteAddress: opts.ip || '127.0.0.1' },
  };
}

// =====================================================================
// 断言 helper
// =====================================================================

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(
      `  \x1b[31m✗\x1b[0m ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`
    );
  }
}

function parseJson(res: MockRes): unknown {
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

// =====================================================================
// 跑 handler 测试
// =====================================================================

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const apiDir = resolve(__dirname, '..', 'api');

async function loadHandler(rel: string): Promise<(req: MockReq, res: MockRes) => Promise<void>> {
  const url = pathToFileURL(resolve(apiDir, rel)).href;
  const mod = (await import(url)) as { default: (req: MockReq, res: MockRes) => Promise<void> };
  return mod.default;
}

async function main(): Promise<void> {
  // ---------- save：保存进度 ----------
  console.log('\n=== POST /api/save ===');
  const saveH = await loadHandler('save.ts');

  const code1 = 'jeTZUvAs';
  const code2 = 'AbCd234K';

  // 上榜资格：先给两位测试用户预置昵称（绕过 handler 直写 KV，
  // 模拟"玩家先过启动门槛设了昵称才进游戏"的真实流程）
  // 没有这一步 updateLeaderboards 会因 nick 缺失跳过 ZSET 写入，
  // 导致后续榜单 / admin 测试拿不到数据
  kvState.store.set(`nick:${code1}`, '迷雾旅人');
  kvState.store.set(`nick:${code2}`, '速通王');

  // 1. 缺少 origin → 403
  {
    const req = makeReq({ method: 'POST', url: '/api/save', body: { code: code1 } });
    req.headers.origin = '';
    req.headers.referer = '';
    const res = makeRes();
    await saveH(req, res);
    ok('缺 origin → 403', res.statusCode === 403);
  }

  // 2. 错误 code → 400
  {
    const res = makeRes();
    await saveH(
      makeReq({
        method: 'POST',
        url: '/api/save',
        body: { code: '0000', progress: { v: 1, records: {}, unlocked: 1 } },
      }),
      res
    );
    ok('错误 code → 400 bad_code', res.statusCode === 400);
  }

  // 3. 正常写入
  {
    const res = makeRes();
    await saveH(
      makeReq({
        method: 'POST',
        url: '/api/save',
        body: {
          code: code1,
          progress: {
            v: 1,
            unlocked: 4,
            records: {
              1: { bestTime: 30, bestStars: 3, cleared: true },
              2: { bestTime: 50, bestStars: 2, cleared: true },
              3: { bestTime: 80, bestStars: 1, cleared: true },
            },
          },
        },
      }),
      res
    );
    const body = parseJson(res) as { progress?: { unlocked?: number } };
    ok('正常 save → 200', res.statusCode === 200, { status: res.statusCode, body: res.body });
    ok('返回 progress.unlocked=4', body.progress?.unlocked === 4);
  }

  // 4. 等待异步副作用（updateLeaderboards 是 fire-and-forget）
  await new Promise((r) => setTimeout(r, 80));

  // 5. 综合榜
  {
    const z = kvState.zsets.get('lb:overall');
    ok('lb:overall 已写入 code1', z?.has(code1) ?? false);
    ok('lb:overall code1 score=3006', z?.get(code1) === 3006, z?.get(code1));
  }

  // 6. 单关榜
  {
    const z1 = kvState.zsets.get('lb:lvl:1');
    ok('lb:lvl:1 已写入', z1?.has(code1) ?? false);
    ok('lb:lvl:1 bestTime=30', z1?.get(code1) === 30);
  }

  // 7. 第二个用户更高分（注意：ratelimit 会卡同 IP，换 IP）
  {
    const res = makeRes();
    await saveH(
      makeReq({
        method: 'POST',
        url: '/api/save',
        ip: '10.0.0.2',
        ua: 'Mozilla/5.0 selftest user2',
        body: {
          code: code2,
          progress: {
            v: 1,
            unlocked: 6,
            records: Object.fromEntries(
              Array.from({ length: 5 }, (_, i) => [
                i + 1,
                { bestTime: 20, bestStars: 3, cleared: true },
              ])
            ),
          },
        },
      }),
      res
    );
    ok('第二个用户 save → 200', res.statusCode === 200, {
      status: res.statusCode,
      body: res.body,
    });
  }
  await new Promise((r) => setTimeout(r, 80));

  // ---------- nick ----------
  console.log('\n=== POST /api/nick ===');
  const nickH = await loadHandler('nick.ts');

  // 空昵称 → 400
  {
    const res = makeRes();
    await nickH(
      makeReq({ method: 'POST', url: '/api/nick', body: { code: code1, nick: '' } }),
      res
    );
    ok('空昵称 → 400', res.statusCode === 400);
  }

  // 13 字 → 400
  {
    const res = makeRes();
    await nickH(
      makeReq({
        method: 'POST',
        url: '/api/nick',
        body: { code: code1, nick: '一二三四五六七八九十拾壹贰' },
      }),
      res
    );
    ok('13 字 → 400', res.statusCode === 400);
  }

  // 正常写入
  {
    const res = makeRes();
    await nickH(
      makeReq({ method: 'POST', url: '/api/nick', body: { code: code1, nick: '迷雾旅人' } }),
      res
    );
    ok('设置昵称 → 200', res.statusCode === 200, { body: res.body });
    ok('nick KV 写入', kvState.store.get(`nick:${code1}`) === '迷雾旅人');
  }

  // ---------- leaderboard ----------
  console.log('\n=== GET /api/leaderboard ===');
  const lbH = await loadHandler('leaderboard.ts');

  // 综合榜：第一名应该是 code2（验证不再泄露 code、isMe 由 ?me 触发）
  {
    const res = makeRes();
    await lbH(makeReq({ url: '/api/leaderboard?type=overall&limit=10' }), res);
    const body = parseJson(res) as {
      items?: {
        rank: number;
        cleared: number;
        nick: string | null;
        isMe: boolean;
        code?: string; // 安全断言用：必须不存在
      }[];
    };
    ok('综合榜 → 200', res.statusCode === 200);
    // 通过通关数判定 top1 是 code2（cleared=5）；不再用 code 比对
    ok('top1 cleared=5（即 code2）', body.items?.[0]?.cleared === 5);
    ok('top2 nick=迷雾旅人（即 code1）', body.items?.[1]?.nick === '迷雾旅人');
    // 安全：不带 me 时所有 isMe 必须为 false
    ok('未带 me → isMe 全为 false', body.items?.every((it) => it.isMe === false) === true);
    // 安全：响应中不能再含明文 code 字段
    ok(
      '响应不再泄露 code 字段',
      body.items?.every((it) => !('code' in it)) === true
    );
  }

  // 综合榜带 ?me=：仅命中行 isMe=true，其它 false
  {
    const res = makeRes();
    await lbH(
      makeReq({
        url: `/api/leaderboard?type=overall&limit=10&me=${code1}`,
      }),
      res
    );
    const body = parseJson(res) as {
      items?: { rank: number; nick: string | null; isMe: boolean }[];
    };
    ok('带 me=code1 → 200', res.statusCode === 200);
    // code1 是 top2（nick=迷雾旅人）
    ok('me=code1 → 第 2 行 isMe=true', body.items?.[1]?.isMe === true);
    ok('me=code1 → 其它行 isMe=false', body.items?.[0]?.isMe === false);
  }

  // me 参数非法（不符合 8 位 code 格式）→ 静默忽略，不报错
  {
    const res = makeRes();
    await lbH(makeReq({ url: '/api/leaderboard?type=overall&me=hack' }), res);
    const body = parseJson(res) as {
      items?: { isMe: boolean }[];
    };
    ok('me 非法格式 → 静默忽略，仍 200', res.statusCode === 200);
    ok(
      'me 非法格式 → isMe 全 false',
      body.items?.every((it) => it.isMe === false) === true
    );
  }

  // 关卡榜（第 1 关）
  {
    const res = makeRes();
    await lbH(makeReq({ url: '/api/leaderboard?type=level&id=1&limit=10' }), res);
    const body = parseJson(res) as {
      items?: { bestTime: number; isMe: boolean; code?: string }[];
    };
    ok('关卡榜 → 200', res.statusCode === 200);
    ok('top1 bestTime=20（即 code2）', body.items?.[0]?.bestTime === 20);
    ok('top2 bestTime=30（即 code1）', body.items?.[1]?.bestTime === 30);
    ok(
      '关卡榜响应不再泄露 code 字段',
      body.items?.every((it) => !('code' in it)) === true
    );
  }

  // 关卡榜带 me：命中后 isMe=true
  {
    const res = makeRes();
    await lbH(
      makeReq({ url: `/api/leaderboard?type=level&id=1&me=${code2}` }),
      res
    );
    const body = parseJson(res) as {
      items?: { bestTime: number; isMe: boolean }[];
    };
    ok('关卡榜带 me=code2 → top1 isMe=true', body.items?.[0]?.isMe === true);
    ok('关卡榜带 me=code2 → top2 isMe=false', body.items?.[1]?.isMe === false);
  }

  // 错误关卡 id
  {
    const res = makeRes();
    await lbH(makeReq({ url: '/api/leaderboard?type=level&id=999' }), res);
    ok('关卡榜 id=999 → 400', res.statusCode === 400);
  }

  // ---------- admin ----------
  console.log('\n=== GET /api/admin/* ===');
  const statsH = await loadHandler('admin/stats.ts');
  const usersH = await loadHandler('admin/users.ts');
  const userH = await loadHandler('admin/user.ts');

  // 未带 token → 401
  {
    const res = makeRes();
    await statsH(makeReq({ url: '/api/admin/stats' }), res);
    ok('未带 token → 401', res.statusCode === 401);
  }

  // 错误 token → 401
  {
    const res = makeRes();
    await statsH(makeReq({ url: '/api/admin/stats?token=wrong' }), res);
    ok('错误 token → 401', res.statusCode === 401);
  }

  // 正确 token → 200
  {
    const res = makeRes();
    await statsH(makeReq({ url: `/api/admin/stats?token=${process.env.ADMIN_CODE}` }), res);
    const body = parseJson(res) as {
      totalUsers?: number;
      dau?: { day: string; count: number }[];
      levelClears?: { levelId: number; cleared: number }[];
    };
    ok('admin/stats 正确 token → 200', res.statusCode === 200, {
      status: res.statusCode,
      body: res.body.slice(0, 200),
    });
    ok('totalUsers=2', body.totalUsers === 2, body.totalUsers);
    ok('dau 7 项', body.dau?.length === 7);
    ok('今天 dau 至少 2', (body.dau?.[6]?.count ?? 0) >= 2, body.dau?.[6]);
    ok('levelClears 长度 100', body.levelClears?.length === 100);
    ok('第 1 关通关人数=2', body.levelClears?.[0]?.cleared === 2);
    ok('第 5 关通关人数=1', body.levelClears?.[4]?.cleared === 1);
    ok('第 99 关通关人数=0', body.levelClears?.[98]?.cleared === 0);
  }

  // admin/users
  {
    const res = makeRes();
    await usersH(
      makeReq({ url: `/api/admin/users?token=${process.env.ADMIN_CODE}&offset=0&limit=10` }),
      res
    );
    const body = parseJson(res) as { items?: { code: string; rank: number }[] };
    ok('admin/users → 200', res.statusCode === 200);
    ok('items.length=2', body.items?.length === 2);
    ok('rank=1 是 code2', body.items?.[0]?.code === code2);
  }

  // admin/user 详情
  {
    const res = makeRes();
    await userH(
      makeReq({ url: `/api/admin/user?token=${process.env.ADMIN_CODE}&target=${code1}` }),
      res
    );
    const body = parseJson(res) as {
      code?: string;
      nick?: string;
      progress?: { unlocked: number };
      rank?: number;
    };
    ok('admin/user → 200', res.statusCode === 200);
    ok('code 匹配', body.code === code1);
    ok('nick=迷雾旅人', body.nick === '迷雾旅人');
    ok('rank=2', body.rank === 2);
    ok('progress.unlocked=4', body.progress?.unlocked === 4);
  }

  // not_found
  {
    const res = makeRes();
    await userH(
      makeReq({ url: `/api/admin/user?token=${process.env.ADMIN_CODE}&target=ZZZZZZZZ` }),
      res
    );
    ok('查不到的 code → 404', res.statusCode === 404);
  }

  // ADMIN_CODE 未配置 → 503
  {
    const saved = process.env.ADMIN_CODE;
    delete process.env.ADMIN_CODE;
    const res = makeRes();
    await statsH(makeReq({ url: '/api/admin/stats?token=anything' }), res);
    ok('ADMIN_CODE 未配置 → 503', res.statusCode === 503);
    process.env.ADMIN_CODE = saved;
  }

  // ---------- sync ----------
  console.log('\n=== GET /api/sync ===');
  const syncH = await loadHandler('sync.ts');
  {
    const res = makeRes();
    await syncH(makeReq({ url: `/api/sync?code=${code1}` }), res);
    const body = parseJson(res) as {
      progress?: { unlocked: number };
      nick?: string | null;
    };
    ok('sync → 200', res.statusCode === 200);
    ok('progress.unlocked=4', body.progress?.unlocked === 4);
    // 之前 nick 测试用例已经给 code1 设了"迷雾旅人"，sync 应该一并返回
    ok('sync 同时返回 nick=迷雾旅人', body.nick === '迷雾旅人');
  }
  {
    // 边界：有 progress 但没设 nick 的 code → sync 应返回 nick=null
    // 用一个独立的 code 模拟（避免污染主流程的 code1/code2）
    const codeNoNick = 'kPmR3gT9';
    kvState.store.set(`code:${codeNoNick}`, {
      progress: { v: 1, unlocked: 1, records: {} },
      updatedAt: Date.now(),
    });
    const res = makeRes();
    await syncH(makeReq({ url: `/api/sync?code=${codeNoNick}` }), res);
    const body = parseJson(res) as { nick?: string | null };
    ok('sync 无昵称的 code → nick=null', body.nick === null);
  }
  {
    const res = makeRes();
    await syncH(makeReq({ url: '/api/sync?code=ZZZZZZZZ' }), res);
    ok('sync 不存在 → 404', res.statusCode === 404);
  }

  // ---------- 反作弊：unlock_delta TOCTOU 互斥锁 ----------
  // 模拟两个并发 save：第一个还在临界区里时，第二个必须被锁拒绝
  console.log('\n=== Anti-cheat: unlock_delta + write lock ===');
  {
    const code3 = 'kPmR3gT5';
    // 先写入一个已有进度（unlocked=2）。注意 save 内部有限流（5s 最小间隔），
    // 所以接下来用 code3 第二次正常写已经会被 too_fast 拦——为此我们用不同 IP+UA 避免
    // 多端并发判定，并直接清掉 sess 锚来绕过 L1 频率限制以测互斥锁本身。
    {
      const r = makeRes();
      await saveH(
        makeReq({
          method: 'POST',
          url: '/api/save',
          ip: '10.0.0.10',
          body: { code: code3, progress: { v: 1, unlocked: 2, records: {} } },
        }),
        r
      );
      ok('初始 save unlocked=2 → 200', r.statusCode === 200);
    }
    // 清 sess 锚 + L2 burst 计数 + L3 IP 集合，避免影响后续测试
    kvState.store.delete(`sess:${code3}`);
    kvState.store.delete(`rl:save:burst:${code3}`);
    kvState.sets.delete('rl:save:ip:10.0.0.10');

    // 模拟"持锁中"：手动 SET NX 占据锁
    kvState.store.set(`lock:save:${code3}`, '1');
    {
      const r = makeRes();
      await saveH(
        makeReq({
          method: 'POST',
          url: '/api/save',
          ip: '10.0.0.10',
          body: { code: code3, progress: { v: 1, unlocked: 3, records: {} } },
        }),
        r
      );
      ok('并发同 code → 锁占据时返回 429 too_fast', r.statusCode === 429);
      const body = parseJson(r) as { error?: string };
      ok('错误码=too_fast', body.error === 'too_fast');
    }
    kvState.store.delete(`lock:save:${code3}`);

    // 越权 unlock 增量：current=2，incoming=10 → 5 阈值不允许
    kvState.store.delete(`sess:${code3}`);
    {
      const r = makeRes();
      await saveH(
        makeReq({
          method: 'POST',
          url: '/api/save',
          ip: '10.0.0.10',
          body: { code: code3, progress: { v: 1, unlocked: 10, records: {} } },
        }),
        r
      );
      ok('unlock 跳跃 +8 → 400 unlock_delta_too_large', r.statusCode === 400);
    }
    // 校验：失败后锁必须已释放（否则下一次 save 会卡死）
    ok(
      'unlock 校验失败后锁已释放',
      !kvState.store.has(`lock:save:${code3}`)
    );
  }

  // ---------- 反作弊：normalizeSave 字段校验 ----------
  // 通过 save 接口注入脏数据，验证后端会丢弃非法 records 与钳制非法 stars
  console.log('\n=== Anti-cheat: normalizeSave 字段校验 ===');
  {
    const code4 = 'kPmR3gT6';
    // 清残留状态
    kvState.store.delete(`sess:${code4}`);
    kvState.store.delete(`rl:save:burst:${code4}`);
    {
      const r = makeRes();
      await saveH(
        makeReq({
          method: 'POST',
          url: '/api/save',
          ip: '10.0.0.20',
          body: {
            code: code4,
            progress: {
              v: 1,
              unlocked: 3,
              records: {
                // 合法记录
                '1': { bestTime: 12.5, bestStars: 3, cleared: true },
                // 异常 stars=999 → 被钳制为 3
                '2': { bestTime: 20, bestStars: 999, cleared: true },
                // bestTime 为 NaN → 整条丢弃
                '3': { bestTime: NaN, bestStars: 2, cleared: true },
                // bestTime 超大（10 小时）→ 整条丢弃
                '4': { bestTime: 36000, bestStars: 1, cleared: true },
                // levelId 越界 → 整条丢弃
                '999': { bestTime: 5, bestStars: 3, cleared: true },
                // 字符串 bestTime → 整条丢弃
                '5': { bestTime: 'fast', bestStars: 3, cleared: true },
              },
            },
          },
        }),
        r
      );
      ok('注入脏数据 save → 200', r.statusCode === 200);
      const body = parseJson(r) as {
        progress?: { records?: Record<string, { bestStars: number; bestTime: number }> };
      };
      const recs = body.progress?.records ?? {};
      ok('合法记录保留（id=1）', !!recs['1']);
      ok('id=1 stars=3', recs['1']?.bestStars === 3);
      ok('id=2 stars 被钳制到 3', recs['2']?.bestStars === 3);
      ok('id=3 NaN bestTime → 丢弃', !recs['3']);
      ok('id=4 超大 bestTime → 丢弃', !recs['4']);
      ok('id=999 越界 → 丢弃', !recs['999']);
      ok('id=5 字符串 bestTime → 丢弃', !recs['5']);
    }
  }

  // ---------- 上榜资格 = 已设昵称 ----------
  console.log('\n=== Account: 昵称是上榜资格 ===');
  {
    // 新 code 没有昵称，save 后不应进 ZSET
    const codeAnon = 'sNkR9pXt';
    kvState.store.delete(`sess:${codeAnon}`);
    kvState.store.delete(`rl:save:burst:${codeAnon}`);
    const r = makeRes();
    await saveH(
      makeReq({
        method: 'POST',
        url: '/api/save',
        ip: '10.0.0.50',
        body: {
          code: codeAnon,
          progress: {
            v: 1,
            unlocked: 3,
            records: { 1: { bestTime: 15, bestStars: 3, cleared: true } },
          },
        },
      }),
      r
    );
    ok('无昵称 save → 200（接口仍成功，仅不上榜）', r.statusCode === 200);
    await new Promise((rs) => setTimeout(rs, 80));
    const z = kvState.zsets.get('lb:overall');
    ok('无昵称用户不进综合榜', !z?.has(codeAnon));
    const z1 = kvState.zsets.get('lb:lvl:1');
    ok('无昵称用户不进单关榜', !z1?.has(codeAnon));

    // 给他设昵称 → 应触发回填，立即上榜
    const r2 = makeRes();
    await nickH(
      makeReq({
        method: 'POST',
        url: '/api/nick',
        ip: '10.0.0.50',
        body: { code: codeAnon, nick: '后来才命名的旅人' },
      }),
      r2
    );
    ok('补设昵称 → 200', r2.statusCode === 200);
    await new Promise((rs) => setTimeout(rs, 80));
    const z3 = kvState.zsets.get('lb:overall');
    ok('补设昵称后已回填到综合榜', z3?.has(codeAnon) === true);
    const z4 = kvState.zsets.get('lb:lvl:1');
    ok('补设昵称后已回填到单关榜', z4?.has(codeAnon) === true);
  }

  // ---------- 7 天改名冷却 ----------
  console.log('\n=== Account: 改名 7 天冷却 ===');
  {
    const codeRen = 'rEnAm8Ks';
    // 首次设置：不限频
    kvState.store.delete(`nick:cd:${codeRen}`);
    {
      const r = makeRes();
      await nickH(
        makeReq({
          method: 'POST',
          url: '/api/nick',
          ip: '10.0.0.60',
          body: { code: codeRen, nick: '初次命名' },
        }),
        r
      );
      ok('首次设置昵称 → 200（不走冷却）', r.statusCode === 200);
      ok(
        '首次设置后未占用冷却锁',
        !kvState.store.has(`nick:cd:${codeRen}`)
      );
    }
    // 第二次改名：占用冷却锁，第三次同窗口内必拒
    {
      const r = makeRes();
      await nickH(
        makeReq({
          method: 'POST',
          url: '/api/nick',
          ip: '10.0.0.60',
          body: { code: codeRen, nick: '第二个昵称' },
        }),
        r
      );
      ok('第二次改名 → 200（拿到冷却锁）', r.statusCode === 200);
      ok(
        '冷却锁已建立',
        kvState.store.has(`nick:cd:${codeRen}`)
      );
    }
    {
      const r = makeRes();
      await nickH(
        makeReq({
          method: 'POST',
          url: '/api/nick',
          ip: '10.0.0.60',
          body: { code: codeRen, nick: '第三个昵称' },
        }),
        r
      );
      ok(
        '冷却期内第三次改名 → 429',
        r.statusCode === 429
      );
      const body = parseJson(r) as { error?: string };
      ok('错误码=nick_too_frequent', body.error === 'nick_too_frequent');
    }
    // 幂等：用相同昵称重复提交不应触发冷却
    {
      const r = makeRes();
      await nickH(
        makeReq({
          method: 'POST',
          url: '/api/nick',
          ip: '10.0.0.60',
          body: { code: codeRen, nick: '第二个昵称' }, // 与现有相同
        }),
        r
      );
      ok('幂等：与现昵称相同 → 200', r.statusCode === 200);
    }
  }

  // ---------- nick=null 不再出现在榜单（响应类型紧化） ----------
  console.log('\n=== Account: 榜单响应不含 nick=null ===');
  {
    // 直接构造一个"已在榜上但 nick 缺失"的脏数据，验证 getOverallTop 会过滤掉
    const dirtyCode = 'dRtyM9Ks';
    const z = kvState.zsets.get('lb:overall') ?? new Map<string, number>();
    z.set(dirtyCode, 99999);
    kvState.zsets.set('lb:overall', z);
    // 注意：故意不设 nick:dirtyCode

    const res = makeRes();
    await lbH(makeReq({ url: '/api/leaderboard?type=overall&limit=100' }), res);
    const body = parseJson(res) as {
      items?: { nick: string }[];
    };
    ok(
      '脏数据（nick 缺失）被过滤，不出现在榜单',
      body.items?.every((it) => typeof it.nick === 'string' && it.nick.length > 0) === true
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
