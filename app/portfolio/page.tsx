import Feed from '../Feed'

// A curated selection, picked per image in the admin's Portfolio tab. The
// selection is its own list, independent of the home feed: an image hidden
// there can be on here and vice versa. Same project order as the home feed.
export default function Portfolio() {
  return <Feed set="portfolio" />
}
