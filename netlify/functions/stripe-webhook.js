// netlify/functions/stripe-webhook.js
// Stripe calls this function when payment events happen.
// When checkout.session.completed fires, we trigger the review page creation.

const https = require("https");
const crypto = require("crypto");

function verifyStripeSignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  try {
    const parts = signature.split(",").reduce((acc, part) => {
      const [k, v] = part.split("=");
      acc[k] = v;
      return acc;
    }, {});
    if (!parts.t || !parts.v1) return false;

    const signedPayload = `${parts.t}.${payload}`;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(signedPayload)
      .digest("hex");

    return crypto.timingSafeEqual(
      Buffer.from(parts.v1, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch (e) {
    return false;
  }
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const signature = event.headers["stripe-signature"];
  const isValid = verifyStripeSignature(
    event.body,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET
  );

  if (!isValid) {
    console.error("Invalid Stripe signature");
    return { statusCode: 400, body: "Invalid signature" };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  if (stripeEvent.type !== "checkout.session.completed") {
    return { statusCode: 200, body: "Event ignored" };
  }

  const session = stripeEvent.data.object;
  const metadata = session.metadata || {};

  console.log("Payment completed for:", metadata.business_name);

  const reviewPagePayload = JSON.stringify({
    secret: process.env.MAKE_SECRET,
    business_name: metadata.business_name,
    owner_name: metadata.owner_name,
    feedback_email: metadata.feedback_email,
    phone: metadata.phone,
    google_review_url: metadata.google_review_url,
    slug: metadata.slug,
    plan: metadata.plan,
    submitted_at: new Date().toISOString(),
  });

  const callOptions = {
    hostname: "1to5reviewz.com",
    path: "/.netlify/functions/create-review-page",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(reviewPagePayload),
    },
  };

  try {
    const result = await httpsRequest(callOptions, reviewPagePayload);

    // Treat 200 as success
    if (result.status === 200) {
      console.log("Review page created successfully");
      return { statusCode: 200, body: "OK" };
    }

    // If GitHub returned 422 (file already exists), the file is already
    // created from a previous webhook delivery — treat as success.
    if (result.body && result.body.includes("422")) {
      console.log("Review page already exists (duplicate webhook) - treating as success");
      return { statusCode: 200, body: "OK - already exists" };
    }

    console.error("Review page creation failed:", result.body);
    return { statusCode: 500, body: `Review page creation failed: ${result.body}` };
  } catch (err) {
    console.error("Review page request error:", err.message);
    return { statusCode: 500, body: err.message };
  }
};
