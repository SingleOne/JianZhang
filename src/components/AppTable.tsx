import { Fragment, type ReactNode } from 'react'

export interface AppTableColumn<Row> {
  key: string
  title: string
  width: number
  render: (row: Row, index: number) => ReactNode
}

interface AppTableProps<Row> {
  label: string
  className?: string
  rows: readonly Row[]
  columns: readonly AppTableColumn<Row>[]
  rowKey: (row: Row) => string
  rowClassName?: (row: Row) => string
  renderDetails?: (row: Row) => ReactNode
}

export function AppTable<Row>({
  label,
  className,
  rows,
  columns,
  rowKey,
  rowClassName,
  renderDetails
}: AppTableProps<Row>) {
  return (
    <div className={className} role="region" aria-label={label} tabIndex={0}>
      <table
        aria-label={label}
        style={{ minWidth: columns.reduce((sum, column) => sum + column.width, 0) }}
      >
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={{ width: column.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const details = renderDetails?.(row)
            return (
              <Fragment key={rowKey(row)}>
                <tr className={rowClassName?.(row)}>
                  {columns.map((column) => (
                    <td key={column.key}>{column.render(row, index)}</td>
                  ))}
                </tr>
                {details ? (
                  <tr className={rowClassName?.(row)}>
                    <td colSpan={columns.length}>{details}</td>
                  </tr>
                ) : null}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
