// =============================================================
// netlify/functions/private-feedback.js
//
// Receives an optional private note from a review page and emails
// it to the business owner. The recipient is resolved server-side
// from the page slug (Netlify Blobs, then the OWNER_DIRECTORY env
// var). The browser cannot choose the address.
//
// Required env vars:
//   RESEND_API_KEY
//   OWNER_DIRECTORY  — JSON map for pages created before Blobs
// Optional:
//   FEEDBACK_BCC   — an address to copy on every feedback
// =============================================================

const { lookupOwner } = require("./utils/owner-directory");

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_MESSAGE = 2000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const hits = new Map();

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
  });
}

function header(event, name) {
  const headers = (event && event.headers) || {};
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want && value) return String(value);
  }
  return "";
}

function clientIp(event) {
  return header(event, "x-nf-client-connection-ip") || header(event, "client-ip") || "unknown";
}

function rateLimited(ip) {
  const now = Date.now();
  if (hits.size > 500) {
    for (const [key, times] of hits) {
      const fresh = times.filter((t) => now - t < WINDOW_MS);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  }
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

exports.handler = async (event) => {
  if (!event || event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  // Honeypot. Real customers never see this field. Pretend it worked
  // so a bot does not learn that the note was dropped.
  if (typeof data.website === "string" && data.website.trim() !== "") {
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: true }) };
  }

  if (rateLimited(clientIp(event))) {
    return { statusCode: 429, body: "Too many requests" };
  }

  const slug = typeof data.slug === "string" ? data.slug.trim() : "";
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const email = typeof data.email === "string" ? data.email.trim() : "";
  const message = typeof data.message === "string" ? data.message.trim() : "";
  const rating = parseInt(data.rating, 10);

  if (!SLUG_RE.test(slug) || slug.length > 80) {
    return { statusCode: 400, body: "Unknown review page" };
  }
  if (!name || !email || !message) {
    return { statusCode: 400, body: "Missing required fields (name, email, message)" };
  }
  if (name.length > MAX_NAME || email.length > MAX_EMAIL || message.length > MAX_MESSAGE) {
    return { statusCode: 400, body: "Note is too long" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, body: "Invalid email" };
  }

  // businessEmail and businessName in the body are ignored on purpose.
  const owner = await lookupOwner(event, slug);
  if (!owner) {
    return { statusCode: 404, body: "Unknown review page" };
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error("private-feedback: RESEND_API_KEY not set");
    return { statusCode: 500, body: "Email not configured" };
  }

  const businessName = owner.businessName;
  const stars = (rating >= 1 && rating <= 5)
    ? "★".repeat(rating) + "☆".repeat(5 - rating)
    : "(no rating)";

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /></head>
<body style="font-family:Arial,sans-serif;background:#f3f4f6;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#1a2332;padding:24px 28px;">
      <h1 style="margin:0;color:#F59E0B;font-size:20px;">New private feedback</h1>
      <p style="margin:6px 0 0;color:#d1d5db;font-size:14px;">for ${esc(businessName)}</p>
    </div>
    <div style="padding:24px 28px;color:#1f2937;">
      <p style="font-size:22px;letter-spacing:2px;color:#F59E0B;margin:0 0 4px;">${stars}</p>
      <p style="color:#6b7280;font-size:13px;margin:0 0 20px;">${rating >= 1 && rating <= 5 ? rating + " out of 5 stars" : ""}</p>
      <p style="margin:0 0 6px;"><strong>From:</strong> ${esc(name) || "(no name given)"}</p>
      <p style="margin:0 0 18px;"><strong>Email:</strong> ${email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : "(none given)"}</p>
      <div style="background:#f9fafb;border-left:4px solid #F59E0B;border-radius:6px;padding:16px 18px;color:#374151;line-height:1.6;white-space:pre-wrap;">${esc(message)}</div>
      ${email ? `<p style="margin:22px 0 0;"><a href="mailto:${esc(email)}?subject=${encodeURIComponent("Re: your visit to " + businessName)}" style="display:inline-block;background:#F59E0B;color:#1a2332;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;">Reply to this customer</a></p>` : ""}
      <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">This is an optional private note. This customer also has your Google review link and can leave a public review.</p>
    </div>
    <div style="background:#f9fafb;padding:16px 28px;text-align:center;color:#9ca3af;font-size:12px;">
      Powered by 1to5reviewz${slug ? " · " + esc(slug) : ""}
    </div>
  </div>
</body></html>`;

  const payload = {
    from: "All5Starz <info@all5starz.com>",
    to: [owner.email],
    subject: `New feedback for ${businessName || "your business"} (${rating >= 1 && rating <= 5 ? rating + "★" : "private"})`,
    html,
  };
  if (email) payload.reply_to = email;
  if (process.env.FEEDBACK_BCC) payload.bcc = [process.env.FEEDBACK_BCC];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("private-feedback Resend error:", res.status, err);
      return { statusCode: 502, body: "Could not send feedback email" };
    }
  } catch (err) {
    console.error("private-feedback request failed:", err.message);
    return { statusCode: 502, body: "Could not send feedback email" };
  }

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ success: true }) };
};
