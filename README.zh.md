# 更新提醒（dsh-release-radar）

[English](README.md) | 简体中文

装在 DSH 上的插件不一定跟着本体走。这个插件替你盯着它们：每 24 小时扫一遍，有新版就在右下角浮出一枚小角标，点开能看到每个插件落后多少，一次更新一个。

**没有你的点击，不会安装任何东西。**

## 它解决什么问题

DSH 自带的插件页只在**你主动去看**的时候告诉你有没有新版。装了十来个第三方插件之后，你不会每天挨个点开检查——于是某个插件悄悄落后好几个版本，直到某天出问题才发现。

Release Radar 把这件事变成背景动作：启动后自己扫，有结果才出现，没结果就完全不占地方。

## 什么时候检查

- DSH 启动约 20 秒后跑第一次。
- 之后每 24 小时一次。
- 点面板里的「重新检查」可以随时手动触发。

重启不会让角标变空：上一次的结果存在 profile 目录里，冷启动先读缓存，扫完再覆盖。

## 会检查哪些插件

只看**装在这个 profile 里的第三方插件**：

| 来源 | 处理方式 |
| --- | --- |
| registry（`名字@版本`） | 查最新发布版本，比当前高就提示 |
| GitHub（`github:用户/仓库`） | 读 `pnpm-lock.yaml` 里 pin 的 commit，和远端 `HEAD` 比 |
| 本地 `link:` / `file:` | 跳过（本地就是最新的） |
| 预发布版本 | 默认跳过，可在配置里打开 |
| 官方内置 `@deepseek-ai/*` | 跟随 DSH 本体版本，不在这里管 |

版本比较是数字化的：`0.4.9 < 0.4.10`，`1.0.0-rc.1 < 1.0.0`。用字符串比会把 `0.4.10` 判成比 `0.4.9` 旧。

## 点「更新」之后会发生什么

调的是 DSH 自己的 `pluginManager.updateBundle()`，和插件页里点更新是同一件事：

1. 先在 registry 上校验：目标版本存在、声明了 bundle、接受当前 DSH 版本。
2. 校验不过就什么都不改，角标里报错。
3. 通过就装，然后自动重扫一遍。

`updateBundle()` 校验失败时**不会抛异常**，而是正常返回一个带 `application: 'failed' | 'cancelled'` 的结果。这个插件检查这个字段再报成败——否则失败的更新会被显示成「已更新」，那是在骗人。

## 为什么有的行没有「更新」按钮

Git 来源的插件，包版本号通常不随提交变化，而 DSH 的更新流程要求「目标版本必须严格高于已装版本」。所以这类包无法一键更新，面板里标成「来自 Git，需手动处理」，并照常显示它落后了哪几个提交。

这不是偷懒——给出一个点了必然失败的按钮更糟。

## 配置

```yml
- insert:
    - id: dsh-release-radar
      name: dsh-release-radar
      config:
        intervalHours: 24        # 1 .. 336
        startDelayMs: 3000       # 启动后延迟多久跑第一次
        includePrerelease: false # 是否把 -rc / -beta 计入
        diagnostics: false       # 面板把渲染结果回报给 Host，用于排查角标不显示
```

## 安装

```bash
pnpm add github:be-lu-ga/dsh-release-radar
```

然后在 profile 的 `dsh.profile.bundles` 里加上 `dsh-release-radar`，重启 DSH。

## 关掉它

角标不再出现，也不再发起任何后台检查。已经装上的插件不受影响。

## 开发

```
lib/index.js    Host 半部：扫描、版本比较、路由、安装
lib/client.js   Client 半部：右下角角标与面板
locale/         zh / en 文案与插件页描述
docs/           插件页预览与说明
selftest.mjs    无 harness 的 Client 渲染测试
host-test.mjs   Host 半部的纯函数与 profile 探测测试
```

```bash
node selftest.mjs
node host-test.mjs
```

两个测试都不需要 DSH 运行时：Client 测试自己桩掉模块加载器、React 和 document，Host 测试只跑纯函数。

## 已知边界

- 只认 registry 与 GitHub 两类来源，其他 Git 托管（GitLab、自建）暂不判定。
- Git 来源的「落后」按 commit 判等，不做祖先关系判断；分支被 force-push 时提示可能重复出现。
- 角标在 `shell.overlay` 槽位，和别的浮层共享右下角空间，极端情况下会重叠。

## License

MIT
