// GET /api/calendar/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns: { busy: [{ date: 'YYYY-MM-DD', slots: ['am'|'pm'] }] }

import { requireEnv, fetchEvents, computeBusyDays, brusselsToUtc } from "@/lib/caldav";

export const runtime = "edge";

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

export async function GET(request) {
  try {
    const cfg = requireEnv();
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return json(400, { error: "from and to must be YYYY-MM-DD" });
    }
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    const fromUtc = brusselsToUtc(fy, fm, fd, 0, 0);
    const toUtc = brusselsToUtc(ty, tm, td, 23, 59);
    const events = await fetchEvents(cfg, fromUtc, toUtc);
    const busy = computeBusyDays(events, from, to);
    return json(200, { busy });
  } catch (err) {
    console.error("availability error", err);
    return json(500, { error: err.message || "Internal error" });
  }
}
