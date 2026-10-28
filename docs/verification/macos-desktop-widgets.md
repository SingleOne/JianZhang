# macOS 桌面小组件

支持 macOS 14 及以上。提供小号「单股关注」、中号「自选速览」、大号「持仓概览」。
单股展示最新价、原始涨跌额、涨跌幅；自选速览按主程序中的分组和手动顺序展示前三只股票；
持仓概览使用主程序全部账户的人民币汇率和收益口径，金额默认隐藏。

## 构建与签名

- 完整 Xcode（包含 macOS SDK 和 `appintentsmetadataprocessor`）。
- Node.js 的 Node-API C 头文件，自动查找 Node 安装目录及 Homebrew 目录。
  自定义安装可设置 `JIANZHANG_NODE_INCLUDE` 为包含 `node_api.h` 的目录。
- 有效的开发者签名及可授权的 App Group，用于实际系统加载和跨进程数据共享。
  单纯编译或 ad-hoc 签名不能证明组件可安装、出现在组件库或访问共享容器。

开发者证书通过 `CSC_NAME` 选择；主程序和扩展必须使用同一团队的证书。
推荐设置 `JIANZHANG_WIDGET_TEAM_ID`，共享组自动生成为 `<Team ID>.com.jianzhang.stock`。
也可用 `JIANZHANG_WIDGET_APP_GROUP` 指定已经配置好的共享组；未配置时使用
`group.com.jianzhang.stock`，此名称仍需要相应的授权，不能依靠名称直接访问。
如使用需要描述文件的签名方式，`JIANZHANG_WIDGET_PROVISIONING_PROFILE` 可指定扩展的描述文件。

```bash
export CSC_NAME='Developer ID Application: YOUR NAME (TEAM_ID)'
export JIANZHANG_WIDGET_TEAM_ID='YOUR_TEAM_ID'
npm run package:mac
```

`package:mac` 的 `afterPack` 钩子按目标架构编译扩展和 Node-API 桥接，提取 App Intents 元数据，
将扩展置于 `Contents/PlugIns/JianZhangWidgets.appex`，将桥接置于
`Contents/Resources/macos-widgets/jianzhang-widget.node`。扩展单独签名并保留沙箱权限，
随后由 electron-builder 签名主程序。Windows 打包跳过整个原生流程。

只做原生编译与元数据校验，不生成安装包、不打开界面：

```bash
npm run build:mac-widgets
npm run build:mac-widgets -- --arch x64
```

产物位于忽略目录 `build/macos-widgets/<arch>/Contents`。无证书时允许 ad-hoc 编译，构建会明确提示其限制。

## 本机开发签名（个人 Apple 账户）

本机测试可尝试 Apple Development 证书，不必先购买 Developer ID 分发证书。
在 Xcode → Settings → Apple Accounts 登录 Apple 账户，选择 Personal Team → Manage Certificates，
新增 Apple Development。执行 `security find-identity -v -p codesigning`，应出现有效开发签名身份。

如果能找到开发证书和私钥，但有效身份数量仍为零，请检查签发者对应的 Apple WWDR 中间证书。
Apple Development 使用的 G3 公共中间证书可从 Apple PKI 网站取得：
`https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer`。
将正确的中间证书安装到登录钥匙串并保持默认信任，不要把开发证书或中间证书设为“始终信任”。

```bash
npm run package:mac:local
```

命令会读取有效开发身份及其公钥证书，从证书的 Organizational Unit 自动取得真实 Team ID，
配置 `<Team ID>.com.jianzhang.stock` 共享组，并签名主程序、小组件及嵌套二进制。
证书名称末尾括号中的 ID 可能是 Team Member ID，不能直接拿来当 Team ID。
私钥由系统 `codesign` 使用，不会导出；首次使用时如有系统钥匙串授权，请在系统弹窗中处理。

默认只生成当前 Mac 架构的包，文件名带 `-local`，不公证、不上传发布。
该包用于本机开发测试，不作为 Developer ID 正式分发包。
安装时将其替换到“应用程序”目录并重开见涨，再从系统组件库添加组件。
开发证书有有效期，签名后还需要执行下面的手工验收，不能仅凭签名校验判断 UI 和 WidgetKit 实际运行成功。

若有多个开发身份，用 `CSC_NAME` 指定完整名称或 SHA-1 指纹；若设置过
`JIANZHANG_WIDGET_TEAM_ID` 或 `JIANZHANG_WIDGET_APP_GROUP`，它们必须与所选开发证书匹配。
普通 `npm run package:mac` 保持 Developer ID 正式分发路线；不要把 Apple Development 的完整名称直接填入它。

## 数据与刷新

- 扩展只读取 App Group 内的 `snapshot.json`，不读取应用完整配置、交易账本或密钥，也不另行发起行情网络请求。
- 打包后的主程序启动时同步一次，之后合并为每 30 秒更新一次数据快照；退出前保存最后快照和退出标记。
- 最多每 5 分钟请求一次 WidgetKit 时间线重载，退出时再请求一次。系统决定实际更新时机，以上间隔不是显示更新承诺。
- 扩展请求约 15 分钟后的时间线重载；程序完全退出后仅重读最后快照，不会继续取得新行情。
- 图表为最近最多 60 个真实行情样本，每个样本间隔至少 30 秒，按证券市场当地交易日清空。
  图表不代表完整分时图；不足两个样本时显示「待采样」，没有随机或演示曲线。
- `dataAt` 缺失时显示「时间未知」，不能把写入快照或请求成功的时间当作行情时间。
- 复用主程序市场日历，提前规划未来 24 小时开闭市状态；超过计划范围显示「数据较旧」，不沿用过期的开闭市状态。
- 已有有效行情时，闭市状态优先于过期判断；开市后超过两分钟的行情显示「数据较旧」。
- 页脚显示最早一条所展示行情的时间；组合使用全部持仓的行情时间，统一按北京时间展示。
- 持仓缺少价格、人民币换算或收益依据时，组合金额显示「—」并提示数据不完整，不以零或部分合计冒充完整结果。

## 手工验收（由用户执行）

2026-10-27 实现校验：生产构建、ESLint、54 项相关单元测试、12 项 TypeScript → Swift 数据契约检查、
arm64/x64 原生编译、三种 App Intents 元数据、构建钩子目录和 ad-hoc 签名完整性检查通过。
Luna 只读静态复核未发现确定的正确性缺陷。变更文件格式检查通过；全仓格式检查仍报告三个未改动文件
`electron/main/historical-kline-cache.ts`、`electron/main/stock-cache-maintenance-service.ts`、
`src/components/StockCacheDialog.tsx` 的既有格式问题。
上述初次实现校验时尚无有效开发者签名，未执行以下界面、安装或系统加载验收。
2026-10-28 已补充 Apple Development 本机路线：验证普通/沙箱宿主共享容器读写、
真实 Electron 43.1.1 加载桥接，以及沙箱读取 Electron 写入的合成数据。
本机开发签名验证不等同于 WidgetKit 的桌面显示与交互验收，后者仍需按以下步骤手工确认。

18.5.1 本机包补充校验：11 项本机签名单元测试、Luna 只读静态复核、生产构建、ESLint、
变更文件格式检查通过；已实际生成并挂载带 `-local` 后缀的 arm64 DMG，验证主程序/扩展的
开发签名、共享组一致、三种 App Intents 元数据、Applications 链接和 Finder 布局数据，
并从 DMG 内以无界面模式运行 Electron 验证真实桥接读写。未自动替换已安装应用或执行桌面 UI 验收。

1. 安装签名后的应用并启动一次，在桌面右键「编辑小组件」，搜索「见涨」，确认三种组件均可添加。
2. 小号编辑选择股票；确认最新价、涨跌额、涨跌幅与主程序一致，负数绿色、正数红色、零值中性。
3. 中号选择重点关注、全部自选或自定义分组，确认前三只股票和顺序正确；可添加多个实例选不同分组。
4. 点击小号及中、大号的各股票行，确认主窗口定位对应股票；退出程序后点击也可启动并定位。
5. 删除当前组件选择的股票，组件应提示重新选择，不静默切换成另一只股票。
6. 大号默认隐藏金额，编辑组件开启「显示持仓金额」后，确认与主程序的人民币收益和市值一致。
7. 在休市、午休、开市、断网或旧行情下确认状态及行情日期。退出应用后保留快照，不出现虚假实时状态。
8. 检查浅色、深色及系统单色外观。单色下正负号仍能区分涨跌，所有辅助文字不低于 12pt。
9. 等待至少两个有效样本后检查走势图；重新打开应用、跨交易日及缺失时间时检查采样连续性。
10. 升级应用后检查组件保留、配置保留及共享快照继续更新；分别确认 Apple Silicon 和 Intel 安装包。

## 故障定位

- 组件库找不到组件：先检查安装路径、扩展签名、最低系统版本及 `Metadata.appintents` 是否随包存在。
- 应用日志出现 `[desktop-widget]` 容器权限错误：检查主程序和扩展的签名团队、App Group 和描述文件是否一致。
- 开发模式没有共享数据：`npm run dev` 使用 Electron 开发宿主，未启用已打包应用的共享桥接；请使用签名后的安装版验收。
- 不要将 `codesign --verify` 成功、原生编译成功或已有 Node-API 导出，视为系统组件库验收成功。
