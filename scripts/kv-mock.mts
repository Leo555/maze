/**
 * @vercel/kv 内存 mock：全局共享一份状态，方便 selftest 跨调用断言。
 */

interface State {
  store: Map<string, unknown>;
  zsets: Map<string, Map<string, number>>;
  sets: Map<string, Set<string>>;
}

const state: State = {
  store: new Map(),
  zsets: new Map(),
  sets: new Map(),
};

const kvImpl = {
  async get<T = unknown>(key: string): Promise<T | null> {
    return (state.store.get(key) as T | undefined) ?? null;
  },
  async set(
    key: string,
    value: unknown,
    opts?: { ex?: number; nx?: boolean }
  ): Promise<'OK' | null> {
    if (opts?.nx && state.store.has(key)) return null;
    state.store.set(key, value);
    return 'OK';
  },
  async expire(key: string, _sec: number): Promise<number> {
    void _sec;
    if (
      !state.store.has(key) &&
      !state.zsets.has(key) &&
      !state.sets.has(key)
    )
      return 0;
    return 1;
  },
  async incr(key: string): Promise<number> {
    const v = ((state.store.get(key) as number) || 0) + 1;
    state.store.set(key, v);
    return v;
  },
  async mget<T = unknown>(...keys: string[]): Promise<(T | null)[]> {
    return keys.map((k) => (state.store.get(k) as T | undefined) ?? null);
  },
  async zadd(
    key: string,
    entry: { score: number; member: string }
  ): Promise<number> {
    const z = state.zsets.get(key) ?? new Map<string, number>();
    const isNew = !z.has(entry.member);
    z.set(entry.member, entry.score);
    state.zsets.set(key, z);
    return isNew ? 1 : 0;
  },
  async zrange(
    key: string,
    start: number,
    stop: number,
    opts: { rev?: boolean; withScores?: boolean } = {}
  ): Promise<(string | number)[]> {
    const z = state.zsets.get(key);
    if (!z) return [];
    const arr = Array.from(z.entries());
    arr.sort((a, b) => (opts.rev ? b[1] - a[1] : a[1] - b[1]));
    const sliced = arr.slice(start, stop + 1);
    if (opts.withScores) {
      const out: (string | number)[] = [];
      for (const [m, s] of sliced) out.push(m, s);
      return out;
    }
    return sliced.map(([m]) => m);
  },
  async zrevrank(key: string, member: string): Promise<number | null> {
    const z = state.zsets.get(key);
    if (!z || !z.has(member)) return null;
    const arr = Array.from(z.entries());
    arr.sort((a, b) => b[1] - a[1]);
    const idx = arr.findIndex(([m]) => m === member);
    return idx >= 0 ? idx : null;
  },
  async zcard(key: string): Promise<number> {
    return state.zsets.get(key)?.size ?? 0;
  },
  async sadd(key: string, ...members: string[]): Promise<number> {
    const s = state.sets.get(key) ?? new Set<string>();
    let added = 0;
    for (const m of members) {
      if (!s.has(m)) {
        s.add(m);
        added++;
      }
    }
    state.sets.set(key, s);
    return added;
  },
  async scard(key: string): Promise<number> {
    return state.sets.get(key)?.size ?? 0;
  },
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (state.store.delete(k)) n++;
      if (state.zsets.delete(k)) n++;
      if (state.sets.delete(k)) n++;
    }
    return n;
  },
  pipeline(): Record<string, unknown> {
    const cmds: Array<() => Promise<unknown>> = [];
    const proxy = new Proxy(
      {},
      {
        get(_t, name: string) {
          if (name === 'exec') {
            return async (): Promise<unknown[]> => {
              const out: unknown[] = [];
              for (const c of cmds) out.push(await c());
              return out;
            };
          }
          return (...args: unknown[]) => {
            cmds.push(() =>
              (kvImpl[name as keyof typeof kvImpl] as (...a: unknown[]) => Promise<unknown>)(
                ...(args as never[])
              )
            );
            return proxy;
          };
        },
      }
    );
    return proxy as Record<string, unknown>;
  },
};

/** 暴露给 selftest 直接读 state（绕过 mock 接口断言内部状态） */
export const __mockState = state;

export const kv = kvImpl;
