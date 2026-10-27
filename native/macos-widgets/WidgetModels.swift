import AppIntents
import Foundation
import WidgetKit

struct PriceSample: Codable {
  let time: Double
  let price: Double
}

struct WidgetStock: Codable, Identifiable {
  let id: String
  let code: String
  let name: String
  let market: String
  let currency: String
  let groupIds: [String]
  let priority: Bool
  let holding: Bool
  let latest: Double?
  let change: Double?
  let changePercent: Double?
  let dataAt: Double?
  let status: String
  let history: [PriceSample]

  var url: URL {
    URL(
      string:
        "jianzhang://widget/stock/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? "")"
    )!
  }
}

struct WidgetGroup: Codable {
  let id: String
  let name: String
}

struct MarketTransition: Codable {
  let at: Double
  let open: Bool
}

struct WidgetPortfolio: Codable {
  let count: Int
  let complete: Bool
  let marketValue: Double?
  let todayProfit: Double?
  let todayProfitPercent: Double?
  let totalProfit: Double?
}

struct WidgetSnapshot: Codable {
  let schemaVersion: Int
  let generatedAt: Double
  let appRunning: Bool
  let marketScheduleAt: Double
  let groups: [WidgetGroup]
  let markets: [String: [MarketTransition]]
  let stocks: [WidgetStock]
  let portfolio: WidgetPortfolio

  static let empty = WidgetSnapshot(
    schemaVersion: 1, generatedAt: 0, appRunning: false, marketScheduleAt: 0, groups: [],
    markets: [:], stocks: [],
    portfolio: WidgetPortfolio(
      count: 0, complete: true, marketValue: nil, todayProfit: nil,
      todayProfitPercent: nil, totalProfit: nil)
  )

  func selected(group: String) -> [WidgetStock] {
    switch group {
    case "all": return stocks
    case "holdings": return stocks.filter(\.holding)
    case "priority": return stocks.filter { $0.priority || $0.holding }
    default: return stocks.filter { $0.groupIds.contains(group) }
    }
  }

  func status(for stock: WidgetStock, at date: Date) -> String {
    guard stock.latest != nil else { return "暂无行情" }
    let time = date.timeIntervalSince1970
    if time >= marketScheduleAt + 24 * 3600 { return "数据较旧" }
    if let open = markets[stock.market]?.last(where: { $0.at <= time })?.open, !open {
      return "休市"
    }
    guard let dataAt = stock.dataAt else { return "时间未知" }
    let age = time - dataAt
    return age < -300 ? "时间未知" : age > 120 ? "数据较旧" : "行情快照"
  }
}

enum WidgetStore {
  static func load() -> WidgetSnapshot {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "JZWidgetAppGroup") as? String,
      let container = FileManager.default.containerURL(
        forSecurityApplicationGroupIdentifier: group),
      let data = try? Data(contentsOf: container.appendingPathComponent("snapshot.json")),
      let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
      snapshot.schemaVersion == 1
    else { return .empty }
    return snapshot
  }
}

struct StockEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "自选股票"
  static var defaultQuery = StockQuery()
  let id: String
  let name: String
  let code: String
  var displayRepresentation: DisplayRepresentation {
    DisplayRepresentation(title: "\(name)", subtitle: "\(code)")
  }
}

struct StockQuery: EntityStringQuery {
  private func entities(_ stocks: [WidgetStock]) -> [StockEntity] {
    stocks.map { StockEntity(id: $0.id, name: $0.name, code: $0.code) }
  }
  func entities(for identifiers: [String]) async throws -> [StockEntity] {
    entities(WidgetStore.load().stocks.filter { identifiers.contains($0.id) })
  }
  func suggestedEntities() async throws -> [StockEntity] { entities(WidgetStore.load().stocks) }
  func entities(matching string: String) async throws -> [StockEntity] {
    entities(
      WidgetStore.load().stocks.filter {
        $0.name.localizedCaseInsensitiveContains(string) || $0.code.contains(string)
      })
  }
  func defaultResult() async -> StockEntity? {
    let stocks = WidgetStore.load().stocks
    return entities(stocks.filter { $0.priority || $0.holding }).first ?? entities(stocks).first
  }
}

struct GroupEntity: AppEntity {
  static var typeDisplayRepresentation: TypeDisplayRepresentation = "自选分组"
  static var defaultQuery = GroupQuery()
  let id: String
  let name: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct GroupQuery: EntityQuery {
  func suggestedEntities() async throws -> [GroupEntity] {
    [
      GroupEntity(id: "priority", name: "重点关注"), GroupEntity(id: "all", name: "全部自选"),
      GroupEntity(id: "holdings", name: "持仓"),
    ]
      + WidgetStore.load().groups
      .filter { $0.id != "portfolio-holdings" }
      .map { GroupEntity(id: $0.id, name: $0.name) }
  }
  func entities(for identifiers: [String]) async throws -> [GroupEntity] {
    try await suggestedEntities().filter { identifiers.contains($0.id) }
  }
  func defaultResult() async -> GroupEntity? { GroupEntity(id: "priority", name: "重点关注") }
}

struct SingleStockIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "单股关注"
  static var description = IntentDescription("选择一只自选股，查看价格、涨跌额和涨跌幅。")
  @Parameter(title: "股票") var stock: StockEntity?
}

struct WatchlistIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "自选速览"
  static var description = IntentDescription("选择要显示的自选分组。")
  @Parameter(title: "分组") var group: GroupEntity?
}

struct PortfolioIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "持仓概览"
  static var description = IntentDescription("显示人民币口径的全部持仓概览。金额默认隐藏。")
  @Parameter(title: "显示持仓金额", default: false) var showAmounts: Bool
}

struct SnapshotEntry: TimelineEntry {
  let date: Date
  let snapshot: WidgetSnapshot
  let stocks: [WidgetStock]
  let title: String
  var showAmounts = false
}

func widgetTimeline(_ entry: SnapshotEntry) -> Timeline<SnapshotEntry> {
  let now = entry.date.timeIntervalSince1970
  var dates = Set(entry.snapshot.markets.values.flatMap { $0.map(\.at) })
  dates.formUnion(entry.stocks.compactMap { $0.dataAt.map { $0 + 121 } })
  // Plan status transitions even if Electron has exited; keep the quote time intact.
  let future = dates.filter { $0 > now && $0 <= now + 24 * 3600 }.sorted().map { time in
    SnapshotEntry(
      date: Date(timeIntervalSince1970: time), snapshot: entry.snapshot,
      stocks: entry.stocks, title: entry.title, showAmounts: entry.showAmounts)
  }
  return Timeline(entries: [entry] + future, policy: .after(entry.date.addingTimeInterval(15 * 60)))
}

struct SingleStockProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> SnapshotEntry {
    SnapshotEntry(date: .now, snapshot: .empty, stocks: [], title: "单股关注")
  }
  func snapshot(for configuration: SingleStockIntent, in context: Context) async -> SnapshotEntry {
    let data = WidgetStore.load()
    let selected: [WidgetStock]
    if let id = configuration.stock?.id {
      selected = data.stocks.filter { $0.id == id }
    } else {
      selected = Array(
        (data.selected(group: "priority").isEmpty ? data.stocks : data.selected(group: "priority"))
          .prefix(1))
    }
    return SnapshotEntry(date: .now, snapshot: data, stocks: selected, title: "单股关注")
  }
  func timeline(for configuration: SingleStockIntent, in context: Context) async -> Timeline<
    SnapshotEntry
  > {
    widgetTimeline(await snapshot(for: configuration, in: context))
  }
}

struct WatchlistProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> SnapshotEntry {
    SnapshotEntry(date: .now, snapshot: .empty, stocks: [], title: "重点关注")
  }
  func snapshot(for configuration: WatchlistIntent, in context: Context) async -> SnapshotEntry {
    let data = WidgetStore.load()
    return SnapshotEntry(
      date: .now, snapshot: data,
      stocks: Array(data.selected(group: configuration.group?.id ?? "priority").prefix(3)),
      title: configuration.group?.name ?? "重点关注")
  }
  func timeline(for configuration: WatchlistIntent, in context: Context) async -> Timeline<
    SnapshotEntry
  > {
    widgetTimeline(await snapshot(for: configuration, in: context))
  }
}

struct PortfolioProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> SnapshotEntry {
    SnapshotEntry(date: .now, snapshot: .empty, stocks: [], title: "持仓概览")
  }
  func snapshot(for configuration: PortfolioIntent, in context: Context) async -> SnapshotEntry {
    let data = WidgetStore.load()
    return SnapshotEntry(
      date: .now, snapshot: data, stocks: Array(data.selected(group: "holdings").prefix(3)),
      title: "持仓概览", showAmounts: configuration.showAmounts)
  }
  func timeline(for configuration: PortfolioIntent, in context: Context) async -> Timeline<
    SnapshotEntry
  > {
    widgetTimeline(await snapshot(for: configuration, in: context))
  }
}
