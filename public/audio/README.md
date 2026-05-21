# 音频资源说明

本项目使用 **代码先行 + 资源后置** 策略：所有音效已预埋接口，**未提供音频文件时会自动用 Web Audio 程序化合成简单音效**，所以你**不放任何文件也能直接玩**。

放置真实音效文件能大幅提升游戏体验。文件路径与命名必须与下表完全一致。

## 目录结构

```
public/audio/
├── sfx/         # 短音效（mp3 推荐，<1s）
│   ├── step.mp3
│   ├── bump.mp3
│   ├── ...
└── bgm/         # 背景音乐（mp3，可循环）
    ├── menu.mp3
    ├── dawn.mp3
    └── ...
```

## 音效文件清单

### SFX（短音效）

| 文件名 | 用途 | 推荐风格 | freesound 关键词 |
|---|---|---|---|
| `sfx/step.mp3` | 玩家走一格 | 轻微"哒"声，木质感 | `footstep wood short` |
| `sfx/bump.mp3` | 撞墙 | 闷响"咚" | `bump thud impact soft` |
| `sfx/dash.mp3` | 冲刺 | "嗖"风声 | `whoosh swoosh short` |
| `sfx/dash_ready.mp3` | 冲刺就绪 | 短促"叮" | `ding ready short` |
| `sfx/pickup_key.mp3` | 拾取钥匙 | 清脆"叮~" | `pickup chime sparkle` |
| `sfx/pickup_hourglass.mp3` | 拾取沙漏 | 沙声 + 叮 | `sand chime` |
| `sfx/pickup_map.mp3` | 拾取地图碎片 | "唰" | `paper unfold reveal` |
| `sfx/pickup_dash.mp3` | 拾取冲刺鞋 | "嗖叮" | `whoosh ding` |
| `sfx/all_keys_collected.mp3` | 钥匙集齐 | 上扬和弦 | `success chord uplifting` |
| `sfx/door_open.mp3` | 单向门通过 | 木质嘎吱 | `door wood creak short` |
| `sfx/door_blocked.mp3` | 门挡住 | 闷响 + 低音 | `blocked denied low` |
| `sfx/portal_enter.mp3` | 进入传送门 | 上行扫频 | `portal teleport sweep up` |
| `sfx/portal_exit.mp3` | 离开传送门 | 下行扫频 | `portal teleport sweep down` |
| `sfx/chaser_alert.mp3` | 被追逐者发现 | 紧张提示 | `alert danger sting` |
| `sfx/level_start.mp3` | 关卡开始 | 短促上扬 | `level start ready` |
| `sfx/level_complete.mp3` | 通关 | 成功旋律（2~3s） | `victory complete jingle` |
| `sfx/level_fail.mp3` | 失败 | 下行音阶 | `failure lose descending` |
| `sfx/countdown_warn.mp3` | 倒计时 ≤10s | "滴" | `beep timer countdown` |
| `sfx/countdown_critical.mp3` | 倒计时 ≤3s | 急促"滴！" | `beep urgent high` |
| `sfx/ui_click.mp3` | 按钮点击 | 短促"哒" | `click ui short` |
| `sfx/ui_hover.mp3` | 按钮悬停 | 极轻"沙" | `hover soft tick` |
| `sfx/ui_open.mp3` | 弹窗打开 | "唰"展开 | `open whoosh ui` |
| `sfx/ui_close.mp3` | 弹窗关闭 | "唰"收起 | `close whoosh ui` |
| `sfx/star_rating.mp3` | 星星评级 | 短促"叮" | `star rating chime` |

### BGM（背景音乐）

每首约 1~3 分钟，loop 可无缝循环。

| 文件名 | 关卡 | 风格 | 节奏 |
|---|---|---|---|
| `bgm/menu.mp3` | 主菜单 | 环境音 + 风铃 | — |
| `bgm/dawn.mp3` | 1. 晨曦 | 轻柔钢琴 + 鸟鸣 | 60 BPM |
| `bgm/mint.mp3` | 2. 薄荷 | Lo-fi + 木琴 | 70 BPM |
| `bgm/dusk.mp3` | 3. 黄昏 | 怀旧钢琴 + 弦乐 | 65 BPM |
| `bgm/deep.mp3` | 4. 深海 | Ambient + 水滴 | 55 BPM |
| `bgm/aurora.mp3` | 5. 极光 | 梦幻合成器 | 75 BPM |
| `bgm/finale.mp3` | 6. 终局 | 紧张电子鼓 | 90 BPM |

## 推荐免费资源站

1. **[freesound.org](https://freesound.org/)** — CC0/CC-BY 授权，最丰富。建议用上面表格的"关键词"搜索。
2. **[kenney.nl/assets](https://kenney.nl/assets)** — CC0，UI/拾取音效特别好。推荐包：`UI Audio`、`Casino Audio`。
3. **[opengameart.org](https://opengameart.org/)** — CC0/CC-BY，BGM 数量多。
4. **[pixabay.com/sound-effects](https://pixabay.com/sound-effects/)** — 免商用。
5. **[incompetech.com](https://incompetech.com/)** — Kevin MacLeod 的经典 BGM 库。

## 文件格式建议

- **格式**：MP3（兼容性最好），码率 128kbps 已足够
- **采样率**：44.1kHz
- **SFX 时长**：≤ 500ms，避免延迟感
- **BGM**：必须能无缝循环（loop point 对齐到节拍）

## 替换流程

1. 下载/制作音频文件
2. 重命名为表格中的文件名
3. 放入对应目录（`public/audio/sfx/` 或 `public/audio/bgm/`）
4. **启用文件加载开关**：在项目根目录创建 `.env.local`（或 `.env`），添加：
   ```
   VITE_AUDIO_ENABLED=true
   ```
5. 重启 `pnpm dev` / 刷新浏览器即可生效（Howler.js 会自动加载）

> **为什么需要开关？** 默认情况下（`VITE_AUDIO_ENABLED` 未设置或为 `false`），SFX 全部走 Web Audio 程序化合成，BGM 静默。这样既能"开箱即玩"，又避免在 mp3 未补齐时产生大量 404 请求污染 Network 面板。
>
> 当开关开启后，任何缺失的 SFX 文件仍会自动 fallback 到合成音效，不会报错（仅会在控制台看到 Howler 的加载失败提示）。
