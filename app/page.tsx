import Feed from './Feed'

// The home feed, also served at /work via a rewrite: every image and
// typeface that isn't hidden, in project order.
export default function Home() {
  return <Feed />
}
