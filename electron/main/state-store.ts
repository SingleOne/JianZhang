import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { basename, join } from 'node:path'
import {
  WATCHLIST_COLUMN_ORDER_VERSION,
  normalizeAppSettings,
  normalizeCorporateActionRecords,
  normalizePortfolioPerformanceAdjustments,
  normalizeStockTrackingProfiles,
  normalizeTTradingAccounts,
  normalizeWatchlist,
  normalizeWatchlistColumnOrder,
  normalizeWatchlistGroups,
  synchronizeWatchlistGroupMemberships,
  type AppState
} from '../../src/shared/types'
import { atomicWriteFileSync } from './file-storage'

export const STATE_FILE_NAME = 'settings.json'
export const LAST_GOOD_STATE_FILE_NAME = 'settings.last-good.json'
export const LEGACY_STATE_FILE_NAME = 'settings.legacy-v1.json'
export const LEGACY_LAST_GOOD_STATE_FILE_NAME = 'settings.last-good.legacy-v1.json'
export const STATE_DIRECTORY_NAME = 'state'
export const STATE_MANIFEST_FILE_NAME = 'manifest.json'
export const LAST_GOOD_STATE_MANIFEST_FILE_NAME = 'manifest.last-good.json'
export const STATE_HISTORY_DIRECTORY_NAME = 'state-history'

const STATE_MANIFEST_FORMAT = 'jianzhang-state-manifest'
const STATE_MANIFEST_FORMAT_VERSION = 1
const STATE_DOCUMENT_FORMAT = 'jianzhang-state-document'
const STATE_DOCUMENT_FORMAT_VERSION = 1
const STATE_HISTORY_LIMIT = 20
const STATE_HISTORY_MIN_INTERVAL_MILLISECONDS = 15 * 60 * 1000

type StateDocumentKind =
  'preferences' | 'watchlist' | 'portfolio-meta' | 'tracking-profile' | 'trading-account'

interface StateDocumentRef {
  path: string
  bytes: number
  sha256: string
}

export interface StateManifestV1 {
  format: typeof STATE_MANIFEST_FORMAT
  formatVersion: typeof STATE_MANIFEST_FORMAT_VERSION
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

interface StateDocument<T> {
  format: typeof STATE_DOCUMENT_FORMAT
  formatVersion: typeof STATE_DOCUMENT_FORMAT_VERSION
  kind: StateDocumentKind
  id?: string
  value: T
}

type PreferencesState = Pick<AppState, 'settings' | 'columnOrder' | 'columnOrderVersion'>
type WatchlistState = Pick<AppState, 'watchlist' | 'watchlistGroups'>
type PortfolioMetaState = Pick<
  AppState,
  'corporateActionRecords' | 'portfolioPerformanceAdjustments'
>
type StockTrackingProfile = AppState['stockTrackingProfiles'][string]
type TTradingAccount = AppState['tTradingAccounts'][string]

interface LoadedManifestState {
  content: string
  manifest: StateManifestV1
  state: AppState
}

interface LegacyLoadResult {
  state: AppState
  usedLastGood: boolean
  warning?: string
}

export class StateStoreRevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly actualRevision: number
  ) {
    super('磁盘配置已由另一个应用实例更新，已重新加载最新数据，请重试刚才的操作')
    this.name = 'StateStoreRevisionConflictError'
  }
}

export interface StateStoreLoadResult {
  state: AppState
  warning?: string
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function timestamp(now: Date): string {
  return now.toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function invalidLegacyStateFileName(now: Date): string {
  return `settings.invalid-${timestamp(now)}.json`
}

function invalidManifestFileName(now: Date): string {
  return `manifest.invalid-${timestamp(now)}.json`
}

function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isDocumentRef(value: unknown, prefix: string): value is StateDocumentRef {
  if (!isObject(value)) return false
  const path = value.path
  const segments = typeof path === 'string' ? path.split('/') : []
  return (
    typeof path === 'string' &&
    path.startsWith(prefix) &&
    !path.includes('\\') &&
    !path.startsWith('/') &&
    segments.every((segment) => Boolean(segment) && segment !== '.' && segment !== '..') &&
    typeof value.bytes === 'number' &&
    Number.isInteger(value.bytes) &&
    value.bytes >= 0 &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256)
  )
}

function isDocumentRefRecord(
  value: unknown,
  prefix: string
): value is Record<string, StateDocumentRef> {
  return (
    isObject(value) &&
    Object.entries(value).every(
      ([id, reference]) => Boolean(id) && isDocumentRef(reference, prefix)
    )
  )
}

function parseManifest(content: string): StateManifestV1 {
  const value = JSON.parse(content) as unknown
  if (!isObject(value) || !isObject(value.documents)) {
    throw new Error('核心状态 manifest 结构无效')
  }
  if (
    value.format !== STATE_MANIFEST_FORMAT ||
    value.formatVersion !== STATE_MANIFEST_FORMAT_VERSION ||
    typeof value.revision !== 'number' ||
    !Number.isInteger(value.revision) ||
    value.revision < 0 ||
    typeof value.committedAt !== 'string' ||
    !isDocumentRef(value.documents.preferences, 'documents/preferences-') ||
    !isDocumentRef(value.documents.watchlist, 'documents/watchlist-') ||
    !isDocumentRef(value.documents.portfolioMeta, 'documents/portfolio-meta-') ||
    !isDocumentRefRecord(value.documents.trackingProfiles, 'tracking/') ||
    !isDocumentRefRecord(value.documents.tradingAccounts, 'portfolios/')
  ) {
    throw new Error('核心状态 manifest 格式或版本不受支持')
  }
  return value as unknown as StateManifestV1
}

function stateWithoutRevision(state: AppState): Omit<AppState, 'revision'> {
  const { revision: _revision, ...rest } = state
  return rest
}

export class StateStore {
  private readonly legacyStatePath: string
  private readonly legacyLastGoodPath: string
  private readonly stateDirectory: string
  private readonly manifestPath: string
  private readonly lastGoodManifestPath: string
  private revision = 0
  private loadedManifestContent: string | null = null
  private currentManifest: StateManifestV1 | null = null
  private lastHistoryAt = 0

  constructor(
    private readonly directory: string,
    private readonly defaultState: AppState,
    private readonly now: () => Date = () => new Date()
  ) {
    this.legacyStatePath = join(directory, STATE_FILE_NAME)
    this.legacyLastGoodPath = join(directory, LAST_GOOD_STATE_FILE_NAME)
    this.stateDirectory = join(directory, STATE_DIRECTORY_NAME)
    this.manifestPath = join(this.stateDirectory, STATE_MANIFEST_FILE_NAME)
    this.lastGoodManifestPath = join(this.stateDirectory, LAST_GOOD_STATE_MANIFEST_FILE_NAME)
  }

  load(): StateStoreLoadResult {
    if (existsSync(this.manifestPath)) return this.loadCurrentManifest()
    if (existsSync(this.lastGoodManifestPath)) {
      return this.recoverFromInvalidManifest(new Error('当前核心状态 manifest 不存在'))
    }

    // TODO(state-manifest-migration): Remove the legacy settings.json migration after all
    // supported installations have crossed the manifest-based state format.
    if (existsSync(this.legacyStatePath) || existsSync(this.legacyLastGoodPath)) {
      return this.migrateLegacyState()
    }

    const state = structuredClone(this.defaultState)
    this.save(state)
    return { state }
  }

  assertRevision(state: AppState): void {
    if (state.revision === undefined) return
    if (state.revision !== this.revision) {
      throw new Error('数据已在后台更新，请重试刚才的操作')
    }
  }

  normalize(state: AppState): AppState {
    const watchlistGroups = normalizeWatchlistGroups(state.watchlistGroups)
    const stockTrackingProfiles = normalizeStockTrackingProfiles(state.stockTrackingProfiles)
    const watchlist = synchronizeWatchlistGroupMemberships(
      normalizeWatchlist(state.watchlist),
      watchlistGroups,
      stockTrackingProfiles
    )
    return {
      ...state,
      revision: state.revision,
      watchlist,
      watchlistGroups,
      stockTrackingProfiles,
      settings: normalizeAppSettings(state.settings),
      columnOrder: normalizeWatchlistColumnOrder(state.columnOrder),
      columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
      tTradingAccounts: normalizeTTradingAccounts(state.tTradingAccounts),
      corporateActionRecords: normalizeCorporateActionRecords(state.corporateActionRecords),
      portfolioPerformanceAdjustments: normalizePortfolioPerformanceAdjustments(
        state.portfolioPerformanceAdjustments,
        watchlist
      )
    }
  }

  getCommittedAt(): string | undefined {
    if (!existsSync(this.manifestPath)) return undefined
    try {
      return parseManifest(readFileSync(this.manifestPath, 'utf8')).committedAt
    } catch {
      return undefined
    }
  }

  exportCommittedState(): AppState {
    const loaded = this.readManifestState(this.manifestPath)
    return structuredClone(this.normalizeLoadedState(loaded.state))
  }

  createRecoveryPoint(targetDirectory: string): void {
    const loaded = this.readManifestState(this.manifestPath)
    rmSync(targetDirectory, { force: true, recursive: true })
    for (const reference of this.manifestDocumentReferences(loaded.manifest)) {
      atomicWriteFileSync(
        this.stateFilePath(reference.path, targetDirectory),
        readFileSync(this.stateFilePath(reference.path))
      )
    }
    atomicWriteFileSync(join(targetDirectory, STATE_MANIFEST_FILE_NAME), loaded.content)
  }

  restoreRecoveryPoint(sourceDirectory: string): AppState {
    const sourceManifestPath = join(sourceDirectory, STATE_MANIFEST_FILE_NAME)
    const loaded = this.readManifestState(sourceManifestPath, sourceDirectory)
    for (const reference of this.manifestDocumentReferences(loaded.manifest)) {
      atomicWriteFileSync(
        this.stateFilePath(reference.path),
        readFileSync(this.stateFilePath(reference.path, sourceDirectory))
      )
    }
    this.writeAtomically(this.lastGoodManifestPath, loaded.content)
    this.writeAtomically(this.manifestPath, loaded.content)
    this.activateManifest(loaded)

    const normalized = this.normalizeLoadedState(loaded.state)
    if (JSON.stringify(loaded.state) !== JSON.stringify(normalized)) this.save(normalized)
    else {
      try {
        this.cleanupUnreferencedDocuments()
      } catch {
        // Cleanup is best effort; the recovery manifest is already active.
      }
    }
    return normalized
  }

  save(state: AppState): void {
    const previousManifestContent = existsSync(this.manifestPath)
      ? readFileSync(this.manifestPath, 'utf8')
      : null
    const diskRevision = previousManifestContent
      ? this.readManifestRevision(previousManifestContent)
      : undefined
    const diskContentChanged =
      previousManifestContent !== null &&
      this.loadedManifestContent !== null &&
      previousManifestContent !== this.loadedManifestContent
    const diskManifestMissing =
      previousManifestContent === null && this.loadedManifestContent !== null
    if (
      diskManifestMissing ||
      (previousManifestContent !== null &&
        (diskRevision === undefined || diskRevision !== this.revision || diskContentChanged))
    ) {
      throw new StateStoreRevisionConflictError(this.revision, diskRevision ?? 0)
    }

    const previousRevision = state.revision
    const nextRevision = this.revision + 1
    if (previousManifestContent && this.revision > 0) {
      this.saveHistorySnapshot(previousManifestContent)
    }
    const manifest = this.writeStateDocuments(state, nextRevision)
    const manifestContent = JSON.stringify(manifest, null, 2)
    const lastGoodContent = previousManifestContent ?? manifestContent

    try {
      this.writeAtomically(this.lastGoodManifestPath, lastGoodContent)
      this.writeAtomically(this.manifestPath, manifestContent)
    } catch (reason) {
      state.revision = previousRevision
      throw reason
    }

    this.revision = nextRevision
    state.revision = nextRevision
    this.currentManifest = manifest
    this.loadedManifestContent = manifestContent
    try {
      this.cleanupUnreferencedDocuments()
    } catch {
      // Cleanup is best effort; manifest commit already made the new state durable.
    }
  }

  saveImported(state: AppState): AppState {
    const normalized = this.normalize({ ...state, revision: this.revision })
    this.save(normalized)
    return normalized
  }

  private loadCurrentManifest(): StateStoreLoadResult {
    let loaded: LoadedManifestState
    let normalized: AppState

    try {
      loaded = this.readManifestState(this.manifestPath)
      this.activateManifest(loaded)
      normalized = this.normalizeLoadedState(loaded.state)
    } catch (reason) {
      return this.recoverFromInvalidManifest(reason)
    }

    if (JSON.stringify(loaded.state) !== JSON.stringify(normalized)) this.save(normalized)
    else if (!existsSync(this.lastGoodManifestPath)) {
      this.writeAtomically(this.lastGoodManifestPath, loaded.content)
    }
    return { state: normalized }
  }

  private normalizeLoadedState(saved: AppState): AppState {
    const watchlistGroups = normalizeWatchlistGroups(saved.watchlistGroups)
    const stockTrackingProfiles = normalizeStockTrackingProfiles(saved.stockTrackingProfiles)
    const watchlist = synchronizeWatchlistGroupMemberships(
      normalizeWatchlist(saved.watchlist ?? this.defaultState.watchlist),
      watchlistGroups,
      stockTrackingProfiles
    )
    return {
      revision:
        typeof saved.revision === 'number' && Number.isInteger(saved.revision)
          ? Math.max(0, saved.revision)
          : 0,
      watchlist,
      watchlistGroups,
      stockTrackingProfiles,
      settings: normalizeAppSettings(saved.settings),
      columnOrder: normalizeWatchlistColumnOrder(saved.columnOrder),
      columnOrderVersion: WATCHLIST_COLUMN_ORDER_VERSION,
      tTradingAccounts: normalizeTTradingAccounts(saved.tTradingAccounts),
      corporateActionRecords: normalizeCorporateActionRecords(saved.corporateActionRecords),
      portfolioPerformanceAdjustments: normalizePortfolioPerformanceAdjustments(
        saved.portfolioPerformanceAdjustments,
        watchlist
      )
    }
  }

  private writeStateDocuments(state: AppState, revision: number): StateManifestV1 {
    const previous = this.currentManifest?.documents
    const preferences = this.writeDocument(
      'preferences',
      {
        settings: state.settings,
        columnOrder: state.columnOrder,
        columnOrderVersion: state.columnOrderVersion
      } satisfies PreferencesState,
      revision,
      previous?.preferences
    )
    const watchlist = this.writeDocument(
      'watchlist',
      {
        watchlist: state.watchlist,
        watchlistGroups: state.watchlistGroups
      } satisfies WatchlistState,
      revision,
      previous?.watchlist
    )
    const portfolioMeta = this.writeDocument(
      'portfolio-meta',
      {
        corporateActionRecords: state.corporateActionRecords,
        portfolioPerformanceAdjustments: state.portfolioPerformanceAdjustments ?? {}
      } satisfies PortfolioMetaState,
      revision,
      previous?.portfolioMeta
    )
    const trackingProfiles = Object.fromEntries(
      Object.keys(state.stockTrackingProfiles)
        .sort()
        .map((quoteId) => [
          quoteId,
          this.writeDocument(
            'tracking-profile',
            state.stockTrackingProfiles[quoteId],
            revision,
            previous?.trackingProfiles[quoteId],
            quoteId
          )
        ])
    )
    const tradingAccounts = Object.fromEntries(
      Object.keys(state.tTradingAccounts)
        .sort()
        .map((quoteId) => [
          quoteId,
          this.writeDocument(
            'trading-account',
            state.tTradingAccounts[quoteId],
            revision,
            previous?.tradingAccounts[quoteId],
            quoteId
          )
        ])
    )

    return {
      format: STATE_MANIFEST_FORMAT,
      formatVersion: STATE_MANIFEST_FORMAT_VERSION,
      revision,
      committedAt: this.now().toISOString(),
      documents: {
        preferences,
        watchlist,
        portfolioMeta,
        trackingProfiles,
        tradingAccounts
      }
    }
  }

  private writeDocument<T>(
    kind: StateDocumentKind,
    value: T,
    revision: number,
    previous: StateDocumentRef | undefined,
    id?: string
  ): StateDocumentRef {
    const document: StateDocument<T> = {
      format: STATE_DOCUMENT_FORMAT,
      formatVersion: STATE_DOCUMENT_FORMAT_VERSION,
      kind,
      ...(id ? { id } : {}),
      value
    }
    const content = JSON.stringify(document, null, 2)
    const hash = sha256(content)
    const bytes = Buffer.byteLength(content, 'utf8')
    if (previous?.sha256 === hash && previous.bytes === bytes) return previous

    const suffix = `r${revision}-${hash.slice(0, 12)}.json`
    const encodedId = id ? `${encodeURIComponent(id)}-` : ''
    const relativePath =
      kind === 'tracking-profile'
        ? `tracking/${encodedId}${suffix}`
        : kind === 'trading-account'
          ? `portfolios/${encodedId}${suffix}`
          : `documents/${kind}-${suffix}`
    this.writeAtomically(this.stateFilePath(relativePath), content)
    return { path: relativePath, bytes, sha256: hash }
  }

  private readManifestState(path: string, documentRoot = this.stateDirectory): LoadedManifestState {
    const content = readFileSync(path, 'utf8')
    const manifest = parseManifest(content)
    const preferences = this.readDocument<PreferencesState>(
      manifest.documents.preferences,
      'preferences',
      undefined,
      documentRoot
    )
    const watchlist = this.readDocument<WatchlistState>(
      manifest.documents.watchlist,
      'watchlist',
      undefined,
      documentRoot
    )
    const portfolioMeta = this.readDocument<PortfolioMetaState>(
      manifest.documents.portfolioMeta,
      'portfolio-meta',
      undefined,
      documentRoot
    )
    const stockTrackingProfiles = Object.fromEntries(
      Object.entries(manifest.documents.trackingProfiles).map(([quoteId, reference]) => [
        quoteId,
        this.readDocument<StockTrackingProfile>(
          reference,
          'tracking-profile',
          quoteId,
          documentRoot
        )
      ])
    )
    const tTradingAccounts = Object.fromEntries(
      Object.entries(manifest.documents.tradingAccounts).map(([quoteId, reference]) => [
        quoteId,
        this.readDocument<TTradingAccount>(reference, 'trading-account', quoteId, documentRoot)
      ])
    )
    return {
      content,
      manifest,
      state: {
        revision: manifest.revision,
        ...watchlist,
        stockTrackingProfiles,
        ...preferences,
        tTradingAccounts,
        ...portfolioMeta
      }
    }
  }

  private readDocument<T>(
    reference: StateDocumentRef,
    expectedKind: StateDocumentKind,
    expectedId?: string,
    documentRoot = this.stateDirectory
  ): T {
    const path = this.stateFilePath(reference.path, documentRoot)
    const content = readFileSync(path)
    if (content.byteLength !== reference.bytes || sha256(content) !== reference.sha256) {
      throw new Error(`核心状态分片校验失败：${reference.path}`)
    }
    const document = JSON.parse(content.toString('utf8')) as Partial<StateDocument<T>>
    if (
      document.format !== STATE_DOCUMENT_FORMAT ||
      document.formatVersion !== STATE_DOCUMENT_FORMAT_VERSION ||
      document.kind !== expectedKind ||
      document.id !== expectedId ||
      !Object.hasOwn(document, 'value')
    ) {
      throw new Error(`核心状态分片格式无效：${reference.path}`)
    }
    return document.value as T
  }

  private activateManifest(loaded: LoadedManifestState): void {
    this.revision = loaded.manifest.revision
    this.currentManifest = loaded.manifest
    this.loadedManifestContent = loaded.content
  }

  private recoverFromInvalidManifest(reason: unknown): StateStoreLoadResult {
    let invalidPath: string | undefined
    if (existsSync(this.manifestPath)) {
      invalidPath = join(this.stateDirectory, invalidManifestFileName(this.now()))
      copyFileSync(this.manifestPath, invalidPath)
    }

    const candidates = [this.lastGoodManifestPath, ...this.historyManifestPathsDescending()]
    let recovered: LoadedManifestState | undefined

    for (const path of candidates) {
      if (!existsSync(path)) continue
      try {
        const loaded = this.readManifestState(path)
        this.normalizeLoadedState(loaded.state)
        recovered = loaded
        break
      } catch {
        continue
      }
    }

    if (recovered) {
      const normalized = this.normalizeLoadedState(recovered.state)
      this.writeAtomically(this.manifestPath, recovered.content)
      this.activateManifest({ ...recovered, state: normalized })
      this.save(normalized)
      return {
        state: normalized,
        warning: invalidPath
          ? `核心状态读取失败，已从最近可用状态恢复。原 manifest 已保留为 ${basename(invalidPath)}。`
          : '当前核心状态不存在，已从最近可用状态恢复。'
      }
    }

    throw new Error(
      `核心状态读取失败，且没有可用备份${invalidPath ? `。原 manifest 已保留为 ${basename(invalidPath)}` : ''}：${errorMessage(reason)}`,
      { cause: reason }
    )
  }

  // TODO(state-manifest-migration): Remove this method together with the legacy file constants
  // after all supported installations have crossed the manifest-based state format.
  private migrateLegacyState(): StateStoreLoadResult {
    const legacy = this.loadLegacyState()
    const normalized = legacy.state
    const expected = JSON.stringify(stateWithoutRevision(normalized))
    this.revision = normalized.revision ?? 0
    this.currentManifest = null
    this.loadedManifestContent = null
    this.save(normalized)

    const migrated = this.readManifestState(this.manifestPath)
    const actual = JSON.stringify(stateWithoutRevision(this.normalizeLoadedState(migrated.state)))
    if (actual !== expected) {
      rmSync(this.manifestPath, { force: true })
      rmSync(this.lastGoodManifestPath, { force: true })
      throw new Error('旧配置迁移校验失败，已保留原配置文件')
    }

    const archiveWarning = this.archiveLegacyFiles(legacy.usedLastGood)
    return {
      state: normalized,
      warning: [legacy.warning, archiveWarning].filter(Boolean).join('；') || undefined
    }
  }

  private loadLegacyState(): LegacyLoadResult {
    let currentFailure: unknown
    if (existsSync(this.legacyStatePath)) {
      try {
        return {
          state: this.normalizeLoadedState(
            JSON.parse(readFileSync(this.legacyStatePath, 'utf8')) as AppState
          ),
          usedLastGood: false
        }
      } catch (reason) {
        currentFailure = reason
      }
    }
    if (existsSync(this.legacyLastGoodPath)) {
      try {
        return {
          state: this.normalizeLoadedState(
            JSON.parse(readFileSync(this.legacyLastGoodPath, 'utf8')) as AppState
          ),
          usedLastGood: true,
          warning: '旧配置文件读取失败，已从旧版最近备份迁移。'
        }
      } catch (reason) {
        currentFailure ??= reason
      }
    }

    let invalidPath: string | undefined
    if (existsSync(this.legacyStatePath)) {
      invalidPath = join(this.directory, invalidLegacyStateFileName(this.now()))
      copyFileSync(this.legacyStatePath, invalidPath)
    }
    throw new Error(
      `旧配置读取失败，且没有可用备份${invalidPath ? `。原文件已保留为 ${basename(invalidPath)}` : ''}：${errorMessage(currentFailure)}`,
      { cause: currentFailure }
    )
  }

  private archiveLegacyFiles(usedLastGood: boolean): string | undefined {
    try {
      if (existsSync(this.legacyStatePath)) {
        const target = usedLastGood
          ? join(this.directory, invalidLegacyStateFileName(this.now()))
          : join(this.directory, LEGACY_STATE_FILE_NAME)
        if (!existsSync(target)) renameSync(this.legacyStatePath, target)
      }
      if (existsSync(this.legacyLastGoodPath)) {
        const target = join(this.directory, LEGACY_LAST_GOOD_STATE_FILE_NAME)
        if (!existsSync(target)) renameSync(this.legacyLastGoodPath, target)
      }
      return undefined
    } catch (reason) {
      return `核心状态已迁移，但旧配置文件未能重命名：${errorMessage(reason)}`
    }
  }

  private readManifestRevision(content: string): number | undefined {
    try {
      return parseManifest(content).revision
    } catch {
      return undefined
    }
  }

  private writeAtomically(path: string, content: string): void {
    atomicWriteFileSync(path, content)
  }

  private stateFilePath(relativePath: string, root = this.stateDirectory): string {
    return join(root, ...relativePath.split('/'))
  }

  private saveHistorySnapshot(content: string): void {
    const now = this.now()
    if (now.getTime() - this.lastHistoryAt < STATE_HISTORY_MIN_INTERVAL_MILLISECONDS) return
    const historyDirectory = join(this.directory, STATE_HISTORY_DIRECTORY_NAME)
    const historyPath = join(historyDirectory, `manifest-${timestamp(now)}-r${this.revision}.json`)
    atomicWriteFileSync(historyPath, content)
    this.lastHistoryAt = now.getTime()
    const historyFiles = readdirSync(historyDirectory)
      .filter((name) => name.startsWith('manifest-') && name.endsWith('.json'))
      .sort()
    for (const name of historyFiles.slice(0, -STATE_HISTORY_LIMIT)) {
      rmSync(join(historyDirectory, name), { force: true })
    }
  }

  private historyManifestPathsDescending(): string[] {
    const historyDirectory = join(this.directory, STATE_HISTORY_DIRECTORY_NAME)
    if (!existsSync(historyDirectory)) return []
    return readdirSync(historyDirectory)
      .filter((name) => name.startsWith('manifest-') && name.endsWith('.json'))
      .sort()
      .reverse()
      .map((name) => join(historyDirectory, name))
  }

  private cleanupUnreferencedDocuments(): void {
    const referencedPaths = new Set<string>()
    for (const path of [
      this.manifestPath,
      this.lastGoodManifestPath,
      ...this.historyManifestPathsDescending()
    ]) {
      if (!existsSync(path)) continue
      try {
        this.addManifestReferences(parseManifest(readFileSync(path, 'utf8')), referencedPaths)
      } catch {
        continue
      }
    }

    for (const relativeDirectory of ['documents', 'tracking', 'portfolios']) {
      const absoluteDirectory = this.stateFilePath(relativeDirectory)
      if (!existsSync(absoluteDirectory)) continue
      for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue
        const relativePath = `${relativeDirectory}/${entry.name}`
        if (!referencedPaths.has(relativePath)) {
          rmSync(this.stateFilePath(relativePath), { force: true })
        }
      }
    }
  }

  private addManifestReferences(manifest: StateManifestV1, paths: Set<string>): void {
    paths.add(manifest.documents.preferences.path)
    paths.add(manifest.documents.watchlist.path)
    paths.add(manifest.documents.portfolioMeta.path)
    Object.values(manifest.documents.trackingProfiles).forEach((reference) =>
      paths.add(reference.path)
    )
    Object.values(manifest.documents.tradingAccounts).forEach((reference) =>
      paths.add(reference.path)
    )
  }

  private manifestDocumentReferences(manifest: StateManifestV1): StateDocumentRef[] {
    return [
      manifest.documents.preferences,
      manifest.documents.watchlist,
      manifest.documents.portfolioMeta,
      ...Object.values(manifest.documents.trackingProfiles),
      ...Object.values(manifest.documents.tradingAccounts)
    ]
  }
}
