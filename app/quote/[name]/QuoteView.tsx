'use client'

import { useState } from 'react'
import {
  type Quote,
  type QuoteOption,
  type LicenseModel,
  effectiveDesignCost,
  assetEffectivePrice,
  perpetualTotal,
  annualFirstYear,
  formatEur,
  formatVariable,
  styleLabel,
  formatQuoteDate,
  fillTokens,
  DEFAULT_FOOTNOTE_ANNUAL,
  DEFAULT_FOOTNOTE_PERPETUAL,
} from '@/lib/quote'

function headline(model: LicenseModel, d: number): string {
  return model === 'annual'
    ? `${formatEur(annualFirstYear(d))} first year`
    : formatEur(perpetualTotal(d))
}

function OptionBlock({ option }: { option: QuoteOption }) {
  const [model, setModel] = useState<LicenseModel>('annual')
  const [italic, setItalic] = useState<boolean[]>(() => option.assets.map(() => false))
  const setAssetItalic = (i: number, on: boolean) =>
    setItalic((prev) => prev.map((v, j) => (j === i ? on : v)))
  const d = effectiveDesignCost(option, italic)
  const amount = headline(model, d)
  const footnote = fillTokens(
    model === 'annual' ? DEFAULT_FOOTNOTE_ANNUAL : DEFAULT_FOOTNOTE_PERPETUAL,
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
          <div className="quote-row">
            <div className="quote-col col-asset">
              <p className="quote-colhead">Asset</p>
              <div className="quote-cell">{a.name}</div>
            </div>
            <div className="quote-col">
              <p className="quote-colhead">Variable</p>
              <div className="quote-cell">{formatVariable(a.variable)}</div>
            </div>
            <div className="quote-col">
              <p className="quote-colhead">Price</p>
              <div className="quote-cell">{formatEur(assetEffectivePrice(a, !!italic[i]))}</div>
            </div>
          </div>
          {a.offersItalic && (
            <>
              <p className="quote-subhead">Extras</p>
              <div className="quote-toggle">
                <button
                  type="button"
                  className={`pill${!italic[i] ? ' is-selected' : ''}`}
                  onClick={() => setAssetItalic(i, false)}
                >Oblique</button>
                <button
                  type="button"
                  className={`pill${italic[i] ? ' is-selected' : ''}`}
                  onClick={() => setAssetItalic(i, true)}
                >Italic</button>
              </div>
            </>
          )}
          {a.styles.length > 0 && (
            <>
              <p className="quote-subhead">Styles</p>
              <div className="quote-chips">
                {a.styles.map((s, j) => (
                  <div key={j} className="quote-cell quote-chip">
                    {styleLabel(s, a.offersItalic && italic[i] ? 'Italic' : 'Oblique')}
                  </div>
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
