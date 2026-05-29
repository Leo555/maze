/**
 * tsx loader：拦截 import '@vercel/kv'，返回内存 mock。
 *
 * 使用：tsx --import ./scripts/kv-mock-loader.mts <entry>
 */

import { register } from 'node:module';

register('./kv-mock-resolver.mts', import.meta.url);
