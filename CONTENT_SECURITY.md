# 内容安全接入说明（msgSecCheck / imgSecCheck）

小程序审核要求 UGC 内容接入微信内容安全能力，本方案在阿里云后端统一接入，小程序和网页端共用。

## 一、方案概述

| 项目 | 说明 |
| --- | --- |
| 文本检测 | `msgSecCheck` 2.0 版（必须传真实 openid），覆盖：留言、修改留言、纪念日标题、卡券名称/说明、相册标题/说明、昵称 |
| 图片检测 | `imgSecCheck` 同步版（≤1M，JPG/PNG），覆盖：头像、相册照片；超过 1M 的图片服务端自动压缩后再检测 |
| openid 来源 | 小程序登录/启动时静默调 `wx.login` → `POST /api/wx/session` → 后端 `code2session` 换取真实 openid 存入 users 表 `wx_openid` 字段。登录方式（身份+邀请码）不变，用户无感知 |
| 拒绝行为 | 检测不通过返回 `400 {message}`，前端 toast 直接展示"内容包含违规信息，请修改后再发布"等提示 |
| 降级策略 | 未配置 AppSecret 或微信接口调用异常时放行并打警告日志，不 block 正常使用（配置好后即生效） |

接入的接口：`POST /api/users/:openid/profile`、`POST /api/anniversaries`、`POST /api/anniversaries/:id`、`POST /api/messages`、`POST /api/messages/:id/update`、`POST /api/coupons`、`POST /api/albums`。新增接口：`POST /api/wx/session`。

日志：每次检测都会打 `[content-security]` 前缀的日志（含微信返回的完整 JSON），`pm2 logs web-love` 可查看，也可作为调用证明材料。

本地验证：`node server/test/content-security.smoke.mjs`（mock 微信接口，18 项断言）。

## 二、服务器部署步骤

```bash
# 1. 备份数据库（照旧）
cp ~/web-love/server/data/love.sqlite ~/love.sqlite.backup.$(date +%Y%m%d%H%M%S)

# 2. 配置环境变量（AppSecret 不要发到聊天/GitHub）
cd ~/web-love
cat > .env <<'EOF'
WECHAT_APPID=你的小程序AppID
WECHAT_SECRET=你的小程序AppSecret
EOF
chmod 600 .env

# 3. 拉代码并重启
git pull origin main
npm install
npm run build
pm2 restart web-love
pm2 save

# 4. 验证：启动日志应出现"内容安全检测已启用"
pm2 logs web-love --lines 20
```

要求服务器 Node ≥ 18（项目本身用 Express 5，一般已满足）。

## 三、微信公众平台后台要做的配置

1. **IP 白名单**（影响 access_token 获取）：开发管理 → 开发设置 → 「IP 白名单」中加入服务器 IP `47.254.234.0`。如果白名单功能未开启则忽略。
2. **AppID/AppSecret**：开发设置页获取，只填进服务器 `.env`。
3. 合法域名此前已配置（`https://lxl-qwx.xyz`），无变化。

## 四、提交审核时的测试说明（直接粘贴）

```
测试身份一：选择"小邱同学"，邀请码 XIAOQIU
测试身份二：选择"小龙哥哥"，邀请码 XIAOLONG
请先选择身份，再输入对应邀请码登录（无需手机号/微信授权）。

本小程序为双人情侣记录工具，主要功能：纪念日、留言、卡券、记忆相册、头像昵称设置。

内容安全说明：所有用户生成内容（留言、纪念日标题、卡券名称与说明、相册标题与说明、昵称）
在服务端保存前均调用微信 msgSecCheck 2.0 接口检测；头像与相册图片在保存前均调用
imgSecCheck 接口检测，检测不通过会拒绝保存并提示用户。账号体系为双人邀请码制，
仅邀请码持有者可发布内容，公开不可见、无社交传播属性。
```

## 五、录屏/截图证明步骤

审核要求提供内容安全接口调用成功的证明：

1. **保存接口返回值录屏**：部署后在服务器执行 `pm2 logs web-love`，在小程序里发一条正常留言，日志会出现
   `[content-security] msgSecCheck（留言, scene=2）返回：{"errcode":0,...,"result":{"suggest":"pass",...}}`，录屏该日志。
2. **拒绝效果录屏（更有说服力）**：在小程序留言框输入明显的违规测试词发送，会弹出"内容包含违规信息，请修改后再发布"，录屏该过程；日志中会对应出现 `suggest":"risky"`。
3. **上传接口调用成功录屏**：在小程序换一个头像、上传一张相册照片，`pm2 logs` 中出现 `[content-security] imgSecCheck（头像/相册照片）返回：{"errcode":0,...}`，录屏或截图（截图里带上"头像已更新/已保存"的 toast 更好）。
4. 小程序服务截图：小程序各功能页面截图即可（审核要求项）。

## 六、注意事项

- `.env` 已加入 `.gitignore`，AppSecret 永远不会进 GitHub；`.env.example` 只是模板。
- Web 网页端用户没有真实 openid，文本检测会自动跳过（打警告日志），图片检测不受影响；审核只考察小程序端。
- `mediaCheckAsync`（异步检测）需要另外配置微信消息推送服务器，本方案用同步 `imgSecCheck` 已满足审核要求，暂不引入。
- WebP 图片在内容安全启用后会被拒绝（imgSecCheck 不支持且无法转码），小程序端压缩后输出的都是 JPG，不受影响。
- 新用户首次登录后即自动绑定 openid；已在服务器上的老用户下次打开小程序时也会静默补绑。
