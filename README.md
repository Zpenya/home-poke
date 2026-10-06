# 六人扑克（两副牌）使用与部署说明

6 人个人战（争上游），两副牌共 108 张，每人 18 张，无底牌；含三带一、三带二、顺子、连对、飞机、炸弹、天王炸、进贡/回贡。

## 一、目录结构

```
.
├── server/                 # Node.js WebSocket 服务器（部署到云服务器）
│   ├── src/
│   │   ├── cards.js        # 牌堆、洗牌、发牌
│   │   ├── handTypes.js    # 牌型识别/比较/提示（核心引擎）
│   │   ├── game.js         # 游戏状态机
│   │   ├── room.js         # 房间与座位管理
│   │   ├── bot.js          # 机器人策略（补位/调试）
│   │   └── index.js        # WebSocket 入口
│   ├── test/               # 19 项自动化测试
│   └── sim.mjs             # 6 客户端整局模拟器
└── android/SixPlayerPoker/ # 安卓 Kotlin 工程
    └── app/build/outputs/apk/debug/app-debug.apk   # 已编译安装包
```

## 二、服务器部署（公网，6 人异地联机）

以 Ubuntu 云服务器为例（阿里云/腾讯云均可，选最低配 1 核 1 G 即可）。

```bash
# 1. 安装 Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs

# 2. 上传 server 目录后安装依赖
cd server
npm install --production

# 3. 启动（端口可改，默认 8080）
PORT=8080 node src/index.js
```

**后台常驻（推荐 pm2）：**

```bash
sudo npm install -g pm2
PORT=8080 pm2 start src/index.js --name poker
pm2 save && pm2 startup
```

**必须：** 在云服务器控制台的「安全组/防火墙」放行 **8080 端口（TCP）**，否则手机连不上。

可选：用 Nginx 反代 8080 并绑定域名、配置 wss 加密。

## 三、客户端安装与使用

1. 把 `app-debug.apk` 发到 6 部手机安装（Android 7 及以上；非纯血鸿蒙也可安装）。
2. 一人打开 App：填昵称、服务器地址填 `你的服务器公网IP:8080`，点「创建房间」，得到 6 位房号。
3. 其余 5 人：填昵称、同样的服务器地址、房号，点「加入房间」。
4. 房主点「开始游戏」。若人没满，空位会由机器人自动补位。
5. 每局结束后房主点「开始下一局」。

想自行编译：用 Android Studio 打开 `android/SixPlayerPoker` 目录即可。

## 四、规则速查

**牌型（牌力由小到大）**

| 牌型 | 构成 |
|---|---|
| 单张 / 对子 / 三张 | 对子含大王对、小王对（大小王不互配） |
| 三带一 / 三带二 | 三张 + 1 单张 / + 1 对子，只比三张 |
| 顺子 | ≥5 张连续单张，不含 2 和王 |
| 连对 | ≥3 对连续，不含 2 和王 |
| 飞机 | ≥2 组连续三张，可带等量单张或等量对子（不能混带） |
| 四带二 | 4 张 + 2 单或 2 对，属普通牌型不是炸弹 |
| 四条～八条 | 4/5/6/7/8 张同点，条数越多越大 |
| 天王炸 | 2 小王 + 2 大王，全场最大 |

**胜负与进贡**

- 按出完顺序定第 1～6 名；第 5 人走完即结束，末游剩牌作废。
- 下一局先发牌：末游若有**两张大王则抗贡**（两张小王不抗）。
- 不抗贡：末游进贡手中**最大牌**（并列可自选）；头游任选一张回贡，**不能回刚收到的牌**；王可贡可回。
- 无论是否抗贡，**下一局都由末游最先出牌**作为平衡；第一局由持有**黑桃 3** 者先出。

## 五、局域网临时测试（无需云服务器）

同一 WiFi 下，一台电脑运行 `cd server && npm install && npm start`，
手机 App 服务器地址填 `电脑局域网IP:8080`（电脑 IP 用 `ip addr` / `ifconfig` 查看）。

## 六、自测命令

```bash
cd server && npm test        # 19 项单元测试
node sim.mjs                 # 6 客户端模拟 3 局（ROUNDS=n node sim.mjs 可改局数）
```
