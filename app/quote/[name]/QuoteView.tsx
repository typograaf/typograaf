'use client'

import { useState } from 'react'
import {
  type Quote,
  type QuoteOption,
  type LicenseModel,
  designCost,
  annualTotal,
  perpetualUpfront,
  perpetualYearly,
  formatEur,
  formatQuoteDate,
  fillTokens,
} from '@/lib/quote'

function headline(model: LicenseModel, d: number): string {
  return model === 'annual'
    ? `${formatEur(annualTotal(d))} / year`
    : formatEur(perpetualUpfront(d))
}

function OptionBlock({ option }: { option: QuoteOption }) {
  const [model, setModel] = useState<LicenseModel>('annual')
  const d = designCost(option)
  const amount = headline(model, d)
  const footnote = fillTokens(
    model === 'annual' ? option.footnoteAnnual : option.footnotePerpetual,
    d,
  )

  return (
    <section className="quote-option">
      <div className="quote-option-head">
        <div className="quote-option-title">
          <p>{option.title}</p>
          <p>·</p>
          <p>{amount}</p>
        </div>
        {option.description && <p className="quote-desc">{option.description}</p>}
      </div>

      <div className="quote-block">
        <p className="quote-label">License Model</p>
        <div className="quote-toggle">
          <button
            type="button"
            className={`pill${model === 'perpetual' ? ' is-selected' : ''}`}
            onClick={() => setModel('perpetual')}
          >Perpetual</button>
          <button
            type="button"
            className={`pill${model === 'annual' ? ' is-selected' : ''}`}
            onClick={() => setModel('annual')}
          >Annual</button>
        </div>
      </div>

      {option.assets.map((a, i) => (
        <div key={i} className="quote-block">
          <div className="quote-head-row">
            <p>Asset</p>
            <p>Variable</p>
            <p>Price</p>
          </div>
          <div className="quote-row">
            <div className="quote-cell">{a.name}</div>
            <div className="quote-cell">{a.variable}</div>
            <div className="quote-cell">{formatEur(a.price)}</div>
          </div>
          {a.extras.length > 0 && (
            <>
              <p className="quote-subhead">Extras</p>
              <div className="quote-chips">
                {a.extras.map((x, j) => (
                  <div key={j} className="quote-cell quote-chip">{x}</div>
                ))}
              </div>
            </>
          )}
          {a.styles.length > 0 && (
            <>
              <p className="quote-subhead">Styles</p>
              <div className="quote-chips">
                {a.styles.map((s, j) => (
                  <div key={j} className="quote-cell quote-chip">{s}</div>
                ))}
              </div>
            </>
          )}
        </div>
      ))}

      <div className="quote-block">
        <div className="quote-total-row">
          <div className="quote-cell">Total, Excluding Revisions, Excl. VAT</div>
          <div className="quote-cell quote-total-amount">{amount}</div>
        </div>
        {footnote && <p className="quote-foot">{footnote}</p>}
      </div>
    </section>
  )
}

export default function QuoteView({ quote }: { quote: Quote }) {
  return (
    <main className="page">
      <section className="quote-head">
        <p>{quote.project}</p>
        <div className="quote-meta">
          <p>Project Quote</p>
          <p>·</p>
          <p>{formatQuoteDate(quote.date)}</p>
          <p>·</p>
          <p>Valid through {formatQuoteDate(quote.validThrough)}</p>
        </div>
      </section>

      {quote.options.map((o, i) => (
        <OptionBlock key={i} option={o} />
      ))}
    </main>
  )
}
