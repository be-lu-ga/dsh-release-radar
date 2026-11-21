# Changelog

## 0.1.1 — 2026-11-22

修好「更新失败但看不出为什么」。

**问题**：面板只显示一句 `Update failed:  update failed`，既不说哪个插件、也不说原因。

**根因**：两层信息丢失叠加。

1. `pluginManager.updateBundle()` 在拒绝更新时**不抛异常**，而是正常返回
   `result.error = { code, diagnostic? }` —— 它永远是**对象**，从不是字符串。
   旧代码用 `typeof detail === 'string'` 判断，恒为 false，于是每次失败都落到
   兜底串 `'update failed'`，真实的 `code` 与 `diagnostic` 被整个丢掉。
2. 失败时路由返回 **HTTP 500**，前端 `post()` 见到 `!response.ok` 就先抛错，
   导致 `applyOne` 里那个能显示「插件名 + 原因」的分支成了死代码，实际走的
   catch 分支不带插件名。

**改动**：

- `lib/index.js` 新增 `describeFailure(result)`，按
  `diagnostic` → `incompatible` → `packageResult.output` 尾部 → `failedAt` → `code`
  的顺序提取可读原因，并为 15 个错误码补了直白说明（含没有 `diagnostic` 的
  `not-bundle`、`stop-profile`、`bundle-in-use` 等）。
- `applyUpdate()` 失败时额外回传 `code / stage / failedAt / from / to / logPath / restore`。
- 更新路由恒返回 **HTTP 200**：拒绝是正常结果，请求本身处理成功；只有真实异常才失败。
- `lib/client.js` 失败横幅改为 `更新失败：插件名 — 真实原因 [错误码]`，
  catch 分支也补上插件名。

**测试**：`host-test.mjs` 新增 8 条 `describeFailure` 断言；`selftest.mjs` 新增
3 条横幅断言（错误色调、含插件名、含原因）。

## 0.1.0 — 2026-11-21

首个公开版本。每 24 小时扫描已安装的第三方插件，有新版就在右下角浮出角标；
registry 按 semver 比较，GitHub 按 lockfile 里 pin 的 commit 与远端 HEAD 比较。
Git 来源标为需手动处理，因为 DSH 要求目标版本严格高于已装版本。
