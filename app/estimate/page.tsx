import EstimateCalc from './EstimateCalc'

// Public, self-service typeface pricing calculator. Unlike per-project
// quotes (noindex) this is a marketing tool meant to be found and shared.
export const metadata = {
  title: 'Typeface Estimate — typografie.be',
  description: 'Get an indicative price for a custom typeface: weights, widths, italics, licensing and deadline.',
}

export default function EstimatePage() {
  return <EstimateCalc />
}
