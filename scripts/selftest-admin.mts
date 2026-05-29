/**
 * 后台管理 + 排行榜的核心纯函数自测。
 *
 * 不依赖网络 / KV / DOM，可直接 node --import tsx scripts/selftest-admin.mts
 * （或用 vite-node）。仅验证业务关键逻辑的"骨架"是否正确。
 */

import {
  isValidCode,
  isValidNick,
  maskCode,
  calcOverallScore,
  parseOverallScore,
  CODE_REGEX,
  NICK_MAX_LENGTH,
  type SaveData,
} from '../shared/types';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, extra?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
  }
}

console.log('\n=== isValidCode / CODE_REGEX ===');
ok('合法 code 通过', isValidCode('jeTZUvAs'));
ok('全大写 code 通过', isValidCode('ABCDEFGH'));
ok('全数字 code 通过', isValidCode('23456789'));
ok('含 0 拒绝（易混淆）', !isValidCode('0BCDEFGH'));
ok('含 1 拒绝（易混淆）', !isValidCode('1BCDEFGH'));
ok('含 O 拒绝', !isValidCode('OBCDEFGH'));
ok('含 I 拒绝', !isValidCode('IBCDEFGH'));
ok('含 l 拒绝', !isValidCode('lBCDEFGH'));
ok('长度 7 拒绝', !isValidCode('jeTZUvA'));
ok('长度 9 拒绝', !isValidCode('jeTZUvAss'));
ok('非字符串 null 拒绝', !isValidCode(null));

console.log('\n=== isValidNick ===');
ok('合法昵称（中文）', isValidNick('迷雾旅人'));
ok('合法昵称（英文）', isValidNick('Alice'));
ok('合法昵称（emoji 单 grapheme）', isValidNick('🦊狐狸'));
ok('合法 1 字', isValidNick('a'));
ok('合法 12 字', isValidNick('一二三四五六七八九十拾壹'));
ok('空串拒绝', !isValidNick(''));
ok('13 字拒绝', !isValidNick('一二三四五六七八九十拾壹贰'));
ok('首尾空格拒绝', !isValidNick(' a'));
ok('尾部空格拒绝', !isValidNick('a '));
ok('含控制字符 \\u0000 拒绝', !isValidNick('a\u0000b'));
ok('含 \\u007f 拒绝', !isValidNick('a\u007fb'));
ok('含 \\n 拒绝（控制字符）', !isValidNick('a\nb'));
ok('非字符串 null 拒绝', !isValidNick(null));

console.log('\n=== maskCode ===');
ok('正常脱敏', maskCode('jeTZUvAs') === 'jeT***As');
ok('非法 code 兜底', maskCode('xxx') === '????????');

console.log('\n=== calcOverallScore / parseOverallScore ===');
const empty: SaveData = { v: 1, records: {}, unlocked: 1 };
ok('空存档 score=0', calcOverallScore(empty) === 0);

const oneClear: SaveData = {
  v: 1,
  records: { 1: { bestTime: 30, bestStars: 3, cleared: true } },
  unlocked: 2,
};
ok('通关 1 关 3 星 score=1003', calcOverallScore(oneClear) === 1003);

const fullClear: SaveData = {
  v: 1,
  records: Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [i + 1, { bestTime: 30, bestStars: 3, cleared: true }])
  ),
  unlocked: 101,
};
const fullScore = calcOverallScore(fullClear);
ok('100 关全 3 星 score=100300', fullScore === 100300, fullScore);

// 反解
const { cleared: c1, stars: s1 } = parseOverallScore(1003);
ok('parse 1003 → cleared=1 stars=3', c1 === 1 && s1 === 3, { c1, s1 });
const { cleared: c2, stars: s2 } = parseOverallScore(100300);
ok('parse 100300 → cleared=100 stars=300', c2 === 100 && s2 === 300, { c2, s2 });
const { cleared: c3, stars: s3 } = parseOverallScore(0);
ok('parse 0 → cleared=0 stars=0', c3 === 0 && s3 === 0);

console.log('\n=== 排序语义验证（综合榜分数比较） ===');
// 通关 5 关 0 星  vs  通关 1 关 300 星（理论极端）：通关多的应该在前
const a = calcOverallScore({
  v: 1,
  records: Object.fromEntries(
    Array.from({ length: 5 }, (_, i) => [i + 1, { bestTime: 30, bestStars: 0, cleared: true }])
  ),
  unlocked: 6,
});
const b = calcOverallScore({
  v: 1,
  records: { 1: { bestTime: 30, bestStars: 3, cleared: true } },
  unlocked: 2,
});
ok('5 关 0 星 > 1 关 3 星', a > b, { a, b });

// 同通关数下，星多的优先
const c = calcOverallScore({
  v: 1,
  records: {
    1: { bestTime: 30, bestStars: 3, cleared: true },
    2: { bestTime: 30, bestStars: 3, cleared: true },
  },
  unlocked: 3,
});
const d = calcOverallScore({
  v: 1,
  records: {
    1: { bestTime: 30, bestStars: 1, cleared: true },
    2: { bestTime: 30, bestStars: 1, cleared: true },
  },
  unlocked: 3,
});
ok('同 2 关：6 星 > 2 星', c > d, { c, d });

console.log('\n=== 常量边界 ===');
ok('NICK_MAX_LENGTH = 12', NICK_MAX_LENGTH === 12);
ok('CODE_REGEX 命中标准 code', CODE_REGEX.test('jeTZUvAs'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
