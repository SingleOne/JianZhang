# 核心状态分片与 GitHub Gist 备份恢复方案

> 文档状态：方案已落盘，尚未实施
>
> 编写日期：2026-09-08
>
> 代码基线：`main` 分支，`f1bb145`，应用版本 `14.0.0`
>
> 当前实现说明见 [`docs/wiki/05-state-storage-and-ipc.md`](../wiki/05-state-storage-and-ipc.md)。本文描述后续实施方案，不代表现有版本已经具备这些能力。

## 1. 方案结论

核心状态继续以 JSON 为基础，不迁移 SQLite。推荐把当前单体 `settings.json` 改为：

1. 本地磁盘使用一个原子 manifest 管理多个不可变、版本化的 JSON 分片。
2. 主进程加载分片后仍组装成完整 `AppState`，首期不改变 renderer 和业务运行时的数据契约。
3. 自选和偏好按领域拆分；股票追踪档案和交易账户按股票拆分，避免任何一个增长型文件再次成为新的单体状态文件。
4. 保存时只写发生变化的分片，最后原子替换 manifest；manifest 是一次状态提交的唯一生效点。
5. 本地历史快照只保存 manifest，并保留被当前状态、最近可用状态和历史 manifest 引用的分片。
6. 本地导出和 GitHub Gist 继续使用一个完整的逻辑用户数据备份，不把本地 manifest 或分片结构暴露为远端协议。
7. Gist 保持单个 `jianzhang-user-data.json`，在加密前增加 gzip 压缩，同时继续兼容现有未压缩的加密备份。
8. Gist 恢复、模块文件替换、AI API Key 替换、本地状态提交、同步基线更新和重启调度由主进程作为一个协调流程完成。

不推荐直接覆盖多个固定文件。多个文件之间没有共同提交点时，进程退出或磁盘写入失败可能留下“新自选 + 旧账本”之类的混合状态。

## 2. 调研基线

### 2.1 当前状态规模

2026-09-08 对本机 `%APPDATA%\jianzhang-stock-desktop` 的只读统计如下。统计不输出业务内容、API Key 或同步凭证。

| 项目                     |                        结果 |
| ------------------------ | --------------------------: |
| 当前 `settings.json`     | 1,470,712 字节，约 1.40 MiB |
| 最近一份历史状态快照     | 1,539,566 字节，约 1.47 MiB |
| 自动历史快照             |        20 份，共约 28.3 MiB |
| 当前 JSON 格式化缩进开销 |    542,142 字节，约占 36.9% |

当前 `settings.json` 各顶层字段的紧凑 JSON 大小：

| 字段                    |         大小 |    当前数量 |
| ----------------------- | -----------: | ----------: |
| `stockTrackingProfiles` | 706,716 字节 |   81 个档案 |
| `tTradingAccounts`      | 177,772 字节 |    7 个账户 |
| `watchlist`             |  39,140 字节 |   94 只股票 |
| `settings`              |   4,191 字节 | 17 个设置项 |
| 其余顶层字段            |   不足 1 KiB |           — |

文件名虽然是 `settings.json`，但真正的应用设置只占约 4 KiB。当前膨胀主要来自股票追踪历史和交易数据。

### 2.2 主要增长源

`stockTrackingProfiles` 中：

| 内容              | 紧凑 JSON 大小 |
| ----------------- | -------------: |
| `metricSnapshots` |   624,064 字节 |
| `entries`         |    30,540 字节 |
| `sources`         |    19,273 字节 |

当前共有 1,000 条交易日指标快照。`mergeStockTrackingMetricSnapshots` 按交易日合并，但没有数量或日期保留上限，因此该部分会持续增长。按当前样本估算，81 个档案增加一个交易日的数据约新增 50 KiB 紧凑 JSON；实际增量取决于活跃追踪股票和指标字段数量。

`tTradingAccounts` 中：

| 内容           | 紧凑 JSON 大小 |
| -------------- | -------------: |
| `ledger`       |    98,765 字节 |
| `tradeRecords` |    54,113 字节 |
| `history`      |    19,926 字节 |
| `activeBatch`  |     3,988 字节 |

`tradeRecords` 是从统一账本派生的旧版兼容镜像。后续可以单独审计并移除重复持久化，但不与首次分片迁移同时实施，避免把存储迁移和交易语义迁移耦合在一起。

### 2.3 当前保存、恢复和同步约束

当前能力必须保留：

- renderer 提交完整 `AppState`，主进程 normalize 后保存并广播。
- 全局 `revision` 防止旧 renderer 或旧应用实例覆盖后台更新。
- `settings.last-good.json` 用于正式状态损坏后的恢复。
- 最多保留 20 份、至少间隔 15 分钟的历史状态快照。
- 用户数据恢复先 staging 和校验，再创建恢复前快照；任一步失败时回滚状态、模块文件和 AI API Key。
- 本地导出是一个未加密 JSON；GitHub Gist 上传复用同一份逻辑备份并加密。
- Gist 同步使用 GitHub history version 作为远端同步基线；允许用户在明确确认后覆盖发生变化的远端版本。
- AI API Key 进入用户数据备份；GitHub token、同步密码、Codex 凭证和可重新获取的市场缓存不进入备份。

## 3. 目标与非目标

### 3.1 目标

- 消除单个持续增长的核心状态 JSON。
- 用户修改一只股票的追踪或交易数据时，只重写相关分片。
- 保留全局 revision、normalize、完整状态广播和跨领域一致性。
- 保存中途失败时，旧状态仍可完整加载，不出现跨文件混合版本。
- 让历史快照复用未变化分片，避免保存多份完整状态。
- 旧 `settings.json`、旧本地用户数据备份和旧 Gist 均可迁移或恢复。
- Gist 仍保持单个加密文件，不让本地物理目录成为远端兼容协议。
- 减少 Gist 备份体积，同时不改变本地未加密导出的使用方式。
- 恢复成功前不更新同步基线、不删除可回滚数据、不调度重启。

### 3.2 非目标

- 首期不改用 SQLite。
- 首期不改变 renderer 中的 `AppState` 类型和绝大多数业务保存调用。
- 首期不实现追踪历史按需加载；完整状态仍会进入主进程内存和 Bootstrap IPC。
- 首期不改变交易账本、收益计算、公司行动和提醒语义。
- 首期不移除 `tradeRecords` 兼容镜像。
- 不把行情、K 线、基本面、分红融资、估值、股东和其他可重建缓存加入备份。
- 不在 Gist 中上传本地状态分片、manifest、历史 manifest 或本地恢复快照。

## 4. 三层格式边界

存储拆分后必须区分三种格式：

```text
本地物理存储格式
state/manifest.json + versioned JSON documents
        ↓ 组装并 normalize
便携逻辑备份格式
jianzhang-user-data-backup + 完整 AppState + files[] + aiApiKeys
        ↓ gzip + scrypt + AES-256-GCM
GitHub Gist 加密信封
jianzhang-gist-encrypted-backup
```

### 4.1 本地物理存储格式

只由当前应用主进程理解，可以随应用迁移。它负责增量写入、原子提交、历史和本机损坏恢复。

### 4.2 便携逻辑备份格式

保持一个完整、与物理文件布局无关的用户数据文档。它负责跨机器和跨本地存储版本恢复。

仅实施本地分片时，`jianzhang-user-data-backup` 的 `formatVersion` 不需要升级，因为逻辑 `state: AppState` 没有改变。未来如果便携备份本身改变字段约束，再独立升级其版本，并保留旧版本解析器。

### 4.3 Gist 加密信封

只负责压缩、密钥派生、加密和完整性校验。它不理解 `AppState` 或本地分片。

压缩会改变加密信封，建议把信封 `schemaVersion` 从 1 升为 2；解密端同时支持 v1 和 v2。

## 5. 本地目录结构

推荐目录：

```text
<userData>/
├─ state/
│  ├─ manifest.json
│  ├─ manifest.last-good.json
│  ├─ documents/
│  │  ├─ preferences-r1168.json
│  │  ├─ watchlist-r1168.json
│  │  └─ portfolio-meta-r1164.json
│  ├─ tracking/
│  │  ├─ 1.600000-r1168.json
│  │  ├─ 0.000001-r1160.json
│  │  └─ ...
│  └─ portfolios/
│     ├─ 1.600000-r1167.json
│     └─ ...
├─ state-history/
│  ├─ manifest-<时间>-r1140.json
│  └─ ...
├─ settings.legacy-v1.json
├─ settings.last-good.legacy-v1.json
├─ restore-backups/
└─ 其他现有模块与缓存目录
```

文件名中的股票标识必须使用统一安全编码，manifest 保存业务 `quoteId` 到相对路径的显式映射，加载端不能通过遍历目录推断当前有效实体。

### 5.1 分片边界

| 分片                   | 字段                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `preferences`          | `settings`、`columnOrder`、`columnOrderVersion`             |
| `watchlist`            | `watchlist`、`watchlistGroups`                              |
| `tracking/<quoteId>`   | 单个完整 `StockTrackingProfile`                             |
| `portfolios/<quoteId>` | 单个完整 `TTradingAccount`                                  |
| `portfolio-meta`       | `corporateActionRecords`、`portfolioPerformanceAdjustments` |

使用“一只股票一个追踪档案文件”和“一只股票一个交易账户文件”的原因：

- 当前追踪档案平均约 8.7 KiB，最大约 15 KiB。
- 当前交易账户最大约 58 KiB。
- 用户操作通常只改变一个股票实体。
- 删除档案或账户时只需从新 manifest 移除引用，旧文件仍可被历史状态引用。
- 即使跟踪指标继续增长，也不会重新集中成一个全局 `tracking.json`。

## 6. Manifest 设计

建议结构：

```ts
interface StateDocumentRef {
  path: string
  bytes: number
  sha256: string
}

interface StateManifestV1 {
  format: 'jianzhang-state-manifest'
  formatVersion: 1
  revision: number
  committedAt: string
  documents: {
    preferences: StateDocumentRef
    watchlist: StateDocumentRef
    portfolioMeta: StateDocumentRef
    trackingProfiles: Record<string, StateDocumentRef>
    tradingAccounts: Record<string, StateDocumentRef>
  }
}
```

约束：

- 所有路径都是相对 `state/` 的规范化路径。
- 路径不能包含绝对路径、反斜杠、空段、`.` 或 `..`。
- manifest 引用的文档一经提交后不再原地修改。
- `revision` 是整个逻辑 `AppState` 的版本，不是单个文档版本。
- `sha256` 用于加载时识别损坏、截断或非预期修改；AES-GCM 已负责远端加密信封完整性，远端协议不复用这些本地 hash。
- `committedAt` 是本地核心状态真正提交完成的时间。

manifest 必须足够小，写入时继续使用同目录临时文件和原子重命名。

## 7. 加载流程

### 7.1 正常加载

1. 读取并解析 `state/manifest.json`。
2. 校验 manifest 格式、版本、revision 和所有相对路径。
3. 按 manifest 显式引用读取分片，不扫描目录发现业务数据。
4. 校验每个分片的字节数和 SHA-256。
5. 合并得到完整 `AppState`：
   - revision 来自 manifest；
   - 追踪档案和交易账户按 manifest 的业务 ID 映射组装；
   - 其他字段来自对应领域分片。
6. 对完整状态统一运行现有 normalize。
7. normalize 产生迁移变化时，通过正常保存流程提交一个新 revision。
8. 把组装后的完整状态保存在主进程内存中，并继续通过现有 Bootstrap 和 `state:updated` 返回。

不能在某个账本或追踪分片损坏时静默使用 `{}` 或默认值继续启动。这会把“存储损坏”伪装成“用户删除了数据”。当前 manifest 无效时应整体回退到最近可用 manifest。

### 7.2 最近可用状态恢复

恢复候选顺序：

1. `state/manifest.json`
2. `state/manifest.last-good.json`
3. 按时间倒序寻找最近一个完整可验证的历史 manifest
4. 旧版 `settings.last-good.json`，仅用于首次迁移或迁移回退

当前 manifest 损坏时：

- 保留损坏 manifest 为 `manifest.invalid-<时间>.json`。
- 选择最近一个能完整读取并通过 hash 校验的候选。
- 使用正常保存流程把恢复结果提交成新的当前 manifest。
- 向界面返回一次启动警告，说明恢复来源和损坏文件位置。
- 没有任何完整候选时停止启动，不使用默认状态覆盖用户数据。

### 7.3 加载性能边界

首期一个状态可能引用约 90 个小文件。加载实现优先采用异步并行读取，并限制合理并发，避免 Windows Defender 或机械硬盘下串行打开大量文件造成启动回退。

首期仍会组装完整 `AppState`，因此：

- 可以改善文件可维护性、局部写入和历史空间占用。
- 不保证 Bootstrap IPC 体积或 renderer 内存立即下降。
- 多文件打开也可能抵消单文件 JSON.parse 的收益，必须在用户明确要求运行验证时测量真实启动耗时。

如果后续证明确有必要，再把 `metricSnapshots` 从追踪档案拆成独立历史并增加按需 IPC；该工作属于第二阶段，不与本地格式迁移同时进行。

## 8. 保存与原子提交

### 8.1 正常保存

1. 校验 renderer 携带的全局 revision。
2. 重新读取当前 manifest，比较 revision 和已加载的 manifest 内容，拒绝旧实例覆盖。
3. 对传入完整 `AppState` 运行统一 normalize。
4. 按第 5.1 节拆分为存储文档，并进行稳定序列化。
5. 对比已提交文档：
   - 内容未变化时复用旧 `StateDocumentRef`；
   - 内容变化时写入带新 revision 的不可变文件。
6. 所有新文档写入并校验成功后，把旧当前 manifest 原子写入 `manifest.last-good.json`。
7. 构造 revision + 1 的新 manifest，并最后原子替换 `manifest.json`。
8. manifest 提交成功后更新内存 revision 和已加载 manifest 内容。
9. 广播完整 `state:updated`，继续执行现有刷新调度、任务栏和提醒副作用。
10. 在提交完成后执行历史保留和孤立文件清理。

如果第 7 步前失败，旧 manifest 仍然生效；新写入但未引用的文件是孤立文件，不影响加载。保存失败不能提前修改对外可见 revision。

### 8.2 删除实体

删除追踪档案或交易账户时：

- 新 manifest 移除对应业务 ID 引用。
- 不立即删除旧文档。
- 清理阶段确认该文档不再被当前、last-good 或任何保留历史 manifest 引用后再删除。

这样可以避免删除中途失败导致数据提前丢失，也能保证历史状态仍然完整。

### 8.3 历史快照与清理

- 继续使用最多 20 份、至少间隔 15 分钟的策略。
- 历史文件保存提交前的完整 manifest，不复制所有 JSON 分片。
- 清理时先收集当前 manifest、last-good manifest 和保留历史 manifest 的全部引用。
- 仅删除 `state/` 受管目录内不再被任何 manifest 引用的版本化文档。
- 清理失败不回滚已成功提交的业务状态，可在下次保存或启动时重试。

## 9. 旧 `settings.json` 迁移

### 9.1 触发条件

仅当 `state/manifest.json` 不存在时检查旧文件：

1. 优先读取 `settings.json`。
2. 当前文件无效时尝试 `settings.last-good.json`。
3. 使用现有 `normalizeLoadedState` 语义得到完整状态。

如果 manifest 已存在，它始终是唯一当前状态来源，不能再与旧文件合并。

### 9.2 迁移步骤

1. 读取、解析和 normalize 旧状态。
2. 将旧 revision 作为迁移输入，新 manifest 使用下一 revision。
3. 写入全部初始分片。
4. 写入初始 manifest 和 last-good manifest。
5. 从新 manifest 重新加载并组装状态。
6. 比较除 revision 外的规范化语义，确认迁移前后一致。
7. 成功后把旧文件保留为：
   - `settings.legacy-v1.json`
   - `settings.last-good.legacy-v1.json`
8. 迁移失败时删除未提交的新 manifest，继续保留旧文件并报告错误。

不长期双写旧格式。双写会重新引入整份状态写入，并造成新旧程序分别修改两套状态后的来源冲突。降级到旧应用时只能读取迁移时保留的静态旧副本，不保证包含迁移后的新修改。

## 10. 本地用户数据备份

### 10.1 外部格式保持单一

本地“导出用户数据”继续生成一个未加密 JSON：

```text
JianzhangUserDataBackupDocument
├─ format
├─ formatVersion
├─ applicationVersion
├─ exportedAt
├─ state                 完整逻辑 AppState
├─ files[]               允许备份的模块数据
└─ aiApiKeys             AI API Key
```

禁止把以下本地实现细节放入 `files[]`：

- `state/manifest.json`
- `state/documents/`
- `state/tracking/`
- `state/portfolios/`
- `state-history/`
- `settings.legacy-v1.json`
- `restore-backups/`

导出时由 `StateStore.exportCommittedState()` 返回当前 manifest 对应的完整规范化状态。这样本地备份不会读取 renderer 的乐观状态，也不会包含尚未提交的孤立分片。

### 10.2 本机恢复前快照

`UserDataBackupService` 不应自行猜测状态分片目录。由 `StateStore` 提供：

```ts
interface StateRecoveryPoint {
  id: string
  revision: number
  manifestPath: string
}

createRecoveryPoint(targetDirectory: string): StateRecoveryPoint
restoreRecoveryPoint(point: StateRecoveryPoint): AppState
```

恢复点复制：

- 当前 manifest；
- 当前 manifest 引用的全部分片；
- 必要的存储格式元数据。

恢复点不复制孤立文件和普通历史 manifest。`restore-backups` 仍最多保留 5 份，并继续包含模块文件、恢复清单和 AI 凭证回滚所需信息。

### 10.3 本地更新时间

拆分后不能把所有 `state/` 文件的最大 mtime 当作本地数据更新时间，因为失败提交可能留下更新的孤立文件。

本地更新时间应为：

```text
max(
  state manifest committedAt,
  所有允许进入用户备份的模块文件修改时间,
  AI API Key 凭证修改时间
)
```

## 11. GitHub Gist 上传

### 11.1 远端仍是一个文件

继续使用：

- Secret Gist 描述：`见涨用户数据同步`
- 文件名：`jianzhang-user-data.json`
- 一个 Gist 对应一份完整用户数据备份

不把一个逻辑备份拆成多个 Gist 文件，也不为每个本地分片创建 Gist。GitHub Gist history version 继续表示整份远端备份版本。

### 11.2 上传数据来源

上传请求到达主进程后：

1. 刷新远端 Gist 状态和版本。
2. 按现有规则检查 `lastSynchronizedVersion`，保留用户明确确认后的单次 `overwriteRemote`。
3. 从 `StateStore.exportCommittedState()` 获取当前已提交状态。
4. 收集模块文件和 AI API Key，创建单一逻辑备份。
5. 使用紧凑 JSON 序列化远端明文备份。
6. gzip 压缩。
7. 使用同步密码执行 scrypt + AES-256-GCM。
8. 创建或 PATCH 单个 Gist 文件。
9. GitHub 返回有效 history version 后，才更新 `remoteVersion` 和 `lastSynchronizedVersion`。

上传接口不再需要 renderer 传入完整 `AppState`。renderer 只发出“上传当前已提交用户数据”的命令，避免参数看似生效、主进程实际又使用另一份状态的歧义。

### 11.3 压缩加密信封 v2

推荐结构：

```ts
interface EncryptedGitHubGistBackupV2 {
  format: 'jianzhang-gist-encrypted-backup'
  schemaVersion: 2
  compression: {
    name: 'gzip'
  }
  kdf: {
    name: 'scrypt'
    salt: string
    cost: number
    blockSize: number
    parallelization: number
  }
  cipher: {
    name: 'aes-256-gcm'
    iv: string
    authTag: string
  }
  ciphertext: string
}
```

顺序必须是：

```text
逻辑备份 JSON → UTF-8 → gzip → AES-256-GCM → Base64 → 信封 JSON
```

不能先加密再压缩，因为加密数据基本不可压缩。

当前核心状态 1,470,712 字节，单独 gzip 后为 193,528 字节，约为原始大小的 13.2%；Base64 后预计约 258 KiB。完整 Gist 还包含模块用户数据，实施时应单独记录压缩前后字节数，但日志不得输出备份正文、API Key、同步密码或密文内容。

### 11.4 兼容现有 Gist

解密端按信封版本分支：

- `schemaVersion: 1`：沿用现有“Base64 密文 → AES-GCM 解密 → UTF-8 JSON”。
- `schemaVersion: 2`：“Base64 密文 → AES-GCM 解密 → gzip 解压 → UTF-8 JSON”。

修改同步密码时：

1. 使用旧密码按 v1 或 v2 解密。
2. 得到同一逻辑备份。
3. 使用新密码按 v2 压缩并重新加密。
4. 仅在 Gist PATCH 成功后更新本地密码绑定和同步版本。

现有 Gist API 内容被截断时通过 `raw_url` 下载的逻辑继续保留。

## 12. GitHub Gist 恢复事务

### 12.1 准备阶段

准备阶段不得修改本机用户数据：

1. 刷新并定位 Gist。
2. 保存本次下载的 GitHub history version。
3. 读取完整 Gist 内容；API 内容截断时使用 `raw_url`。
4. 用本机同步密码解密，并按信封版本决定是否解压。
5. 解析 `jianzhang-user-data-backup`。
6. 校验 AppState、允许的模块文件路径、JSON 文件内容和 AI API Key 结构。
7. 生成只包含状态摘要、文件数量和 Key 数量的 `importId`，不把 Key 返回 renderer。
8. renderer 展示覆盖和重启确认。

### 12.2 应用阶段

用户确认后调用一个主进程接口：

```ts
applyGitHubRestore(importId: string, gistVersion: string): Promise<void>
```

主进程按以下顺序执行：

1. 确认 `importId` 仍有效且绑定到同一次下载。
2. 再次读取远端 version；与下载 version 不一致时，在修改本机前终止并要求重新下载。
3. 创建当前状态的 `StateRecoveryPoint`。
4. 快照当前模块文件和 AI API Key。
5. 把待恢复模块文件完整写入 `.restore-staging/<importId>/incoming` 并解析校验 JSON。
6. 替换受管模块文件。
7. 使用目标电脑的 `safeStorage` 重新加密并替换 AI API Key。
8. 调用 `StateStore.saveImported()`：
   - 忽略备份中的旧本地 revision；
   - normalize 完整逻辑状态；
   - 写入新分片；
   - 最后提交新 manifest 和新的本地 revision。
9. 写入恢复清单并清理超过 5 份的旧恢复点。
10. 把下载的 GitHub version 记录为 `lastSynchronizedVersion`。
11. 所有持久化步骤完成后再调度应用重启。

### 12.3 失败回滚

任一步失败时：

1. 恢复旧模块文件。
2. 恢复旧 AI API Key。
3. 通过 `StateStore.restoreRecoveryPoint()` 恢复旧 manifest 和其引用分片。
4. 不更新 `lastSynchronizedVersion`。
5. 不调度重启。
6. 保留足够的失败原因供界面提示，但日志不包含敏感正文。

当前实现由 `config:import:apply` 成功后先安排 300ms 重启，再由 renderer 单独调用 `confirmGitHubGistRestore`。新方案应把“恢复提交、同步基线更新、重启调度”收敛到同一个主进程流程，不能继续依赖这个时间窗口。

## 13. Revision 与版本语义

| 标识                     | 所属层       | 作用                                 | 恢复时处理                                 |
| ------------------------ | ------------ | ------------------------------------ | ------------------------------------------ |
| `manifest.revision`      | 本地物理状态 | renderer、后台运行时和多实例并发控制 | 在目标机器生成新的本地 revision            |
| `applicationVersion`     | 便携备份     | 记录备份来源应用版本                 | 保留为元数据                               |
| `formatVersion`          | 便携备份     | 决定逻辑备份解析器                   | 使用对应兼容解析器                         |
| 加密信封 `schemaVersion` | Gist 加密层  | 决定是否解压及加密参数解析           | v1/v2 分支读取                             |
| GitHub history version   | Gist 远端    | 多设备同步基线和覆盖冲突判断         | 成功恢复后记录为 `lastSynchronizedVersion` |

这些版本不能相互替代。特别是不能把远端备份中的本地 revision 直接写入目标机器，也不能用 manifest revision 判断远端是否被另一台设备更新。

## 14. 实施分期

### 阶段 A：本地存储格式与旧数据迁移

- 定义 manifest 和领域分片类型。
- 实现拆分、组装、hash 校验和引用清理。
- 改造 `StateStore.load/save/saveImported`。
- 实现 legacy `settings.json` 一次性迁移。
- 把 last-good 和 state-history 改为 manifest 语义。
- 继续返回完整 `AppState`，不改业务组件。

### 阶段 B：本地备份与恢复协调

- 增加 `exportCommittedState`、`createRecoveryPoint`、`restoreRecoveryPoint`。
- 更新 `UserDataBackupService`，让外部备份继续保存逻辑 AppState。
- 恢复前快照覆盖当前 manifest 引用闭包。
- `localDataUpdatedAt` 改用 manifest `committedAt` 和受管模块文件时间。

### 阶段 C：GitHub Gist 压缩与原子恢复

- 增加加密信封 v2：gzip 后 AES-256-GCM。
- 保留 v1 解密和旧密码更换兼容。
- 上传只读取主进程已提交状态。
- 合并 Gist 恢复应用、同步基线更新和重启调度。
- 保留远端版本冲突提示和用户明确覆盖能力。

### 阶段 D：可选的逻辑懒加载

只有在真实启动或 IPC 指标证明有必要时再实施：

- 把 `metricSnapshots` 从 Bootstrap 中移出。
- Bootstrap 仅返回追踪档案摘要和最新指标。
- 打开追踪编辑器或 AI 工具分页查询历史。
- 增加领域化保存接口，逐步停止 renderer 提交完整 `AppState`。

阶段 D 不是完成本地文件拆分的前置条件。

## 15. 测试设计

实施时需要补齐以下自动化用例。按照当前项目协作规则，测试是否实际执行由用户另行授权；默认只进行静态检查并明确报告验证边界。

### 15.1 StateStore

- 完整 AppState 拆分再组装后，与 normalize 后原状态语义一致。
- 只修改一个追踪档案时只产生该档案的新文档和新 manifest。
- 未变化文档复用旧引用。
- 写文档失败时旧 manifest 保持生效。
- 写 manifest 失败时旧状态保持生效，孤立文件不参与加载。
- renderer revision 过期时继续拒绝覆盖。
- 相同 revision 的当前 manifest 被外部修改时拒绝保存。
- 缺失、截断或 hash 不匹配的分片触发整体恢复，不使用空对象代替。
- 删除实体后不会因目录中残留旧文件而重新出现。
- 历史 manifest 保留 20 份，引用中的旧文档不会提前清理。

### 15.2 迁移

- 有效旧 `settings.json` 可以迁移。
- 当前旧文件损坏时可以从旧 last-good 迁移。
- 迁移后除 revision 外语义一致。
- 迁移失败时旧文件不被删除或覆盖。
- 已存在新 manifest 时不再读取或合并 legacy 文件。

### 15.3 本地备份与恢复

- 导出文档仍只有一个逻辑 `state`，不包含物理分片。
- 新分片存储可以恢复现有 `jianzhang-user-data-backup` v1。
- 状态提交失败时模块文件和 API Key 回滚。
- 模块文件替换失败时状态 manifest 不变化。
- 恢复点只包含当前 manifest 引用闭包。

### 15.4 GitHub Gist

- v1 加密信封继续可以解密恢复。
- v2 压缩加密往返后逻辑备份完全一致。
- 密码错误、认证标签错误、gzip 损坏和内部 JSON 损坏均不修改本机。
- GitHub API 返回 truncated 内容时继续读取 `raw_url`。
- 下载后远端 version 变化时，恢复在本地修改前终止。
- 本地恢复失败时不同步 `lastSynchronizedVersion`。
- 恢复成功时先写同步基线，再调度重启。
- 未确认覆盖时继续拒绝覆盖变化的远端版本。
- 用户确认覆盖后只对本次上传放行，并更新新的远端基线。
- 更换密码可以把 v1 Gist 升级为 v2。

## 16. 静态检查与验证边界

各阶段实现完成后默认只进行：

```powershell
npx tsc --noEmit --pretty false
npm run lint
npx prettier --check <本阶段变更文件>
git diff --check
```

不主动执行：

- 单元测试或集成测试。
- Electron 运行和界面验证。
- 启动性能基准。
- `npm run build:unpacked`。
- 正式构建或安装包生成。

只有用户明确要求运行验证时，再测量：

- 旧单体状态与新分片状态的加载耗时。
- 分片数量和 Windows 文件打开开销。
- 单一追踪档案、单一账户和偏好保存耗时。
- Bootstrap IPC 体积。
- Gist 压缩前、压缩后和加密 Base64 后体积。
- Gist 上传、下载、恢复和重启全链路。

静态检查不能证明迁移、损坏恢复、多设备冲突、运行时加载或 Gist 网络链路已经验证。

## 17. 验收标准

方案实施完成至少满足：

1. 正常启动不再依赖活动的单体 `settings.json`。
2. 一只股票的数据变化不会重写其他股票的追踪档案或交易账户。
3. manifest 提交前失败时，重启后加载的仍是上一次完整状态。
4. 旧 `settings.json` 只迁移一次，并保留可识别的 legacy 副本。
5. 本地导出仍是一个未加密 JSON，Gist 仍是一个加密文件。
6. 现有 v1 Gist 可以恢复，新上传使用支持 gzip 的 v2 信封。
7. 恢复失败时状态、模块文件、AI API Key 和同步基线全部保持恢复前语义。
8. 恢复成功时先更新 Gist 同步基线，再重启应用。
9. 当前、last-good 和保留历史 manifest 引用的数据不会被清理。
10. 首期不改变交易、收益、提醒、追踪和自选的业务结果。

## 18. 明确暂缓项

- `tradeRecords` 兼容镜像去重。
- 追踪指标保留期限或自动归档策略。
- `metricSnapshots` JSONL 化。
- renderer 领域化 patch 保存。
- Bootstrap 追踪历史懒加载。
- SQLite 或其他数据库迁移。
- 多个 Gist 文件、GitHub Release、仓库备份或增量远端同步。

这些项目可以在本地分片和 Gist 恢复稳定后分别评估，不能作为首次迁移的隐含范围。
