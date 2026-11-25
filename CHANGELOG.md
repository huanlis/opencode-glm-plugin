# Changelog

## 1.0.0 — 2026-11-25

首个公开版本，发布到 npm。

- 侧边栏「GLM 额度」面板：5 小时窗口、周期积分、月度工具额度的进度条、已用百分比与重置倒计时
- 今天 / 最近 7 天 / 最近 30 天：Token、调用次数、逐时段趋势图、按模型分解
- 已用 ≥80% 变黄、≥95% 变红、100% 标记「已限额」
- 侧边栏 + 菜单启动项、标题栏用量徽标
- 中英双语，跟随系统语言
- 主进程通过 Ipc 取数，90 秒缓存，窗口 5 分钟自动刷新
- API Key 读取 OpenCode 登录凭据，支持 `apiKey` / `baseUrl` / `organization` / `project` / `planType` 覆盖
- 对齐 OpenCode Desktop 2.4.1 与 `@opencode/plugin@2.4.1`
