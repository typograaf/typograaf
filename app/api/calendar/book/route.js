// POST /api/calendar/book
// Body: { items: [{date: 'YYYY-MM-DD', slot: 'am'|'pm'|'full'}, ...],
//         name, email, street, number, postcode, city, country,
//         location: 'office'|'remote', description, tosAccepted, tosVersion }
// Returns: { ok: true, uids: [...] }

import { requireEnv, brusselsToUtc, fetchEvents, buildEventIcal, putEvent, SLOT_HOURS } from "@/lib/caldav";

export const runtime = "edge";

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json", "cache-control": "no-store" },
});

const MIN_LEAD_DAYS = 2;
const MAX_AHEAD_MONTHS = 4;
const MAX_ITEMS_PER_BOOKING = 30;
const SLOT_TOTAL = { am: 350, pm: 350, full: 600 };

const ANTWERP_POSTCODES = new Set([
  "2000", "2018", "2020", "2030", "2040", "2050", "2060",
  "2100", "2140", "2170", "2180",
  "2600", "2610", "2660",
]);
const ANTWERP_CITY_RE = /\b(antwerp(en)?|anvers|ekeren|merksem|deurne|berchem|borgerhout|wilrijk|hoboken)\b/;

function looksAntwerp({ city, postcode }) {
  const p = (postcode || "").trim();
  if (ANTWERP_POSTCODES.has(p)) return true;
  const c = (city || "").toLowerCase();
  return ANTWERP_CITY_RE.test(c);
}

export async function POST(request) {
  try {
    const cfg = requireEnv();
    const data = await request.json().catch(() => null);
    if (!data) return json(400, { error: "Invalid JSON body" });

    let { items, name, email, street, number, postcode, city, country, location, description, tosAccepted, tosVersion } = data;
    if (!items && Array.isArray(data.dates) && data.slot) items = data.dates.map((date) => ({ date, slot: data.slot }));
    else if (!items && data.date && data.slot) items = [{ date: data.date, slot: data.slot }];

    if (!Array.isArray(items) || items.length === 0) return json(400, { error: "At least one booking item required" });
    if (items.length > MAX_ITEMS_PER_BOOKING) return json(400, { error: `Too many items (max ${MAX_ITEMS_PER_BOOKING})` });

    const byDate = new Map();
    for (const it of items) {
      if (!it || typeof it.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(it.date)) return json(400, { error: `Bad date: ${it && it.date}` });
      if (!["am", "pm", "full"].includes(it.slot)) return json(400, { error: `Bad slot for ${it.date}: ${it.slot}` });
      byDate.set(it.date, it.slot);
    }
    items = Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, slot]) => ({ date, slot }));

    if (typeof name !== "string" || name.trim().length < 2) return json(400, { error: "Name required" });
    if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email.trim())) return json(400, { error: "Valid email required" });
    if (typeof description !== "string" || description.trim().length < 5) return json(400, { error: "Description required" });
    for (const [k, v] of [["street", street], ["number", number], ["postcode", postcode], ["city", city], ["country", country]]) {
      if (typeof v !== "string" || v.trim().length < 1) return json(400, { error: `${k[0].toUpperCase()}${k.slice(1)} required` });
    }
    if (location !== "office" && location !== "remote") return json(400, { error: "Pick a session location" });

    const cleanStreet = street.trim().slice(0, 200);
    const cleanNumber = number.trim().slice(0, 50);
    const cleanPostcode = postcode.trim().slice(0, 20);
    const cleanCity = city.trim().slice(0, 100);
    const cleanCountry = country.trim().slice(0, 100);
    const fullAddress = `${cleanStreet} ${cleanNumber}, ${cleanPostcode} ${cleanCity}, ${cleanCountry}`;

    if (location === "office" && !looksAntwerp({ city: cleanCity, postcode: cleanPostcode })) {
      return json(400, { error: "On-site is only available if your office is in Antwerp" });
    }
    if (tosAccepted !== true) return json(400, { error: "You must accept the terms & conditions" });
    const tosLine = `T&C accepted (${typeof tosVersion === "string" ? tosVersion : "unknown version"}) at ${new Date().toISOString()}`;
    const locLabel = location === "office" ? "At client's office (on-site)" : "Remote — video call";
    const calendarLocation = location === "office" ? fullAddress : "Remote (video call)";

    const cleanName = name.trim().slice(0, 200);
    const cleanEmail = email.trim().slice(0, 200);
    const cleanDesc = description.trim().slice(0, 5000);

    const todayBrussels = new Date(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date()));
    const earliestMs = todayBrussels.getTime() + MIN_LEAD_DAYS * 86400000;
    const latest = new Date(todayBrussels);
    latest.setMonth(latest.getMonth() + MAX_AHEAD_MONTHS);

    for (const { date } of items) {
      const [y, m, d] = date.split("-").map(Number);
      const reqMs = Date.UTC(y, m - 1, d);
      if (reqMs < earliestMs) return json(400, { error: `${date}: too soon (min 2 days notice)` });
      if (reqMs > latest.getTime()) return json(400, { error: `${date}: too far ahead (max 4 months)` });
      const dow = new Date(reqMs).getUTCDay();
      if (dow === 0 || dow === 6) return json(400, { error: `${date}: weekends not bookable` });
    }

    const ranges = items.map(({ date, slot }) => {
      const [y, m, d] = date.split("-").map(Number);
      const { start, end } = SLOT_HOURS[slot];
      return { date, slot, startUtc: brusselsToUtc(y, m, d, start, 0), endUtc: brusselsToUtc(y, m, d, end, 0) };
    });
    const unionStart = ranges[0].startUtc;
    const unionEnd = ranges[ranges.length - 1].endUtc;

    const events = await fetchEvents(cfg, unionStart, unionEnd);
    for (const r of ranges) {
      const sMs = r.startUtc.getTime();
      const eMs = r.endUtc.getTime();
      const hit = events.find((ev) => ev.start.getTime() < eMs && ev.end.getTime() > sMs);
      if (hit) return json(409, { error: `${r.date} (${r.slot}): that slot was just taken. Please pick another.` });
    }

    const groupId = randomHex(6);
    const dtstamp = new Date();
    const uids = [];
    const grandTotal = items.reduce((acc, it) => acc + SLOT_TOTAL[it.slot], 0);

    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      const slotName = { am: "AM", pm: "PM", full: "Full day" }[r.slot];
      const { start: hStart, end: hEnd } = SLOT_HOURS[r.slot];
      const summary = `Booking: ${cleanName} (${slotName})`;
      const descBody = [
        `Booked via typografie.be/calendar`,
        ``,
        `From: ${cleanName} <${cleanEmail}>`,
        `Address: ${fullAddress}`,
        `Where: ${locLabel}`,
        `Slot: ${slotName} (${pad(hStart)}:00–${pad(hEnd)}:00)`,
        `Rate: €${SLOT_TOTAL[r.slot]}`,
        items.length > 1 ? `Group ${groupId}: ${i + 1} of ${items.length} (€${grandTotal} total)` : "",
        tosLine,
        ``,
        `--- Project ---`,
        cleanDesc,
      ].filter(Boolean).join("\n");

      const uid = `booking-${r.date}-${r.slot}-${groupId}@typografie.be`;
      const ical = buildEventIcal({ uid, summary, description: descBody, startUtc: r.startUtc, endUtc: r.endUtc, dtstamp, location: calendarLocation });
      try {
        await putEvent(cfg, uid, ical);
        uids.push(uid);
      } catch (err) {
        console.error("booking event PUT failed", r.date, err);
        return json(207, {
          error: `Partial booking — ${uids.length} of ${ranges.length} events created. Failed on ${r.date} (${r.slot}): ${err.message}.`,
          uids,
        });
      }
    }

    return json(200, { ok: true, uids });
  } catch (err) {
    console.error("booking error", err);
    return json(500, { error: err.message || "Internal error" });
  }
}

function pad(n) { return String(n).padStart(2, "0"); }
function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
