// Slug-to-owner lookup that never lives in the public repo.
//
// New signups are written to the Netlify Blobs store "review-owners"
// (created on the first successful write). Existing pages that predate
// that store are resolved from the OWNER_DIRECTORY environment variable,
// a JSON object keyed by slug: { "slug": { "email", "businessName" } }.
// Blob values win when both exist.

const { connectLambda, getStore } = require("@netlify/blobs");

const STORE_NAME = "review-owners";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_EMAIL = 254;

function validEmail(email) {
  return typeof email === "string"
    && email.length > 0
    && email.length <= MAX_EMAIL
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeRecord(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const email = typeof row.email === "string" ? row.email.trim() : "";
  if (!validEmail(email)) return null;
  return {
    email,
    businessName: typeof row.businessName === "string" ? row.businessName : "",
  };
}

function openStore(event) {
  try {
    if (event) connectLambda(event);
    return getStore(STORE_NAME, { consistency: "strong" });
  } catch (err) {
    console.error("Netlify Blobs unavailable:", err && err.message);
    return null;
  }
}

function directoryFromEnv() {
  const raw = process.env.OWNER_DIRECTORY;
  if (!raw || typeof raw !== "string") return Object.create(null);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("OWNER_DIRECTORY is not valid JSON");
    return Object.create(null);
  }
  const out = Object.create(null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
  for (const [key, val] of Object.entries(parsed)) {
    if (!SLUG_RE.test(key) || key.length > 80) continue;
    const record = normalizeRecord(val);
    if (record) out[key] = record;
  }
  return out;
}

async function lookupOwner(event, slug) {
  if (typeof slug !== "string" || !SLUG_RE.test(slug) || slug.length > 80) return null;
  const store = openStore(event);
  if (store) {
    try {
      const row = await store.get(slug, { type: "json" });
      const record = normalizeRecord(row);
      if (record) return record;
    } catch (err) {
      console.error("Owner blob read failed:", err && err.message);
    }
  }
  return directoryFromEnv()[slug] || null;
}

async function saveOwner(event, slug, email, businessName) {
  if (typeof slug !== "string" || !SLUG_RE.test(slug) || slug.length > 80) {
    throw new Error("Refusing to store an unsafe slug");
  }
  const record = normalizeRecord({ email, businessName });
  if (!record) throw new Error("Owner email is not valid");
  const store = openStore(event);
  if (!store) throw new Error("Owner directory is unavailable");
  await store.setJSON(slug, record);
}

module.exports = { lookupOwner, saveOwner, STORE_NAME };
