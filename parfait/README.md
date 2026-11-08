# 芭菲日记

手机优先的 PWA，用来记录在芭菲奶茶店吃了什么、感受如何。纯前端，无构建步骤。

## 运行

任意静态服务器即可（PWA / Service Worker 需要 `https` 或 `localhost`）：

```sh
cd parfait
python3 -m http.server 8000
# 打开 http://localhost:8000
```

部署到 GitHub Pages 等 https 静态托管后，用手机浏览器打开 →「添加到主屏幕」即可离线使用。

## 结构

- `index.html` – 外壳（顶栏、底部导航）
- `js/app.js` – 路由与各页面：时光轴 / 日历 / 新增编辑 / 详情 / 回顾 / 导出导入
- `js/db.js` – IndexedDB（记录与照片 Blob 一起存）
- `sw.js` – 离线缓存（改动前端文件后，把 `CACHE` 版本号 +1）
- `manifest.webmanifest`, `icons/` – PWA 配置与图标

## 数据

- 照片保存前压缩：原图最长边 1600px（JPEG 0.82）+ 320px 方形缩略图
- 时光轴间距：每天 12px（`PX_PER_DAY`），连续 2 个月以上没去会折叠成一段
- 备份：回顾页底部「导出 JSON」（照片以 data URL 内嵌）；导入时同 id 的记录会被覆盖
