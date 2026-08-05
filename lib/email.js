// Transactional email for calendar bookings — Resend's HTTP API, so this
// works on the edge runtime (SMTP would not).
//
// Two messages go out per booking:
//   1. confirmation to the client, with the whole booking as an .ics
//   2. notification to Martijn, reply-to set to the client
//
// Sending must never sink a booking that is already in the calendar. Every
// entry point here resolves rather than throws; the caller gets a report.

import { TZ } from "./caldav";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Verified sending domain on Resend. Override per-environment if the
// address changes; the fallback matches the site's own domain.
const FROM = process.env.BOOKING_FROM_EMAIL || "Martijn Mertens <booking@typografie.be>";
const NOTIFY = process.env.BOOKING_NOTIFY_EMAIL || "martijn@aboutcontact.com";
const REPLY_TO = process.env.BOOKING_REPLY_TO || "martijn@aboutcontact.com";

const SLOT_LABEL = { am: "Morning", pm: "Afternoon", full: "Full day" };

const dayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
});

function formatDay(date) { return dayFmt.format(date); }
function formatTime(date) { return timeFmt.format(date); }
function formatEur(n) { return `EUR ${Number(n).toLocaleString("de-DE")}`; }

// btoa is latin1-only; names and addresses can carry accents, so go through
// UTF-8 bytes first or the attachment arrives corrupted.
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// A session line reads "Monday 18 May 2026 — Morning, 09:00-13:00 (EUR 350)".
function sessionLine(s) {
  return `${formatDay(s.startUtc)} — ${SLOT_LABEL[s.slot]}, ${formatTime(s.startUtc)}-${formatTime(s.endUtc)} (${formatEur(s.price)})`;
}

async function sendViaResend({ to, subject, text, html, replyTo, attachments }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set");
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      text,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
      ...(attachments ? { attachments } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

const SHELL = (inner) => `<!doctype html><html><body style="margin:0;padding:0;background:#f8f8f8;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:15px;line-height:1.5;color:#000;">
${inner}
</div></body></html>`;

const ROW = (label, value) =>
  `<tr><td style="padding:6px 16px 6px 0;color:#767676;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td>` +
  `<td style="padding:6px 0;vertical-align:top;">${value}</td></tr>`;

function clientEmail(b) {
  const multi = b.sessions.length > 1;
  const subject = multi
    ? `Booking confirmed — ${b.sessions.length} sessions`
    : `Booking confirmed — ${formatDay(b.sessions[0].startUtc)}`;

  const sessionsText = b.sessions.map((s) => `  ${sessionLine(s)}`).join("\n");
  const text = [
    `Hi ${b.name},`,
    ``,
    `Your booking is confirmed. Here are the details:`,
    ``,
    sessionsText,
    ``,
    `Where: ${b.locationLabel}`,
    b.location === "office" ? `Address: ${b.address}` : "",
    `Total: ${formatEur(b.total)} excl. VAT`,
    ``,
    `What you told me about the project:`,
    b.description,
    ``,
    `I follow up within a working day with the invoice and any logistics.`,
    `Need to change or cancel? Just reply to this email.`,
    ``,
    `Martijn Mertens`,
    `About Contact — typografie.be`,
    `Terms: https://typografie.be/calendar/terms`,
  ].filter(Boolean).join("\n");

  const html = SHELL(`
<p style="margin:0 0 20px;font-size:20px;font-weight:600;">Booking confirmed</p>
<p style="margin:0 0 20px;">Hi ${escapeHtml(b.name)}, your ${multi ? "sessions are" : "session is"} in the diary.</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 20px;">
${b.sessions.map((s) => ROW(
    multi ? "Session" : "When",
    `${escapeHtml(formatDay(s.startUtc))}<br><span style="color:#767676;">${SLOT_LABEL[s.slot]}, ${formatTime(s.startUtc)}-${formatTime(s.endUtc)} · ${formatEur(s.price)}</span>`,
  )).join("")}
${ROW("Where", escapeHtml(b.locationLabel) + (b.location === "office" ? `<br><span style="color:#767676;">${escapeHtml(b.address)}</span>` : ""))}
${ROW("Total", `<strong>${formatEur(b.total)}</strong> <span style="color:#767676;">excl. VAT</span>`)}
</table>
<p style="margin:0 0 6px;color:#767676;">What you told me about the project</p>
<p style="margin:0 0 24px;white-space:pre-wrap;">${escapeHtml(b.description)}</p>
<p style="margin:0 0 20px;">I follow up within a working day with the invoice and any logistics. Need to change or cancel? Just reply to this email.</p>
<p style="margin:0;padding-top:20px;border-top:1px solid #e0e0e0;color:#767676;font-size:13px;">
Martijn Mertens · About Contact<br>
<a href="https://typografie.be" style="color:#767676;">typografie.be</a> ·
<a href="https://typografie.be/calendar/terms" style="color:#767676;">Terms &amp; conditions</a>
</p>`);

  return { subject, text, html };
}

function ownerEmail(b) {
  const multi = b.sessions.length > 1;
  const subject = multi
    ? `New booking — ${b.name}, ${b.sessions.length} sessions (${formatEur(b.total)})`
    : `New booking — ${b.name}, ${formatDay(b.sessions[0].startUtc)} (${formatEur(b.total)})`;

  const text = [
    `${b.name} <${b.email}> booked via typografie.be/calendar.`,
    ``,
    ...b.sessions.map((s) => sessionLine(s)),
    ``,
    `Total: ${formatEur(b.total)} excl. VAT`,
    `Where: ${b.locationLabel}`,
    `Address: ${b.address}`,
    b.groupId ? `Group: ${b.groupId}` : "",
    ``,
    `--- Project ---`,
    b.description,
    ``,
    `Reply to this email to reach ${b.name} directly.`,
  ].filter(Boolean).join("\n");

  const html = SHELL(`
<p style="margin:0 0 20px;font-size:20px;font-weight:600;">New booking</p>
<table style="border-collapse:collapse;width:100%;margin:0 0 20px;">
${ROW("From", `${escapeHtml(b.name)}<br><a href="mailto:${escapeHtml(b.email)}" style="color:#000;">${escapeHtml(b.email)}</a>`)}
${b.sessions.map((s) => ROW(multi ? "Session" : "When",
    `${escapeHtml(formatDay(s.startUtc))}<br><span style="color:#767676;">${SLOT_LABEL[s.slot]}, ${formatTime(s.startUtc)}-${formatTime(s.endUtc)} · ${formatEur(s.price)}</span>`,
  )).join("")}
${ROW("Total", `<strong>${formatEur(b.total)}</strong> <span style="color:#767676;">excl. VAT</span>`)}
${ROW("Where", escapeHtml(b.locationLabel))}
${ROW("Address", escapeHtml(b.address))}
${b.groupId ? ROW("Group", escapeHtml(b.groupId)) : ""}
</table>
<p style="margin:0 0 6px;color:#767676;">Project</p>
<p style="margin:0 0 24px;white-space:pre-wrap;">${escapeHtml(b.description)}</p>
<p style="margin:0;padding-top:20px;border-top:1px solid #e0e0e0;color:#767676;font-size:13px;">Reply to this email to reach ${escapeHtml(b.name)} directly.</p>`);

  return { subject, text, html };
}

// Sends both messages. Never throws — a booking that is already written to
// the calendar must not fail because a mail server had a bad minute.
// Returns { client, owner, errors } so the caller can report honestly.
export async function sendBookingEmails(booking) {
  const result = { client: false, owner: false, errors: [] };

  if (!process.env.RESEND_API_KEY) {
    result.errors.push("RESEND_API_KEY is not set — no booking emails sent");
    console.error("booking email skipped: RESEND_API_KEY is not set");
    return result;
  }

  const attachments = booking.ics
    ? [{ filename: "booking.ics", content: toBase64(booking.ics) }]
    : undefined;

  const client = clientEmail(booking);
  const owner = ownerEmail(booking);

  const [clientRes, ownerRes] = await Promise.allSettled([
    sendViaResend({ ...client, to: booking.email, replyTo: REPLY_TO, attachments }),
    sendViaResend({ ...owner, to: NOTIFY, replyTo: booking.email }),
  ]);

  if (clientRes.status === "fulfilled") result.client = true;
  else {
    result.errors.push(`client: ${clientRes.reason?.message || clientRes.reason}`);
    console.error("booking confirmation email failed", clientRes.reason);
  }

  if (ownerRes.status === "fulfilled") result.owner = true;
  else {
    result.errors.push(`owner: ${ownerRes.reason?.message || ownerRes.reason}`);
    console.error("booking notification email failed", ownerRes.reason);
  }

  return result;
}
