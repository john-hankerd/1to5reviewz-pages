// Run from the repo root: node tests/function-security.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.MAKE_SECRET = "webhook-secret-value";
process.env.GITHUB_REPO = "example/repo";
process.env.GITHUB_TOKEN = "gh-test";
process.env.RESEND_API_KEY = "re_test";
delete process.env.FEEDBACK_BCC;
delete process.env.OWNER_DIRECTORY;

const blobData = new Map();
const blobCalls = [];
let blobsAvailable = true;

const blobsPath = require.resolve("@netlify/blobs", {
  paths: [path.join(__dirname, "..", "netlify", "functions")],
});
require.cache[blobsPath] = {
  id: blobsPath,
  filename: blobsPath,
  loaded: true,
  exports: {
    connectLambda() {
      blobCalls.push("connect");
    },
    getStore() {
      if (!blobsAvailable) {
        const err = new Error("Missing Blobs environment");
        err.name = "MissingBlobsEnvironmentError";
        throw err;
      }
      return {
        async get(key) {
          blobCalls.push({ op: "get", key });
          return blobData.has(key) ? blobData.get(key) : null;
        },
        async setJSON(key, data) {
          blobCalls.push({ op: "setJSON", key, data });
          blobData.set(key, JSON.parse(JSON.stringify(data)));
        },
      };
    },
  },
};

const calls = [];
global.fetch = async (url, opts = {}) => {
  const method = opts.method || "GET";
  let body = null;
  if (opts.body) body = JSON.parse(opts.body);
  calls.push({ url: String(url), method, body });
  const u = String(url);
  if (method === "GET") {
    return { status: 404, ok: false, json: async () => ({}), text: async () => "missing" };
  }
  if (method === "PUT" || u.includes("api.resend.com")) {
    return { status: 200, ok: true, json: async () => ({}), text: async () => "" };
  }
  return { status: 500, ok: false, json: async () => ({}), text: async () => "unexpected" };
};

function decodePut(call) {
  return Buffer.from(call.body.content, "base64").toString("utf8");
}

const createReview = require("../netlify/functions/create-review-page");
const feedback = require("../netlify/functions/private-feedback");

function post(body, headers) {
  return {
    httpMethod: "POST",
    headers: headers || { "x-nf-client-connection-ip": "203.0.113.10" },
    body: JSON.stringify(body),
  };
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

(async () => {
  const webhookSrc = fs.readFileSync("netlify/functions/stripe-webhook.js", "utf8");
  assert(webhookSrc.includes("secret: process.env.MAKE_SECRET"), "webhook sends MAKE_SECRET as JSON secret");
  assert(!fs.existsSync("netlify/functions/owners.json"), "owner emails are not committed");

  let res = await createReview.handler(post({ business_name: "Test Cafe", email: "ada@example.com", place_id: "ChIJtest" }));
  assert.strictEqual(res.statusCode, 401, "missing secret is 401");
  assert.strictEqual(calls.length, 0, "rejected request does not call GitHub");
  assert.strictEqual(blobCalls.length, 0, "rejected request does not touch Blobs");

  res = await createReview.handler(post({ secret: "nope", business_name: "Test Cafe", email: "ada@example.com", place_id: "ChIJtest" }));
  assert.strictEqual(res.statusCode, 401, "wrong secret is 401");

  res = await createReview.handler(post({ secret: "webhook-secret-value-extra", business_name: "Test Cafe", email: "ada@example.com", place_id: "ChIJtest" }));
  assert.strictEqual(res.statusCode, 401, "longer wrong secret is 401");

  res = await createReview.handler(post({ secret: { leaked: true }, business_name: "Test Cafe", email: "ada@example.com", place_id: "ChIJtest" }));
  assert.strictEqual(res.statusCode, 401, "non-string secret is 401");

  const saved = process.env.MAKE_SECRET;
  delete process.env.MAKE_SECRET;
  res = await createReview.handler(post({ secret: "webhook-secret-value", business_name: "Test Cafe", email: "ada@example.com", place_id: "ChIJtest" }));
  assert.strictEqual(res.statusCode, 401, "unset MAKE_SECRET fails closed");
  process.env.MAKE_SECRET = saved;

  res = await createReview.handler(post({ secret: process.env.MAKE_SECRET }));
  assert.strictEqual(res.statusCode, 400, "valid secret with missing fields is 400, not 401");
  assert.strictEqual(calls.length, 0, "incomplete signup does not write files");

  calls.length = 0;
  blobCalls.length = 0;
  blobsAvailable = false;
  res = await createReview.handler(post({
    secret: process.env.MAKE_SECRET,
    business_name: "Test Cafe",
    email: "ada@example.com",
    place_id: "ChIJtest",
  }));
  assert.strictEqual(res.statusCode, 500, "signup fails when Blobs are unavailable: " + res.body);
  assert(!calls.some((c) => c.method === "PUT"), "a page is not published when the owner cannot be stored");
  blobsAvailable = true;

  // Same shape stripe-webhook.js posts after checkout.session.completed.
  const signup = {
    secret: process.env.MAKE_SECRET,
    business_name: "Test Cafe",
    owner_name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "555",
    place_id: "ChIJtest",
    formatted_address: "1 Main St",
    slug: "ignored-by-function",
    plan: "monthly",
    submitted_at: new Date().toISOString(),
  };
  calls.length = 0;
  blobCalls.length = 0;
  res = await createReview.handler(post(signup));
  assert.strictEqual(res.statusCode, 200, "legitimate webhook payload creates a page: " + res.body);
  const created = JSON.parse(res.body);
  assert.strictEqual(created.slug, "test-cafe");

  const stored = blobCalls.find((c) => c.op === "setJSON");
  assert(stored, "signup writes the owner to Blobs");
  assert.strictEqual(stored.key, "test-cafe");
  assert.strictEqual(stored.data.email, "ada@example.com");
  assert.strictEqual(stored.data.businessName, "Test Cafe");
  assert(!calls.some((c) => String(c.url).includes("owners.json")), "signup does not commit an owner directory");

  const pagePut = calls.find((c) => c.method === "PUT" && c.url.endsWith("/r/test-cafe/index.html"));
  assert(pagePut, "review page was written");
  const pageHtml = decodePut(pagePut);
  assert(!EMAIL_RE.test(pageHtml), "public review page does not contain an email address");
  assert(!pageHtml.includes("businessEmail"), "public review page does not send businessEmail");
  assert(!pageHtml.includes("BUSINESS_EMAIL"), "public review page has no owner-email placeholder");
  assert(pageHtml.includes("fb-website"), "honeypot is on new review pages");
  assert(pageHtml.includes("Leave a Google review"), "every rating keeps the Google button");
  assert(pageHtml.includes("Prefer to tell the owner directly?"), "private note sits beside the Google button");
  assert(pageHtml.includes("Send private note"));
  assert(!pageHtml.includes("location.href"), "star rating does not redirect");
  assert(pageHtml.includes("https://search.google.com/local/writereview?placeid=ChIJtest"));
  assert(pageHtml.includes("all5starz-place-id: ChIJtest"));

  const welcome = calls.find((c) => c.url.includes("api.resend.com"));
  assert(welcome && welcome.body.to[0] === "ada@example.com", "welcome email still goes to the owner");

  blobData.set("sample-lodge", { email: "blob-owner@example.com", businessName: "Blob Lodge" });
  process.env.OWNER_DIRECTORY = JSON.stringify({
    "campfire-cabins": { email: "cabin-owner@example.com", businessName: "Campfire Cabins" },
    "sample-lodge": { email: "env-owner@example.com", businessName: "Env Lodge" },
    "__proto__": { email: "evil@example.com", businessName: "nope" },
  });

  calls.length = 0;
  res = await feedback.handler(post({
    slug: "sample-lodge",
    businessEmail: "attacker@evil.com",
    businessName: "Totally Not The Lodge",
    rating: 2,
    name: "Sam Visitor",
    email: "sam@example.com",
    message: "The shower was cold.",
    website: "",
  }, { "x-nf-client-connection-ip": "203.0.113.20" }));
  assert.strictEqual(res.statusCode, 200, "blob slug can send a note: " + res.body);
  const note = calls.find((c) => c.url.includes("api.resend.com"));
  assert(note, "feedback email was sent");
  assert.deepStrictEqual(note.body.to, ["blob-owner@example.com"], "recipient comes from Blobs, not the browser or env");
  assert(!JSON.stringify(note.body).includes("attacker@evil.com"));
  assert(!JSON.stringify(note.body).includes("env-owner@example.com"));
  assert(note.body.html.includes("Blob Lodge"));
  assert(!note.body.html.includes("Totally Not The Lodge"));
  assert(note.body.html.includes("This is an optional private note. This customer also has your Google review link and can leave a public review."));

  calls.length = 0;
  res = await feedback.handler(post({
    slug: "campfire-cabins",
    businessEmail: "attacker@evil.com",
    businessName: "Wrong Name",
    rating: 4,
    name: "Pat",
    email: "pat@example.com",
    message: "Loved the cabins.",
  }, { "x-nf-client-connection-ip": "203.0.113.21" }));
  assert.strictEqual(res.statusCode, 200, "env fallback delivers a note when Blobs has no key: " + res.body);
  const envNote = calls.find((c) => c.url.includes("api.resend.com"));
  assert.deepStrictEqual(envNote.body.to, ["cabin-owner@example.com"]);
  assert(envNote.body.html.includes("Campfire Cabins"));
  assert(!JSON.stringify(envNote.body).includes("attacker@evil.com"));

  calls.length = 0;
  res = await feedback.handler(post({
    slug: "campfire-cabins",
    name: "Pat",
    email: "pat@example.com",
    message: "Loved the cabins.",
    website: "http://spam.example",
  }, { "x-nf-client-connection-ip": "203.0.113.22" }));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(calls.length, 0, "honeypot does not send mail");

  res = await feedback.handler(post({
    slug: "not-a-real-business",
    businessEmail: "attacker@evil.com",
    name: "Pat",
    email: "pat@example.com",
    message: "Hello",
  }, { "x-nf-client-connection-ip": "203.0.113.23" }));
  assert.strictEqual(res.statusCode, 404, "unknown slug is not a mail relay");

  res = await feedback.handler(post({
    slug: "__proto__",
    name: "Pat",
    email: "pat@example.com",
    message: "Hello",
  }, { "x-nf-client-connection-ip": "203.0.113.24" }));
  assert.strictEqual(res.statusCode, 400, "unsafe slug is rejected");

  res = await feedback.handler(post({
    slug: "campfire-cabins",
    name: "Pat",
    email: "pat@example.com",
    message: "x".repeat(2001),
  }, { "x-nf-client-connection-ip": "203.0.113.25" }));
  assert.strictEqual(res.statusCode, 400, "overlong note is rejected");

  const ip = "203.0.113.26";
  for (let i = 0; i < 5; i++) {
    res = await feedback.handler(post({
      slug: "campfire-cabins",
      name: "Pat",
      email: "pat@example.com",
      message: "Note " + i,
    }, { "x-nf-client-connection-ip": ip }));
    assert.strictEqual(res.statusCode, 200, "note " + i + " allowed");
  }
  res = await feedback.handler(post({
    slug: "campfire-cabins",
    name: "Pat",
    email: "pat@example.com",
    message: "one more",
  }, { "x-nf-client-connection-ip": ip }));
  assert.strictEqual(res.statusCode, 429, "sixth note in the window is limited");

  for (const file of [
    "review-page-template.html",
    "r/hankerds-horseshoe-lake-campground/index.html",
    "r/campfire-cabins/index.html",
  ]) {
    const html = fs.readFileSync(file, "utf8");
    assert(!EMAIL_RE.test(html), file + " has no email address");
    assert(!html.includes("businessEmail"), file + " does not post businessEmail");
    assert(!html.includes("BUSINESS_EMAIL"), file + " has no owner-email placeholder");
    assert(html.includes('const SLUG ='), file + " still has a slug");
    assert(html.includes("Leave a Google review"), file + " keeps the Google button");
    assert(html.includes("fb-website"), file + " has the honeypot");
    assert(!html.includes("location.href"), file + " does not redirect on a rating");
  }

  const hankerd = fs.readFileSync("r/hankerds-horseshoe-lake-campground/index.html", "utf8");
  assert(hankerd.includes("Hankerd's Horseshoe Lake Campground"));
  assert(hankerd.includes("placeid=ChIJJz9_niEJIIgRjQ4o19N78bY"));
  assert(hankerd.includes('const SLUG = "hankerds-horseshoe-lake-campground"'));
  const cabins = fs.readFileSync("r/campfire-cabins/index.html", "utf8");
  assert(cabins.includes("Campfire Cabins"));
  assert(cabins.includes("placeid=ChIJQQqPp85NNU0RpZI2ddMG4s8"));
  assert(cabins.includes('const SLUG = "campfire-cabins"'));

  console.log("all security checks passed");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
