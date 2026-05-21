/**
 * 项目通用类型定义
 *
 * 集中放置在多个模块间共享的「窄类型」，避免每个文件都内联写
 * `{ x: number; y: number }` 这种结构，便于将来统一调整。
 */

/** 网格坐标点（迷宫格 / 实体位置 / 路径节点） */
export interface Pos {
  x: number;
  y: number;
}

/** 路径：连续的格子坐标序列 */
export type Path = Pos[];
