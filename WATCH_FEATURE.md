# 「一起看」功能说明与部署（同步观影 + 房间聊天）

双方上传/选择视频发起房间，进入后各自设备同步播放：任何一方播放/暂停/拖进度都会实时同步给对方并给出提示，房间内可文字聊天。视频看完后自动定期清理，不占磁盘。

## 一、功能与规则

| 项目 | 规则 |
| --- | --- |
| 视频来源 | 两种方式：① 小程序内上传（mp4/m4v/mov，默认上限 2GB，超过 100MB 自动走**分片上传** 10MB/片、失败自动重试，超限自动压缩，走 ffmpeg 抽帧检测）；② 管理员工具在电脑端添加（`server/scripts/register-video.mjs`，支持本地文件或 http 直链，不经小程序、不走检测，内容合法性由运营者负责） |
| 观看体验 | 上传完成后服务端自动 **faststart 重封装**（`-c copy` 零画质损失、几乎零 CPU），moov 移到文件头，播放器秒开、边下边播 |
| 内容安全 | 标题走 `msgSecCheck`；视频用 **ffmpeg 抽帧后逐帧 `imgSecCheck`**（微信 `mediaCheckAsync` 不支持视频，只能检图片/音频），任一帧违规即拒绝并删除文件；服务器需安装 ffmpeg |
| 房间 | 同一时间只允许一个进行中的房间；重复发起幂等返回同一房间 |
| 进度同步 | 最后操作生效；对方操作时提示“对方播放了/暂停了/调整进度到 XX”；晚进房、断线重连自动对齐进度 |
| 音量 | 各自设备本地控制（手机音量键），不跨端同步 |
| 聊天 | 房间内文字聊天，走 `msgSecCheck`；历史保留 7 天 |
| 结束方式 | 观看页「结束观看」按钮：对方不在线时直接结束，对方在线时确认后双方一起退出（对方收到提示）；双方都离开 1 分钟后也会自动结束 |
| 自动清理 | 已看完 72 小时删除视频文件和记录；房间+聊天记录 7 天后删除；删除视频时自动结束关联房间；服务端每小时跑一次清理 |

## 二、管理端添加视频（可选的补充方式）

电脑上把视频放进视频库，不用经过手机上传（小程序内的上传入口不受影响）：

```bash
# 方式一：先用 scp/SFTP 把视频传到服务器任意位置，再注册进库
scp our-video.mp4 admin@47.254.234.0:/home/admin/
node server/scripts/register-video.mjs /home/admin/our-video.mp4 我们的第一支视频

# 方式二：直接给 http(s) 直链，服务器自己下载
node server/scripts/register-video.mjs https://example.com/video.mp4 标题
```

说明：这条路径**不走内容检测**（不属于用户通过小程序发布的内容），视频合法性由运营者自己把关；提交审核时版本描述中如实说明"部分视频由开发者在服务端预先放置"。可选在服务器 `.env` 里加 `ADMIN_OPENID=local_xiaoqiu`（或 local_xiaolong）指定视频展示的添加者。

## 三、涉及的新代码

后端（web-love）：
- `server/watch-server.mjs`：WebSocket 服务（`/ws/watch`），房间进出、状态同步、聊天
- `server/index.mjs`：`POST /api/videos`（multipart 上传）、`DELETE /api/videos/:id`、`POST /api/rooms`、`POST /api/rooms/:id/finish`、`GET /api/rooms/:id/messages`、`GET/POST /api/wx/push`（消息推送回调）、视频访问门禁
- `server/db.mjs`：videos / rooms / room_messages 表与清理任务
- `server/wechat-security.mjs`：`submitMediaCheck` + 消息推送验签/解密
- 测试：`node server/test/watch.smoke.mjs`（23 项断言，mock 微信接口）

小程序（D:\love）：
- `pages/watch/`：观看页（同步播放器、进度条、聊天面板）
- `pages/watch-library/`：视频库（上传、列表、发起/进入房间）
- `utils/socket.js`：WebSocket 封装（自动重连 + 心跳）
- 首页新增「一起看」卡片（有邀请时直接显示邀请入口）

## 三、服务器部署步骤

```bash
# 0. 视频抽帧检测依赖 ffmpeg（只装一次）
sudo apt install -y ffmpeg
# 1. 备份 + 拉代码 + 重启（新增依赖 multer、ws，必须 npm install）
cp ~/web-love/server/data/love.sqlite ~/love.sqlite.backup.$(date +%Y%m%d%H%M%S)
cd ~/web-love
git pull origin main
npm install
npm run build
pm2 restart web-love
pm2 save

# 2. .env 追加消息推送配置（第四步在微信后台生成后填入）
cat >> .env <<'EOF'
WECHAT_PUSH_TOKEN=消息推送Token
WECHAT_PUSH_AES_KEY=消息推送EncodingAESKey
EOF
chmod 600 .env
pm2 restart web-love
```

**Nginx 配置**（`/etc/nginx/sites-available/web-love`）需要更新：

```nginx
# 全局或 server 块内：调大上传限制
client_max_body_size 1024m;

# WebSocket 反向代理
location /ws/watch {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}

# 大文件上传放宽超时
location /api/videos {
    proxy_pass http://127.0.0.1:3001;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
}
```

改完 `nginx -t && systemctl reload nginx`。

## 四、微信公众平台后台配置（一次性）

1. **socket 合法域名**：开发管理 → 开发设置 → 服务器域名 → socket 合法域名添加 `wss://lxl-qwx.xyz`（和 request 域名是分开的类别，别漏）。
2. **启用消息推送**：开发管理 → 开发管理 → 消息推送（或“服务与安全 → 消息推送”），配置：
   - URL：`https://lxl-qwx.xyz/api/wx/push`
   - Token：自定义一串随机字符，同时填进服务器 `.env` 的 `WECHAT_PUSH_TOKEN`
   - EncodingAESKey：点随机生成，同时填进 `.env` 的 `WECHAT_PUSH_AES_KEY`
   - 消息数据格式：JSON；加密方式：安全模式（推荐）或明文模式（两种都已兼容）
   - 保存时微信会先请求 URL 做验签，服务端已实现握手
3. request/uploadFile/downloadFile 合法域名不变。

## 五、测试建议（提审前自测）

1. 两个账号同时登录小程序，一个从首页「一起看」进入视频库，上传一段视频。
2. 等状态从“安全检测中”变“可观看”（微信回调一般几秒到一分钟），点「一起看」发起。
3. 另一个账号首页应出现邀请卡片，点击进入。
4. 双方互测：一方拖进度/暂停/播放，另一方画面跟着动并有提示；发一条聊天；一方退出后对方界面显示“对方离开了房间”。
5. 用一个明显的违规词做聊天内容，应被拒绝发送。
6. 服务器 `pm2 logs web-love` 中可见 `[content-security]` 文本/图片检测日志，以及上传视频后的"视频帧检测完成：N/M 帧全部通过"日志（也是审核证明材料）。

## 六、注意事项

- 上传大视频走的是 `wx.uploadFile`（10 分钟超时），1GB 视频在上行带宽小的网络会较慢，进度条会显示百分比。
- 视频检测方式为服务端 ffmpeg 抽帧（按时长取 5~12 帧）逐帧 `imgSecCheck`，同步完成：上传响应返回时状态即为"可观看/未通过检测"，不再有"检测中"等待；服务器未装 ffmpeg 时跳过检测放行并在日志告警。
- 微信 `mediaCheckAsync` 接口只支持图片/音频、不支持视频（这也是早期版本报 47001 的原因），消息推送回调保留用于接收其他微信事件。
- 服务器磁盘建议留意 `~/web-love/server/data/uploads/videos/`，正常情况下看完 72 小时后自动清空。
