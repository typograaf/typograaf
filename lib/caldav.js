// CalDAV helpers — talks to iCloud over HTTP basic auth + WebDAV REPORT/PUT.
// Used by the booking API routes under app/api/calendar/.

export const TZ = "Europe/Brussels";

// Booking windows (Brussels local time)
export const SLOT_HOURS = {
  am:   { start: 9,  end: 13 },
  pm:   { start: 14, end: 18 },
  full: { start: 9,  end: 18 },
};

// --- env validation -------------------------------------------------------

export function requireEnv() {
  const env = {
    ICLOUD_EMAIL: process.env.ICLOUD_EMAIL,
    ICLOUD_APP_PASSWORD: process.env.ICLOUD_APP_PASSWORD,
    ICLOUD_CALENDAR_URL: process.env.ICLOUD_CALENDAR_URL,
  };
  const missing = Object.keys(env).filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  let url = env.ICLOUD_CALENDAR_URL;
  if (!url.endsWith("/")) url += "/";
  return { email: env.ICLOUD_EMAIL, password: env.ICLOUD_APP_PASSWORD, calendarUrl: url };
}

function authHeader(email, password) {
  return "Basic " + btoa(`${email}:${password}`);
}

// --- timezone -------------------------------------------------------------

// Convert Brussels-local wall time to a UTC Date, accounting for DST.
export function brusselsToUtc(year, month, day, hour, minute = 0) {
  let utc = Date.UTC(year, month - 1, day, hour - 1, minute);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(utc));
  const actualHour = Number(parts.find((p) => p.type === "hour").value);
  if (actualHour !== hour) utc += (hour - actualHour) * 3600 * 1000;
  return new Date(utc);
}

// Format Date for iCal UTC: 20260515T070000Z
export function icalUtc(date) {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

// --- CalDAV REPORT (read events) ------------------------------------------

export async function fetchEvents({ calendarUrl, email, password }, fromUtc, toUtc) {
  const startStr = icalUtc(fromUtc);
  const endStr = icalUtc(toUtc);
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:calendar-data>
      <C:expand start="${startStr}" end="${endStr}"/>
    </C:calendar-data>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${startStr}" end="${endStr}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

  const res = await fetch(calendarUrl, {
    method: "REPORT",
    headers: {
      "Authorization": authHeader(email, password),
      "Depth": "1",
      "Content-Type": "application/xml; charset=utf-8",
    },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`CalDAV REPORT failed: ${res.status} ${res.statusText} — ${txt.slice(0, 300)}`);
  }
  const xml = await res.text();
  const events = parseEventsFromMultistatus(xml);
  if (events.length === 0 && xml.includes("VEVENT")) {
    console.warn("CalDAV REPORT: parsed 0 events but XML contained VEVENT.");
  }
  return events;
}

// iCloud returns <calendar-data> (no namespace prefix) with the iCal
// payload wrapped in <![CDATA[...]]>; other servers prefix with cal:/C:
// and inline-encode entities. Handle both shapes.
function parseEventsFromMultistatus(xml) {
  const events = [];
  const re = /<(?:[A-Za-z][\w-]*:)?calendar-data\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z][\w-]*:)?calendar-data>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    let inner = m[1];
    const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
    inner = cdata ? cdata[1] : decodeXml(inner);
    for (const ev of parseIcalVevents(inner)) events.push(ev);
  }
  return events;
}

function decodeXml(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function parseIcalVevents(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") {
      if (cur && cur.start && cur.end) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const head = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);
    const [name, ...paramParts] = head.split(";");
    const params = {};
    for (const p of paramParts) {
      const [k, v] = p.split("=");
      params[k.toUpperCase()] = v;
    }
    if (name === "DTSTART" || name === "DTEND") {
      const parsed = parseIcalDate(value, params);
      cur[name === "DTSTART" ? "start" : "end"] = parsed.date;
      if (parsed.allDay) cur.allDay = true;
    } else if (name === "SUMMARY") {
      cur.summary = unescapeIcalText(value);
    } else if (name === "STATUS") {
      cur.status = value;
    } else if (name === "TRANSP") {
      cur.transp = value;
    }
  }
  return events.filter((e) => e.status !== "CANCELLED" && e.transp !== "TRANSPARENT");
}

function parseIcalDate(value, params) {
  if (params.VALUE === "DATE" || /^\d{8}$/.test(value)) {
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(4, 6));
    const d = Number(value.slice(6, 8));
    return { date: new Date(Date.UTC(y, m - 1, d)), allDay: true };
  }
  if (/Z$/.test(value)) {
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(4, 6));
    const d = Number(value.slice(6, 8));
    const hh = Number(value.slice(9, 11));
    const mm = Number(value.slice(11, 13));
    const ss = Number(value.slice(13, 15));
    return { date: new Date(Date.UTC(y, m - 1, d, hh, mm, ss)), allDay: false };
  }
  const y = Number(value.slice(0, 4));
  const m = Number(value.slice(4, 6));
  const d = Number(value.slice(6, 8));
  const hh = Number(value.slice(9, 11));
  const mm = Number(value.slice(11, 13));
  return { date: brusselsToUtc(y, m, d, hh, mm), allDay: false };
}

function unescapeIcalText(s) {
  return s.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

// --- iCal generation (PUT) ------------------------------------------------

export function buildEventIcal({ uid, summary, description, startUtc, endUtc, dtstamp, location }) {
  const fold = (line) => {
    if (line.length <= 75) return line;
    const out = [];
    let i = 0;
    while (i < line.length) {
      out.push((i === 0 ? "" : " ") + line.slice(i, i + 73));
      i += 73;
    }
    return out.join("\r\n");
  };
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const stamp = icalUtc(dtstamp);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//typografie.be//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `CREATED:${stamp}`,
    `LAST-MODIFIED:${stamp}`,
    "SEQUENCE:0",
    `DTSTART:${icalUtc(startUtc)}`,
    `DTEND:${icalUtc(endUtc)}`,
    fold(`SUMMARY:${esc(summary)}`),
    fold(`DESCRIPTION:${esc(description)}`),
    location ? fold(`LOCATION:${esc(location)}`) : "",
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return lines.join("\r\n") + "\r\n";
}

export async function putEvent({ calendarUrl, email, password }, uid, ical) {
  const url = calendarUrl + encodeURIComponent(uid) + ".ics";
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": authHeader(email, password),
      "Content-Type": "text/calendar; charset=utf-8",
      "If-None-Match": "*",
    },
    body: ical,
  });
  if (!res.ok && res.status !== 201 && res.status !== 204) {
    const txt = await res.text().catch(() => "");
    throw new Error(`CalDAV PUT failed: ${res.status} ${res.statusText} — ${txt.slice(0, 300)}`);
  }
  return url;
}

// --- availability computation --------------------------------------------

export function computeBusyDays(events, fromDateStr, toDateStr) {
  const blocked = new Map();
  const fromY = Number(fromDateStr.slice(0, 4));
  const fromM = Number(fromDateStr.slice(5, 7));
  const fromD = Number(fromDateStr.slice(8, 10));
  const toY = Number(toDateStr.slice(0, 4));
  const toM = Number(toDateStr.slice(5, 7));
  const toD = Number(toDateStr.slice(8, 10));
  const fromMs = Date.UTC(fromY, fromM - 1, fromD);
  const toMs = Date.UTC(toY, toM - 1, toD);

  for (let dayMs = fromMs; dayMs <= toMs; dayMs += 86400000) {
    const dateStr = new Date(dayMs).toISOString().slice(0, 10);
    const [y, m, d] = dateStr.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow === 0 || dow === 6) continue;

    const amStart = brusselsToUtc(y, m, d, 9, 0).getTime();
    const amEnd   = brusselsToUtc(y, m, d, 13, 0).getTime();
    const pmStart = brusselsToUtc(y, m, d, 14, 0).getTime();
    const pmEnd   = brusselsToUtc(y, m, d, 18, 0).getTime();

    for (const ev of events) {
      const evStart = ev.start.getTime();
      const evEnd = ev.end.getTime();
      if (ev.allDay) {
        const evDayStart = Date.UTC(ev.start.getUTCFullYear(), ev.start.getUTCMonth(), ev.start.getUTCDate());
        const evDayEnd = ev.end.getTime();
        if (dayMs >= evDayStart && dayMs < evDayEnd) {
          if (!blocked.has(dateStr)) blocked.set(dateStr, new Set());
          blocked.get(dateStr).add("am");
          blocked.get(dateStr).add("pm");
        }
        continue;
      }
      if (overlaps(evStart, evEnd, amStart, amEnd)) {
        if (!blocked.has(dateStr)) blocked.set(dateStr, new Set());
        blocked.get(dateStr).add("am");
      }
      if (overlaps(evStart, evEnd, pmStart, pmEnd)) {
        if (!blocked.has(dateStr)) blocked.set(dateStr, new Set());
        blocked.get(dateStr).add("pm");
      }
    }
  }

  return Array.from(blocked.entries()).map(([date, slots]) => ({ date, slots: Array.from(slots).sort() }));
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}
