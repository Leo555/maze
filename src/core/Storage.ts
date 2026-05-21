/**
 * 本地存档：通关记录、最佳成绩、解锁状态
 */

export interface LevelRecord {
  bestTime: number; // 最快用时（秒）
  bestStars: number; // 最高星级
  cleared: boolean;
}

interface Save {
  records: Record<number, LevelRecord>;
  unlocked: number; // 已解锁到第几关
}

const KEY = 'maze_save';

const defaultSave: Save = {
  records: {},
  unlocked: 1,
};

export class Storage {
  private data: Save;

  constructor() {
    this.data = this.load();
  }

  private load(): Save {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return { ...defaultSave, ...parsed };
      }
    } catch {
      /* ignore */
    }
    return { ...defaultSave };
  }

  private flush(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* ignore */
    }
  }

  isUnlocked(levelId: number): boolean {
    return levelId <= this.data.unlocked;
  }

  getRecord(levelId: number): LevelRecord | null {
    return this.data.records[levelId] ?? null;
  }

  /** 提交一次通关，返回是否刷新最佳 */
  submit(levelId: number, time: number, stars: number): boolean {
    const prev = this.data.records[levelId];
    let updated = false;
    if (!prev) {
      this.data.records[levelId] = { bestTime: time, bestStars: stars, cleared: true };
      updated = true;
    } else {
      const best = {
        bestTime: Math.min(prev.bestTime, time),
        bestStars: Math.max(prev.bestStars, stars),
        cleared: true,
      };
      if (best.bestTime !== prev.bestTime || best.bestStars !== prev.bestStars) {
        updated = true;
      }
      this.data.records[levelId] = best;
    }
    if (this.data.unlocked < levelId + 1) {
      this.data.unlocked = levelId + 1;
    }
    this.flush();
    return updated;
  }

  reset(): void {
    this.data = { ...defaultSave };
    this.flush();
  }
}

export const storage = new Storage();
