import { FIXED_FEE_CODES } from '../shared/fee-schemes'
import type {
  CnBrokerFeeScheme,
  CnFeeExchange,
  CnFixedFeeRates,
  FeeRoundingMode,
  FixedFeeCode,
  TTradeFees,
  TTradeSide
} from '../shared/types'

interface Decimal {
  numerator: bigint
  denominator: bigint
}
type DecimalInput = number | string
const ZERO: Decimal = { numerator: 0n, denominator: 1n }

function decimal(value: DecimalInput): Decimal {
  const text = String(value).trim()
  if (!text || !Number.isFinite(Number(text)) || Number(text) < 0)
    throw new Error('金额和费率必须为有效的非负数字')
  const [mantissa, exponentText = '0'] = text.toLowerCase().split('e')
  const [whole, fraction = ''] = mantissa.replace(/^\+/, '').split('.')
  const scale = fraction.length - Number(exponentText)
  const coefficient = BigInt(`${whole || '0'}${fraction}`)
  return scale >= 0
    ? { numerator: coefficient, denominator: 10n ** BigInt(scale) }
    : { numerator: coefficient * 10n ** BigInt(-scale), denominator: 1n }
}

function add(a: Decimal, b: Decimal): Decimal {
  return {
    numerator: a.numerator * b.denominator + b.numerator * a.denominator,
    denominator: a.denominator * b.denominator
  }
}
function subtract(a: Decimal, b: Decimal): Decimal {
  return {
    numerator: a.numerator * b.denominator - b.numerator * a.denominator,
    denominator: a.denominator * b.denominator
  }
}
function nonnegative(value: Decimal): Decimal {
  return value.numerator < 0n ? ZERO : value
}
function rateFee(amount: Decimal, rate: number): Decimal {
  const rateValue = decimal(rate)
  return {
    numerator: amount.numerator * rateValue.numerator,
    denominator: amount.denominator * rateValue.denominator * 10_000n
  }
}
function cents(value: Decimal, mode: FeeRoundingMode): bigint {
  const truncated = (value.numerator * 100n) / value.denominator
  const nextDigit = ((value.numerator * 1000n) / value.denominator) % 10n
  const increment = mode === 'half-up' ? nextDigit >= 5n : nextDigit > 0n
  return truncated + (increment ? 1n : 0n)
}

/** 见分进位仅检查第三位小数；更后面的非零位不会触发进位。 */
export function roundFeeAmount(value: DecimalInput, mode: FeeRoundingMode): number {
  return Number(cents(decimal(value), mode)) / 100
}

export interface SchemeTradeFeeResult {
  fees: TTradeFees
  total: number
  minimumTopUp: number
}

export function calculateSchemeTradeFees(
  amountInput: DecimalInput,
  side: TTradeSide,
  scheme: CnBrokerFeeScheme,
  exchange: CnFeeExchange,
  fixedOverrides: Partial<CnFixedFeeRates> = {}
): SchemeTradeFeeResult {
  return calculateCnTradeFees(decimal(amountInput), side, scheme, exchange, fixedOverrides)
}

/** 成交额按十进制价格与数量相乘，避免浮点尾差改变第三位取整结果。 */
export function calculateSchemeExecutionFees(
  price: DecimalInput,
  quantity: DecimalInput,
  side: TTradeSide,
  scheme: CnBrokerFeeScheme,
  exchange: CnFeeExchange,
  fixedOverrides: Partial<CnFixedFeeRates> = {}
): SchemeTradeFeeResult {
  const p = decimal(price)
  const q = decimal(quantity)
  return calculateCnTradeFees(
    { numerator: p.numerator * q.numerator, denominator: p.denominator * q.denominator },
    side,
    scheme,
    exchange,
    fixedOverrides
  )
}

function calculateCnTradeFees(
  amount: Decimal,
  side: TTradeSide,
  scheme: CnBrokerFeeScheme,
  exchange: CnFeeExchange,
  fixedOverrides: Partial<CnFixedFeeRates>
): SchemeTradeFeeResult {
  if (amount.numerator === 0n)
    return {
      fees: { commission: 0, handling: 0, regulatory: 0, transfer: 0, stampDuty: 0 },
      total: 0,
      minimumTopUp: 0
    }
  const rates = { ...scheme.fixedFees, ...fixedOverrides }
  const rule = scheme.commission[exchange]
  const rawFees = Object.fromEntries(
    FIXED_FEE_CODES.map((code) => {
      let fee = code === 'stampDuty' && side === 'buy' ? ZERO : rateFee(amount, rates[code])
      if (code === 'transfer' && rates.transfer > 0 && fee.numerator * 100n < fee.denominator)
        fee = decimal('0.01')
      return [code, fee]
    })
  ) as Record<FixedFeeCode, Decimal>
  const includedRaw = rule.includedFees.reduce((total, code) => add(total, rawFees[code]), ZERO)
  const netCommission = nonnegative(subtract(rateFee(amount, rule.ratePerTenThousand), includedRaw))
  const fixedCents = Object.fromEntries(
    FIXED_FEE_CODES.map((code) => [code, cents(rawFees[code], scheme.roundingMode)])
  ) as Record<FixedFeeCode, bigint>
  let commissionCents = cents(netCommission, scheme.roundingMode)
  const includedCents = rule.includedFees.reduce((total, code) => total + fixedCents[code], 0n)
  const shortfall =
    cents(decimal(rule.minimumCommission), scheme.roundingMode) - commissionCents - includedCents
  const topUp = shortfall > 0n ? shortfall : 0n
  commissionCents += topUp
  return {
    fees: {
      commission: Number(commissionCents) / 100,
      handling: Number(fixedCents.handling) / 100,
      regulatory: Number(fixedCents.regulatory) / 100,
      transfer: Number(fixedCents.transfer) / 100,
      stampDuty: Number(fixedCents.stampDuty) / 100
    },
    total:
      Number(
        commissionCents + FIXED_FEE_CODES.reduce((total, code) => total + fixedCents[code], 0n)
      ) / 100,
    minimumTopUp: Number(topUp) / 100
  }
}
