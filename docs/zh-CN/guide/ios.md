# iOS

## 为什么没有 iOS App

iOS 没有 app。Luker 以 AGPL-3.0 授权，App Store 的条款与该许可要求的自由复制、修改和再分发相冲突，构成[应用商店的法律障碍](https://en.wikipedia.org/wiki/GNU_General_Public_License#Legal_barrier_to_application_stores)，因此无法上架。Android 与 HarmonyOS 允许直接安装应用，所以这两个平台有 app。

## 用浏览器访问 Luker

iPhone 与 iPad 通过浏览器经网络访问 Luker，不从 App Store 安装任何东西。

1. 在一台电脑上运行 Luker 并开启网络访问：
   - 同一网络内 — 见[局域网访问](/zh-CN/guide/lan-access)。
   - 从网络之外 — 见[远程访问](/zh-CN/guide/remote-access)。
2. 在 iPhone 或 iPad 上打开 Safari，输入主机地址。局域网内形如 `http://192.168.1.23:8000`；经代理或隧道访问时，输入你的域名。
3. 若启用了鉴权，需先登录。

## 添加到主屏幕

Luker 可以作为主屏幕图标安装，打开时在自己的窗口中运行，而不是浏览器标签页。

1. 在 Safari 中打开 Luker。
2. 轻点**分享**按钮。
3. 轻点**添加到主屏幕**。
4. 命名后轻点**添加**。

图标会在独立窗口中打开 Luker，不显示 Safari 地址栏，并使用 Luker 图标。

## 相关页面

- [局域网访问](/zh-CN/guide/lan-access) — 让同一网络内的设备访问 Luker
- [远程访问](/zh-CN/guide/remote-access) — 从网络之外访问 Luker
- [Android App](/zh-CN/guide/android) — Android 平台的应用
- [HarmonyOS App](/zh-CN/guide/harmonyos) — HarmonyOS 平台的应用
