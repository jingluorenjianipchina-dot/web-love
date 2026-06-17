# 专属空间网页版

这是从微信小程序迁移出的网页版本。当前版本使用 React 前端、Node/Express 后端和 SQLite 数据库，不再依赖微信云开发。

## 功能

- 身份选择 + 邀请码登录
- 首页概览、每日文案、纪念日统计
- 纪念日新增与天数计算
- 私密留言、置顶、已读标记
- 卡券创建、申请使用、确认/拒绝
- 服务器数据导出、导入、清空

## 本地运行

```bash
npm install
npm run dev
```

启动后会同时运行：

- 前端：`http://localhost:5173`
- 后端：`http://localhost:3001`

默认邀请码：

- 小邱同学：`XIAOQIU`
- 小龙哥哥：`XIAOLONG`

## 构建

```bash
npm run build
```

构建产物在 `dist` 目录。

## 生产运行

```bash
npm run build
npm run start
```

生产服务默认监听：

```text
http://localhost:3001
```

后端会同时提供 API 和前端页面。

## 数据说明

数据保存在 SQLite 文件里：

```text
server/data/love.sqlite
```

这个文件不会提交到 GitHub。部署到服务器后，请注意备份这个文件。

## API

- `POST /api/login`
- `GET /api/data`
- `POST /api/anniversaries`
- `POST /api/messages`
- `POST /api/messages/read`
- `POST /api/messages/:id/pin`
- `POST /api/coupons`
- `POST /api/coupons/:id/status`
- `GET /api/export`
- `POST /api/import`
- `POST /api/reset`

## 阿里云部署方向

推荐在阿里云服务器上安装 Node.js，然后运行：

```bash
npm install
npm run build
npm run start
```

再用 Nginx 反向代理到 `http://localhost:3001`。

如果绑定国内域名，通常需要完成备案。没有域名时，也可以先用服务器公网 IP 加端口测试。

## 备份

网页“设置”里仍然支持导出 JSON 备份。服务器层面也建议定期备份：

```text
server/data/love.sqlite
```
