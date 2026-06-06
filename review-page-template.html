// =============================================================
// netlify/functions/create-review-page.js
//
// Replaces your existing create-review-page.js entirely.
// This version:
//   - Auto-generates the slug from the business name
//   - Auto-builds the Google review URL from the Place ID
//   - Creates 4 files per signup (review, email, text, qr)
//   - Sends the welcome email with 3 new buttons
//
// Required env vars (all should already be set in Netlify):
//   GITHUB_TOKEN, GITHUB_REPO, RESEND_API_KEY
// =============================================================

const fs = require('fs');
const path = require('path');

// Load all 5 templates once at cold start
const reviewTemplate       = fs.readFileSync(path.join(__dirname, '../../review-page-template.html'), 'utf8');
const emailTemplate        = fs.readFileSync(path.join(__dirname, '../../email.html'), 'utf8');
const textTemplate         = fs.readFileSync(path.join(__dirname, '../../text.html'), 'utf8');
const qrTemplate           = fs.readFileSync(path.join(__dirname, '../../qr.html'), 'utf8');
const welcomeEmailTemplate = fs.readFileSync(path.join(__dirname, '../../welcome-email.html'), 'utf8');

exports.handler = async (event) => {
  try {
    // The webhook hands off these fields after a successful Stripe payment
    const data = JSON.parse(event.body);
    const {
      business_name,
      owner_name,
      email,
      place_id,
      formatted_address
    } = data;

    if (!business_name || !email || !place_id) {
      return { statusCode: 400, body: 'Missing required fields' };
    }

    // 1. Generate a unique slug from the business name
    const baseSlug = slugify(business_name);
    const slug = await generateUniqueSlug(baseSlug);

    // 2. Build URLs
    const reviewUrl = `https://1to5reviewz.com/r/${slug}`;
    const googleReviewUrl = `https://search.google.com/local/writereview?placeid=${place_id}`;

    // 3. Build the variables used in every template
    const ownerFirstName = (owner_name || '').split(' ')[0] || 'there';
    const vars = {
      BUSINESS_NAME: business_name,
      SLUG: slug,
      REVIEW_URL: reviewUrl,
      REVIEW_URL_ENCODED: encodeURIComponent(reviewUrl),
      GOOGLE_REVIEW_URL: googleReviewUrl,
      BUSINESS_EMAIL: email,
      OWNER_FIRST_NAME: ownerFirstName
    };

    // 4. Write all 4 customer-facing files to GitHub
    await createGitHubFile(`r/${slug}/index.html`,       fillTemplate(reviewTemplate, vars));
    await createGitHubFile(`r/${slug}/email/index.html`, fillTemplate(emailTemplate, vars));
    await createGitHubFile(`r/${slug}/text/index.html`,  fillTemplate(textTemplate, vars));
    await createGitHubFile(`r/${slug}/qr/index.html`,    fillTemplate(qrTemplate, vars));

    // 5. Send the welcome email
    await sendWelcomeEmail(vars);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, slug, reviewUrl })
    };
  } catch (err) {
    console.error('create-review-page error:', err);
    return { statusCode: 500, body: err.message };
  }
};

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/['']/g, '')      // strip apostrophes ("Joe's" -> "Joes")
    .replace(/&/g, 'and')      // "&" -> "and"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')   // trim leading/trailing dashes
    .substring(0, 50);
}

async function generateUniqueSlug(baseSlug) {
  let slug = baseSlug;
  let counter = 2;
  while (await slugExists(slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
    if (counter > 100) throw new Error('Too many slug collisions');
  }
  return slug;
}

async function slugExists(slug) {
  const url = `https://api.github.com/repos/${process.env.GITHUB_REPO}/contents/r/${slug}/index.html`;
  const res = await fetch(url, {
    headers: { 'Authorization': `token ${process.env.GITHUB_TOKEN}` }
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
    method: 'PUT',
    headers: {
      'Authorization': `token ${process.env.GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Add ${filePath}`,
      content: Buffer.from(content).toString('base64')
    })
  });
  // 422 = file already exists (treat as OK, see existing webhook behavior)
  if (!res.ok && res.status !== 422) {
    const err = await res.text();
    throw new Error(`GitHub error for ${filePath}: ${err}`);
  }
}

async function sendWelcomeEmail(vars) {
  const html = fillTemplate(welcomeEmailTemplate, vars);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'All5Starz <info@all5starz.com>',
      to: vars.BUSINESS_EMAIL,
      subject: "You're all set! Your All5Starz review page is live",
      html
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${err}`);
  }
}
