// =============================================================
// netlify/functions/create-review-page.js
//
// This version embeds the HTML templates directly in the file
// so we don't have to read them from the filesystem (which is
// what was failing on Netlify).
//
// Required env vars (all should already be set in Netlify):
//   GITHUB_TOKEN, GITHUB_REPO, RESEND_API_KEY
// =============================================================

const fs = require("fs");
const path = require("path");

// Try several paths to find the template files (Netlify's file
// layout is different than local). Returns the contents when found.
function loadTemplate(filename) {
  const tryPaths = [
    path.join(__dirname, filename),
    path.join(__dirname, "..", filename),
    path.join(__dirname, "..", "..", filename),
    path.join(process.cwd(), filename),
    path.join("/var/task", filename),
    path.join("/var/task/netlify/functions", filename),
  ];
  for (const p of tryPaths) {
    try {
      if (fs.existsSync(p)) {
        return fs.readFileSync(p, "utf8");
      }
    } catch (e) {
      // keep trying
    }
  }
  throw new Error(`Template not found: ${filename} (tried ${tryPaths.join(", ")})`);
}

let reviewTemplate, emailTemplate, textTemplate, qrTemplate, welcomeEmailTemplate;
try {
  reviewTemplate       = loadTemplate("review-page-template.html");
  emailTemplate        = loadTemplate("email.html");
  textTemplate         = loadTemplate("text.html");
  qrTemplate           = loadTemplate("qr.html");
  welcomeEmailTemplate = loadTemplate("welcome-email.html");
} catch (err) {
  console.error("Template loading error:", err.message);
}

exports.handler = async (event) => {
  try {
    const data = JSON.parse(event.body);
    const {
      business_name,
      owner_name,
      email,
      place_id,
      formatted_address,
    } = data;

    if (!business_name || !email || !place_id) {
      return { statusCode: 400, body: "Missing required fields" };
    }

    if (!reviewTemplate) {
      return { statusCode: 500, body: "Templates failed to load at cold start" };
    }

    const baseSlug = slugify(business_name);
    const slug = await generateUniqueSlug(baseSlug);

    const reviewUrl = `https://1to5reviewz.com/r/${slug}`;
    const googleReviewUrl = `https://search.google.com/local/writereview?placeid=${place_id}`;

    const ownerFirstName = (owner_name || "").split(" ")[0] || "there";
    const vars = {
      BUSINESS_NAME: business_name,
      SLUG: slug,
      REVIEW_URL: reviewUrl,
      REVIEW_URL_ENCODED: encodeURIComponent(reviewUrl),
      GOOGLE_REVIEW_URL: googleReviewUrl,
      BUSINESS_EMAIL: email,
      OWNER_FIRST_NAME: ownerFirstName,
    };

    await createGitHubFile(`r/${slug}/index.html`,       fillTemplate(reviewTemplate, vars));
    await createGitHubFile(`r/${slug}/email/index.html`, fillTemplate(emailTemplate, vars));
    await createGitHubFile(`r/${slug}/text/index.html`,  fillTemplate(textTemplate, vars));
    await createGitHubFile(`r/${slug}/qr/index.html`,    fillTemplate(qrTemplate, vars));

    await sendWelcomeEmail(vars);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, slug, reviewUrl }),
    };
  } catch (err) {
    console.error("create-review-page error:", err);
    return { statusCode: 500, body: err.message };
  }
};

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50);
}

async function generateUniqueSlug(baseSlug) {
  let slug = baseSlug;
  let counter = 2;
  while (await slugExists(slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
    if (counter > 100) throw new Error("Too many slug collisions");
  }
  return slug;
}

async function slugExists(slug) {
  const url = `https://api.github.com/repos/${process.env.GITHUB_REPO}/contents/r/${slug}/index.html`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
  });
  return res.status === 200;
}

function fillTemplate(template, vars) {
  let out = template;
  for (const [key, val] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(val);
  }
  return out;
}

async function createGitHubFile(filePath, content) {
  const url = `https://api.github.com/repos/${process.env.GITHUB_REPO}/contents/${filePath}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `Add ${filePath}`,
      content: Buffer.from(content).toString("base64"),
    }),
  });
  if (!res.ok && res.status !== 422) {
    const err = await res.text();
    throw new Error(`GitHub error for ${filePath}: ${err}`);
  }
}

async function sendWelcomeEmail(vars) {
  const html = fillTemplate(welcomeEmailTemplate, vars);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "All5Starz <info@all5starz.com>",
      to: vars.BUSINESS_EMAIL,
      subject: "You're all set! Your All5Starz review page is live",
      html,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
}
