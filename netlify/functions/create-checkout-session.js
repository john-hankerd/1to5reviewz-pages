// netlify/functions/create-checkout-session.js
// Triggered by the signup form on all5starz.com
// Creates a Stripe Checkout Session and returns the URL to redirect to.

const https = require("https");
const querystring = require("querystring");

function stripePost(path, body) {
  return new Promise((resolve, reject) => {
    const data = querystring.stringify(body);
    const options = {
      hostname: "api.stripe.com",
      path,
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(data),
      },
    };
    const req = https.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// Generate a URL-safe slug from a business name
// (Same logic as create-review-page.js so slugs match)
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50);
}

exports.handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: "Method Not Allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, headers: corsHeaders, body: "Invalid JSON" };
  }

  const {
    business_name,
    owner_name,
    email,
    phone,
    place_id,
    formatted_address,
    plan,
  } = payload;

  if (!business_name || !email || !place_id) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Missing required fields" }),
    };
  }

  // Generate slug from business name so we can use it in the success URL
  const slug = slugify(business_name);

  const priceId = plan === "yearly"
    ? process.env.PRICE_ANNUAL
    : process.env.PRICE_MONTHLY;

  const sessionParams = {
    mode: "subscription",
    "payment_method_types[]": "card",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    customer_email: email,
    success_url: `https://all5starz.com/thank-you?slug=${encodeURIComponent(slug)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: "https://all5starz.com/#signup",
    "metadata[business_name]": business_name,
    "metadata[owner_name]": owner_name || "",
    "metadata[email]": email,
    "metadata[phone]": phone || "",
    "metadata[place_id]": place_id,
    "metadata[formatted_address]": formatted_address || "",
    "metadata[slug]": slug,
    "metadata[plan]": plan || "monthly",
    "subscription_data[metadata][business_name]": business_name,
    "subscription_data[metadata][slug]": slug,
    "subscription_data[metadata][email]": email,
    allow_promotion_codes: "true",
  };

  try {
    const result = await stripePost("/v1/checkout/sessions", sessionParams);
    if (result.status !== 200) {
      console.error("Stripe error:", result.body);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: "Stripe error", details: result.body }),
      };
    }
    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ checkout_url: result.body.url }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
