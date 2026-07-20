# 新闻 Provider 接入门槛

本目录只接收已经确认接口或页面使用条件、抓取频率、标题展示授权和长期链接稳定性的来源。第一版用于用户本机的来源验证；在对外分发前，仍需确认各来源允许标题、时间和深链展示的具体授权范围。

第一版已注册以下 Provider：

- `cninfo-announcement`：A 股公司公告，按来源证券代码关联，只保存巨潮公告 ID、标题、发布时间和原始 PDF 链接。
- `csrc-news`：中国证监会要闻。
- `sse-notice`、`szse-notice`、`bse-notice`：三大交易所通知公告。

单个来源失败不会清空其他来源结果，失败信息会通过模块状态展示。商业财经媒体和聚合库仍需单独确认接口稳定性、原始来源字段与展示授权后才能进入默认发行版。

东方财富、财联社、新浪财经、AKShare 和 Tushare 的评估见 `docs/market-insight-news-source-evaluation.md`。
