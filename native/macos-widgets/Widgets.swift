import SwiftUI
import WidgetKit

private let appURL = URL(string: "jianzhang://widget")!

private func formatted(_ value: Double?, percent: Bool = false, signed: Bool = false) -> String {
  guard let value, value.isFinite else { return "—" }
  let formatter = NumberFormatter()
  formatter.locale = Locale(identifier: "zh_CN")
  formatter.numberStyle = .decimal
  formatter.minimumFractionDigits = 2
  formatter.maximumFractionDigits = 2
  formatter.usesGroupingSeparator = true
  let text = formatter.string(from: NSNumber(value: abs(value))) ?? "—"
  let prefix = value < 0 ? "−" : signed && value > 0 ? "+" : ""
  return prefix + text + (percent ? "%" : "")
}

private struct PriceChart: View {
  let samples: [PriceSample]
  let color: Color
  var body: some View {
    if samples.count >= 2 {
      GeometryReader { geometry in
        let prices = samples.map(\.price)
        let low = prices.min() ?? 0
        let high = prices.max() ?? 0
        let span = max(high - low, 0.01)
        Path { path in
          for (index, price) in prices.enumerated() {
            let x = geometry.size.width * Double(index) / Double(prices.count - 1)
            let y =
              high == low
              ? geometry.size.height / 2
              : 2 + (geometry.size.height - 4) * (1 - (price - low) / span)
            if index == 0 {
              path.move(to: CGPoint(x: x, y: y))
            } else {
              path.addLine(to: CGPoint(x: x, y: y))
            }
          }
        }.stroke(color, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
      }
      .accessibilityLabel("近期真实行情采样走势")
    } else {
      Text("待采样").font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
    }
  }
}

private struct WidgetContent: View {
  let entry: SnapshotEntry
  let mode: String
  @Environment(\.colorScheme) private var colorScheme
  @Environment(\.widgetRenderingMode) private var renderingMode

  private func color(_ value: Double?) -> Color {
    // Desktop widgets may be rendered monochromatically; signs stay visible.
    guard renderingMode == .fullColor, let value, value != 0 else { return .primary }
    if value > 0 {
      return colorScheme == .dark
        ? Color(red: 1, green: 0.42, blue: 0.46) : Color(red: 0.79, green: 0.15, blue: 0.20)
    }
    return colorScheme == .dark
      ? Color(red: 0.32, green: 0.83, blue: 0.62) : Color(red: 0.03, green: 0.49, blue: 0.34)
  }

  private var status: String {
    let stocks = mode == "portfolio" ? entry.snapshot.stocks.filter(\.holding) : entry.stocks
    let statuses = stocks.map { entry.snapshot.status(for: $0, at: entry.date) }
    if statuses.contains("暂无行情") { return "暂无行情" }
    if statuses.contains("数据较旧") { return "数据较旧" }
    if statuses.contains("时间未知") { return "时间未知" }
    if !statuses.isEmpty && statuses.allSatisfy({ $0 == "休市" }) { return "休市" }
    return "行情快照"
  }

  private var timeLabel: String {
    let stocks = mode == "portfolio" ? entry.snapshot.stocks.filter(\.holding) : entry.stocks
    let times = stocks.compactMap(\.dataAt)
    guard times.count == stocks.count, let oldest = times.min() else { return "行情时间未知" }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "zh_CN")
    formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
    formatter.dateFormat = "MM/dd HH:mm"
    return formatter.string(from: Date(timeIntervalSince1970: oldest))
  }

  private var header: some View {
    HStack(spacing: 6) {
      Text("见涨").fontWeight(.semibold)
      if mode != "single" { Text(entry.title).foregroundStyle(.secondary).lineLimit(1) }
      Spacer(minLength: 4)
      if !entry.stocks.isEmpty { Text(status).foregroundStyle(.secondary) }
    }.font(.system(size: 12))
  }

  private var footer: some View {
    HStack(spacing: 4) {
      Text(timeLabel)
      Spacer(minLength: 2)
      if mode != "single" {
        Text(entry.snapshot.appRunning ? "行情快照" : "应用已退出")
      }
    }.font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
  }

  private func row(_ stock: WidgetStock, chart: Bool) -> some View {
    Link(destination: stock.url) {
      HStack(spacing: 8) {
        VStack(alignment: .leading, spacing: 0) {
          Text(stock.name).font(.system(size: 13, weight: .medium)).lineLimit(1)
          Text(stock.code).font(.system(size: 12)).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading)
        if chart {
          PriceChart(samples: stock.history, color: color(stock.change)).frame(
            width: 40, height: 24)
        }
        Text(formatted(stock.latest)).font(.system(size: 14, weight: .medium)).lineLimit(1)
        Text(formatted(stock.changePercent, percent: true, signed: true))
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(color(stock.changePercent))
          .padding(.horizontal, 5).padding(.vertical, 4)
          .background(
            color(stock.changePercent).opacity(0.09), in: RoundedRectangle(cornerRadius: 5)
          )
          .frame(minWidth: 61, alignment: .trailing)
      }.monospacedDigit().foregroundStyle(.primary)
    }.buttonStyle(.plain)
  }

  private var empty: some View {
    Link(destination: appURL) {
      VStack(spacing: 8) {
        Image(systemName: mode == "portfolio" ? "wallet.bifold" : "chart.line.uptrend.xyaxis").font(
          .system(size: 22))
        Text(
          entry.snapshot.generatedAt == 0 ? "打开见涨以同步数据" : mode == "portfolio" ? "暂无持仓" : "请选择自选股票"
        )
        .font(.system(size: 13, weight: .medium)).multilineTextAlignment(.center)
        Text("点击打开见涨").font(.system(size: 12)).foregroundStyle(.secondary)
      }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }.buttonStyle(.plain)
  }

  private var single: some View {
    VStack(alignment: .leading, spacing: 4) {
      if let stock = entry.stocks.first {
        HStack(spacing: 5) {
          Text(stock.name).font(.system(size: 13, weight: .medium)).lineLimit(1)
          Text(stock.code).font(.system(size: 12)).foregroundStyle(.secondary)
        }
        Text(formatted(stock.latest)).font(.system(size: 27, weight: .semibold))
          .minimumScaleFactor(0.6).lineLimit(1).monospacedDigit()
        HStack(spacing: 6) {
          Text(formatted(stock.change, signed: true))
          Spacer(minLength: 0)
          Text(formatted(stock.changePercent, percent: true, signed: true))
        }.font(.system(size: 13)).foregroundStyle(color(stock.change)).monospacedDigit()
        PriceChart(samples: stock.history, color: color(stock.change)).frame(maxHeight: .infinity)
        Text(timeLabel).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
      }
    }.widgetURL(entry.stocks.first?.url ?? appURL)
  }

  private func amount(_ value: Double?, signed: Bool = false) -> String {
    entry.showAmounts ? formatted(value, signed: signed) : "••••••"
  }

  private var portfolio: some View {
    VStack(alignment: .leading, spacing: 8) {
      let value = entry.snapshot.portfolio
      Link(destination: appURL) {
        VStack(alignment: .leading, spacing: 3) {
          Text("今日收益 · 人民币").font(.system(size: 12)).foregroundStyle(.secondary)
          Text(amount(value.todayProfit, signed: true))
            .font(.system(size: 28, weight: .semibold)).monospacedDigit()
            .foregroundStyle(entry.showAmounts ? color(value.todayProfit) : .primary)
            .privacySensitive().lineLimit(1).minimumScaleFactor(0.6)
          HStack {
            Text(formatted(value.todayProfitPercent, percent: true, signed: true)).foregroundStyle(
              color(value.todayProfitPercent))
            Text("全部账户").foregroundStyle(.secondary)
          }.font(.system(size: 12)).monospacedDigit()
          HStack {
            VStack(alignment: .leading, spacing: 3) {
              Text("持仓市值").foregroundStyle(.secondary)
              Text(amount(value.marketValue)).monospacedDigit().privacySensitive()
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
              Text("持仓收益").foregroundStyle(.secondary)
              Text(amount(value.totalProfit, signed: true)).monospacedDigit()
                .foregroundStyle(entry.showAmounts ? color(value.totalProfit) : .primary)
                .privacySensitive()
            }
          }.font(.system(size: 12)).padding(.top, 5)
          if !value.complete { Text("持仓数据不完整").font(.system(size: 12)).foregroundStyle(.secondary) }
        }
      }.buttonStyle(.plain)
      Divider()
      HStack {
        Text("持仓关注")
        Spacer()
        Text("\(entry.stocks.count) / \(value.count) 只").foregroundStyle(.secondary)
      }.font(.system(size: 12))
      ForEach(entry.stocks) { stock in row(stock, chart: false) }
      Spacer(minLength: 0)
      footer
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: mode == "single" ? 7 : mode == "watchlist" ? 2 : 8) {
      header
      if entry.stocks.isEmpty {
        empty
      } else if mode == "single" {
        single
      } else if mode == "portfolio" {
        portfolio
      } else {
        ForEach(entry.stocks) { stock in row(stock, chart: true) }
        Spacer(minLength: 0)
        footer
      }
    }
    .containerBackground(for: .widget) { Color(nsColor: .windowBackgroundColor) }
    .widgetURL(mode == "single" ? entry.stocks.first?.url ?? appURL : appURL)
  }
}

struct SingleStockWidget: Widget {
  let kind = "com.jianzhang.stock.widget.single"
  var body: some WidgetConfiguration {
    AppIntentConfiguration(
      kind: kind, intent: SingleStockIntent.self, provider: SingleStockProvider()
    ) {
      WidgetContent(entry: $0, mode: "single")
    }.configurationDisplayName("单股关注")
      .description("查看单只股票的最新价、涨跌额、涨跌幅与近期行情采样。")
      .supportedFamilies([.systemSmall])
  }
}

struct WatchlistWidget: Widget {
  let kind = "com.jianzhang.stock.widget.watchlist"
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: kind, intent: WatchlistIntent.self, provider: WatchlistProvider())
    {
      WidgetContent(entry: $0, mode: "watchlist")
    }.configurationDisplayName("自选速览")
      .description("从自选分组查看三只股票的行情快照。")
      .supportedFamilies([.systemMedium])
  }
}

struct PortfolioWidget: Widget {
  let kind = "com.jianzhang.stock.widget.portfolio"
  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: kind, intent: PortfolioIntent.self, provider: PortfolioProvider())
    {
      WidgetContent(entry: $0, mode: "portfolio")
    }.configurationDisplayName("持仓概览")
      .description("查看人民币口径的持仓与收益，金额默认隐藏。")
      .supportedFamilies([.systemLarge])
  }
}

@main
struct JianZhangWidgets: WidgetBundle {
  var body: some Widget {
    SingleStockWidget()
    WatchlistWidget()
    PortfolioWidget()
  }
}
