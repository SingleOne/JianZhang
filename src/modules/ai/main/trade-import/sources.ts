import { createHash } from 'node:crypto'
import { extname } from 'node:path'
import ExcelJS from 'exceljs'
import type {
  AiProviderImage,
  AiTradeImportFile,
  AiTradeImportSourceBinding
} from '../../shared/types'

const MAX_FILE_COUNT = 5
const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_TOTAL_BYTES = 24 * 1024 * 1024
const MAX_SOURCE_TEXT_LENGTH = 120_000
const IMAGE_MEDIA_TYPES = new Set<AiProviderImage['mediaType']>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif'
])

export interface PreparedTradeImportSources {
  userContent: string
  images: AiProviderImage[]
  sources: AiTradeImportSourceBinding[]
}

function hash(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function normalizedMediaType(file: AiTradeImportFile): string {
  const declared = file.mediaType.trim().toLowerCase()
  if (declared) return declared
  const extension = extname(file.name).toLowerCase()
  if (extension === '.txt') return 'text/plain'
  if (extension === '.xlsx')
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  return 'application/octet-stream'
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'object') return String(value).trim()
  if ('result' in value && value.result !== undefined) return cellText(value.result)
  if ('richText' in value)
    return value.richText
      .map((part) => part.text)
      .join('')
      .trim()
  if ('text' in value && typeof value.text === 'string') return value.text.trim()
  if ('hyperlink' in value && typeof value.hyperlink === 'string') return value.hyperlink.trim()
  return ''
}

async function workbookText(data: Uint8Array): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  const workbookData = Buffer.from(data) as unknown as Parameters<typeof workbook.xlsx.load>[0]
  await workbook.xlsx.load(workbookData, {
    ignoreNodes: [
      'sheetPr',
      'sheetViews',
      'sheetFormatPr',
      'cols',
      'mergeCells',
      'rowBreaks',
      'hyperlinks',
      'pageMargins',
      'dataValidations',
      'pageSetup',
      'headerFooter',
      'printOptions',
      'picture',
      'drawing',
      'sheetProtection',
      'tableParts',
      'conditionalFormatting',
      'extLst'
    ]
  })
  const lines: string[] = []
  workbook.eachSheet((worksheet) => {
    lines.push(`[工作表：${worksheet.name}]`)
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values: string[] = []
      row.eachCell({ includeEmpty: true }, (cell) => values.push(cellText(cell.value)))
      if (values.some(Boolean)) lines.push(`行 ${rowNumber}: ${values.join('\t')}`)
    })
  })
  const content = lines.join('\n')
  if (content.length > MAX_SOURCE_TEXT_LENGTH) {
    throw new Error('XLSX 内容超过 12 万字符，请拆分后再导入')
  }
  return content
}

function decodeText(data: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(data).replace(/^\uFEFF/, '')
  return utf8.includes('\uFFFD')
    ? new TextDecoder('gb18030').decode(data).replace(/^\uFEFF/, '')
    : utf8
}

export async function prepareTradeImportSources(input: {
  text?: string
  files?: AiTradeImportFile[]
}): Promise<PreparedTradeImportSources> {
  const text = input.text?.trim() ?? ''
  const files = input.files ?? []
  if (!text && files.length === 0) throw new Error('请粘贴交易记录或选择文件')
  if (text.length > MAX_SOURCE_TEXT_LENGTH) throw new Error('粘贴文字不能超过 12 万字符')
  if (files.length > MAX_FILE_COUNT) throw new Error(`一次最多导入 ${MAX_FILE_COUNT} 个文件`)
  if (files.some((file) => file.data.byteLength > MAX_FILE_BYTES)) {
    throw new Error('单个文件不能超过 12 MB')
  }
  if (files.reduce((total, file) => total + file.data.byteLength, 0) > MAX_TOTAL_BYTES) {
    throw new Error('一次导入的文件总大小不能超过 24 MB')
  }

  const sources: AiTradeImportSourceBinding[] = []
  const textSections: string[] = []
  const images: AiProviderImage[] = []

  if (text) {
    const source = {
      id: 'source-text',
      name: '粘贴文字',
      kind: 'text' as const,
      hash: hash(text)
    }
    sources.push(source)
    textSections.push(`[来源 ${source.id}：${source.name}]\n${text}`)
  }

  for (const [index, file] of files.entries()) {
    const mediaType = normalizedMediaType(file)
    const sourceId = `source-file-${index + 1}`
    const sourceHash = hash(file.data)
    const extension = extname(file.name).toLowerCase()
    if (mediaType === 'text/plain' || extension === '.txt') {
      sources.push({ id: sourceId, name: file.name, kind: 'txt', hash: sourceHash })
      const content = decodeText(file.data)
      if (content.length > MAX_SOURCE_TEXT_LENGTH) {
        throw new Error(`TXT 文件“${file.name}”内容过多，请拆分后再导入`)
      }
      textSections.push(`[来源 ${sourceId}：${file.name}]\n${content}`)
      continue
    }
    if (
      mediaType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      extension === '.xlsx'
    ) {
      sources.push({ id: sourceId, name: file.name, kind: 'xlsx', hash: sourceHash })
      textSections.push(`[来源 ${sourceId}：${file.name}]\n${await workbookText(file.data)}`)
      continue
    }
    if (IMAGE_MEDIA_TYPES.has(mediaType as AiProviderImage['mediaType'])) {
      sources.push({ id: sourceId, name: file.name, kind: 'image', hash: sourceHash })
      textSections.push(
        `[图片来源 ${sourceId}：${file.name}，对应随后第 ${images.length + 1} 张图片]`
      )
      images.push({
        mediaType: mediaType as AiProviderImage['mediaType'],
        data: Buffer.from(file.data).toString('base64')
      })
      continue
    }
    throw new Error(`不支持文件“${file.name}”，请选择 TXT、XLSX 或常见图片格式`)
  }

  const userContent = textSections.join('\n\n')
  if (userContent.length > MAX_SOURCE_TEXT_LENGTH) {
    throw new Error('本次导入内容超过 12 万字符，请减少文件后重试')
  }
  return {
    userContent,
    images,
    sources
  }
}
