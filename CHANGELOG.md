# Changelog

## 0.2.0 — 2026-11-23

新增「全部更新」，角标改为常驻。

**问题**：落后三个、五个插件时，只能逐行点。而且角标「没有待更新就整体不渲染」，
重启后刚扫完那一刻，面板消失了——用户报告的是「重启后角标不见了」，
现象上和插件没加载一模一样。

**根因**：

1. 宿主侧没有批量入口。`pluginManager.updateBundle()` 只接受单个 `name@version`，
   官方没有 `updateAll`，所以一键更新只能自己循环，而循环必须自己处理
   「中途重扫会重写待更新列表，遍历活数组会跳项」和「一个失败不该中断整批」。
2. 安装五个包要几十秒到几分钟，远超一个 HTTP 请求该活的时长。同步应答必然超时，
   而客户端超时会把**实际成功**读成失败——正好是 0.1.1 修的那类假报错的反面。
3. 角标的可见性判据是「当前有没有待更新」，而这是**派生状态**，会自己变成 0；
   于是「已经全部更新好」和「插件没跑起来」渲染成了同一个东西：什么都没有。

**改动**：

- `lib/index.js`
  - 新增导出纯函数 `bulkQueue(updates)`：只留 `actionable` 的行，并 **复制**每一行。
    复制是必要的——批量中途 `sweep()` 会整体替换 `state.updates`，边遍历边被替换会跳项；
    复制同时把每行的目标版本冻结，中途刷新也不会改掉还没开始装的目标。
  - 新增 `applyAll()`：串行装、逐条累计 `done / ok / failed`，进度写进 `state.bulk`
    （`{ total, done, ok, failed, running, current, startedAt, finishedAt, results }`），
    单条失败继续下一个，`finally` 里补一次 `sweep()`。
  - `applyUpdate()` 增加 `{ resweep = true }`：批量里每个包都重扫一次会多出 N 次
    registry 往返，所以批量只在结束时扫一次。
  - 路由新增 `action: 'updateAll'`：**立即应答** `{ ok, started: true, total, state }`，
    批量在后台跑；已有批量在跑时返回 409；空队列返回 `{ started: false, skipped: true }`。
- `lib/client.js`
  - 底部新增主按钮「全部更新（N）」；「重新检查」降级为次要按钮 `.dsh-un-ghost`。
  - `@all` 作为批量运行的哨兵值（真实插件名不会撞），批量期间轮询继续跑，
    间隔压到 2.5 秒，面板显示「正在更新 X（3/5）」，正在装的那一行标 `aria-busy`。
  - 批量结局改成**事件**而不是返回值：新增 `bulkVerdict(t, bulk, mark)` 按
    `finishedAt` 判定「这一批真的跑完了」，同一报告只出一次结论，
    避免轮询把同一批报两遍，也避免按钮按下前的旧报告被当成本批结果。
  - 角标判据从「有没有待更新」改成「有没有收到过宿主状态」（`known`）：
    首报之前仍然隐身（避免控件抖动），首报之后常驻——全部最新时显示绿色 ✓ 已是最新，
    绝不渲染 `0`。
  - 新增 8 条字典 key（`action.updateAll`、`note.bulkWorking`、`note.bulkStart`、
    `note.bulkDone`、`note.bulkNone`、`note.bulkPart`、`note.bulkMore`、`note.bulkLost`、
    `note.needRestart`、`badge.current`），中英齐平。
  - 旧宿主没有批量端点时提示「重启 DSH 后这个按钮才能用」，而不是静默失败。
- `selftest.mjs`：stub React 升级（setter 记录调用、`flush()`、`useRef` 跨 render 保留），
  新增 `update-all affordance / progress / result` 与 `up to date, collapsed` 四段断言。
- `host-test.mjs`：新增 6 条 `bulkQueue` 断言（含「复制行」与「空输入」）。

**测试**：`node selftest.mjs` 与 `node host-test.mjs` 全绿；`node --check` 两份源码通过。

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
