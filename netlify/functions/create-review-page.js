// netlify/functions/create-review-page.js
// Triggered by Make.com after a signup form submission.

const https = require("https");

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function buildReviewPageHTML(businessName, googleReviewUrl, formspreeId) {
  const fsId = formspreeId || "YOUR_FORMSPREE_ID";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Rate Your Experience — ${businessName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f9fafb; display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 24px; }
    .card { background: #fff; border-radius: 20px; box-shadow: 0 4px 24px rgba(0,0,0,0.10);
      max-width: 480px; width: 100%; padding: 48px 36px 40px; text-align: center; }
    h1 { font-size: 1.5rem; color: #1a1a2e; margin-bottom: 8px; }
    p.sub { color: #6b7280; font-size: 0.95rem; margin-bottom: 32px; }
    .stars { display: flex; justify-content: center; gap: 14px; margin-bottom: 36px; }
    .star { font-size: 3rem; cursor: pointer; transition: transform 0.15s;
      filter: grayscale(1) opacity(0.4); user-select: none; }
    .star:hover, .star.active { filter: none; transform: scale(1.18); }
    #feedback-section { display: none; }
    #feedback-section textarea { width: 100%; border: 1.5px solid #e5e7eb;
      border-radius: 10px; padding: 12px; font-size: 0.95rem; resize: vertical;
      min-height: 120px; margin-bottom: 16px; outline: none; transition: border-color 0.2s; }
    #feedback-section textarea:focus { border-color: #f59e0b; }
    .btn { background: #f59e0b; color: #fff; border: none; border-radius: 10px;
      padding: 14px 32px; font-size: 1rem; font-weight: 600; cursor: pointer;
      transition: background 0.2s; }
    .btn:hover { background: #d97706; }
    .thank-you { display: none; }
    .thank-you h2 { color: #059669; font-size: 1.3rem; margin-bottom: 8px; }
    .thank-you p { color: #6b7280; }
    .powered { margin-top: 28px; font-size: 0.75rem; color: #d1d5db; }
    .powered a { color: #d1d5db; text-decoration: none; }
  </style>
</head>
<body>
<div class="card">
  <div id="rating-section">
    <h1>How'd we do?</h1>
    <p class="sub">Tap a star to rate your experience at<br><strong>${businessName}</strong></p>
    <div class="stars" id="stars">
      <span class="star" data-val="1">⭐</span>
      <span class="star" data-val="2">⭐</span>
      <span class="star" data-val="3">⭐</span>
      <span class="star" data-val="4">⭐</span>
      <span class="star" data-val="5">⭐</span>
    </div>
  </div>
  <div id="feedback-section">
    <h1>Tell us more</h1>
    <p class="sub" style="margin-bottom:20px">We're sorry it wasn't perfect. What can we do better?</p>
    <form id="feedback-form" action="https://formspree.io/f/${fsId}" method="POST">
      <input type="hidden" name="business" value="${businessName}" />
      <input type="hidden" name="rating" id="hidden-rating" value="" />
      <textarea name="feedback" placeholder="Your feedback here..."></textarea>
      <input type="email" name="email" placeholder="Your email (optional)"
        style="width:100%;border:1.5px solid #e5e7eb;border-radius:10px;padding:12px;
               font-size:0.95rem;margin-bottom:16px;outline:none;" />
      <br />
      <button type="submit" class="btn">Send Feedback</button>
    </form>
  </div>
  <div class="thank-you" id="thank-you">
    <h2>Thank you! 🙏</h2>
    <p>We appreciate you taking the time to share your thoughts.</p>
  </div>
  <p class="powered">Powered by <a href="https://all5starz.com" target="_blank">All5Starz</a></p>
</div>
<script>
  const stars = document.querySelectorAll('.star');
  const GOOGLE_URL = "${googleReviewUrl}";
  stars.forEach(star => {
    star.addEventListener('mouseenter', () => highlightStars(+star.dataset.val));
    star.addEventListener('mouseleave', () => highlightStars(0));
    star.addEventListener('click', () => handleRating(+star.dataset.val));
  });
  function highlightStars(val) {
    stars.forEach(s => s.classList.toggle('active', +s.dataset.val <= val));
  }
  function handleRating(val) {
    if (val === 5) { window.location.href = GOOGLE_URL; }
    else {
      document.getElementById('hidden-rating').value = val;
      document.getElementById('rating-section').style.display = 'none';
      document.getElementById('feedback-section').style.display = 'block';
    }
  }
  document.getElementById('feedback-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const data = new FormData(form);
    try {
      await fetch(form.action, { method: 'POST', body: data,
        headers: { 'Accept': 'application/json' } });
    } catch(_) {}
    document.getElementById('feedback-section').style.display = 'none';
    document.getElementById('thank-you').style.display = 'block';
  });
</script>
</body>
</html>`;
}

function buildWelcomeEmail(businessName, ownerName, slug) {
  const reviewPageUrl = `https://1to5reviewz.com/r/${slug}`;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8" />
<style>
  body { font-family: Arial, sans-serif; background: #f3f4f6; margin: 0; padding: 0; }
  .wrap { max-width: 580px; margin: 40px auto; background: #fff; border-radius: 16px;
    overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  .header { background: #1a1a2e; padding: 36px 40px; text-align: center; }
  .header h1 { color: #f59e0b; font-size: 2rem; margin: 0; }
  .header p { color: #9ca3af; margin: 4px 0 0; font-size: 0.9rem; }
  .body { padding: 36px 40px; }
  .body h2 { color: #1a1a2e; margin-bottom: 12px; }
  .body p { color: #374151; line-height: 1.6; margin-bottom: 16px; }
  .url-box { background: #fef3c7; border: 2px solid #f59e0b; border-radius: 10px;
    padding: 16px 20px; text-align: center; margin: 24px 0; }
  .url-box p { margin: 0; font-size: 0.85rem; color: #92400e; }
  .url-box a { font-size: 1.1rem; font-weight: bold; color: #d97706;
    word-break: break-all; text-decoration: none; }
  .btn { display: inline-block; background: #f59e0b; color: #fff; padding: 14px 32px;
    border-radius: 10px; text-decoration: none; font-weight: bold;
    font-size: 1rem; margin: 8px 0; }
  .footer { background: #f9fafb; padding: 24px 40px; text-align: center;
    font-size: 0.8rem; color: #9ca3af; }
</style></head><body>
<div class="wrap">
  <div class="header"><h1>⭐ All5Starz</h1>
    <p>Protect your reputation. Capture every issue privately.</p></div>
  <div class="body">
    <h2>You're all set, ${ownerName}! 🎉</h2>
    <p>Your review page for <strong>${businessName}</strong> is live. Share it with every customer. Happy customers go straight to Google. Everyone else sends you private feedback.</p>
    <div class="url-box">
      <p>Your review page:</p>
      <a href="${reviewPageUrl}">${reviewPageUrl}</a>
    </div>
    <p><strong>3 easy ways to share it:</strong></p>
    <p>📱 <strong>Text it</strong> — paste the link in a follow-up text after every job.<br />
    🖨️ <strong>Print it</strong> — put the QR card on your counter or in your vehicle.<br />
    📧 <strong>Email it</strong> — drop the link in your email signature.</p>
    <p style="text-align:center;margin-top:28px;">
      <a href="${reviewPageUrl}" class="btn">View My Review Page</a></p>
    <p style="font-size:0.85rem;color:#6b7280;margin-top:24px;">
      Questions? Just reply to this email. We're here to help.<br />— The All5Starz Team</p>
  </div>
  <div class="footer">All5Starz · <a href="https://all5starz.com" style="color:#9ca3af;">all5starz.com</a><br />
    You're receiving this because you signed up at all5starz.com.</div>
</div></body></html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: "Invalid JSON" }; }

  const makeSecret = process.env.MAKE_SECRET;
  if (makeSecret && payload.secret !== makeSecret) {
    return { statusCode: 401, body: "Unauthorized" };
  }

  const { business_name, owner_name, feedback_email, google_review_url, slug } = payload;
  if (!business_name || !slug || !google_review_url) {
    return { statusCode: 400, body: "Missing required fields" };
  }

  const html = buildReviewPageHTML(business_name, google_review_url, null);
  const base64Content = Buffer.from(html).toString("base64");
  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepo = process.env.GITHUB_REPO || "john-hankerd/1to5reviewz-pages";
  const filePath = `r/${slug}/index.html`;

  const githubBody = JSON.stringify({
    message: `Add review page for ${business_name} (${slug})`,
    content: base64Content,
  });

  const githubOptions = {
    hostname: "api.github.com",
    path: `/repos/${githubRepo}/contents/${filePath}`,
    method: "PUT",
    headers: {
      Authorization: `token ${githubToken}`,
      "Content-Type": "application/json",
      "User-Agent": "all5starz-netlify-function",
      Accept: "application/vnd.github.v3+json",
    },
  };

  try {
    const githubResult = await httpsRequest(githubOptions, githubBody);
    if (githubResult.status !== 201 && githubResult.status !== 200) {
      console.error("GitHub error:", githubResult.body);
      return { statusCode: 500, body: `GitHub failed: ${githubResult.status}` };
    }
  } catch (err) {
    return { statusCode: 500, body: `GitHub request failed: ${err.message}` };
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey && feedback_email) {
    const emailHtml = buildWelcomeEmail(business_name, owner_name || "there", slug);
    const emailBody = JSON.stringify({
      from: "All5Starz <info@all5starz.com>",
      to: [feedback_email],
      subject: `Your All5Starz review page is live — ${business_name}`,
      html: emailHtml,
    });
    const emailOptions = {
      hostname: "api.resend.com",
      path: "/emails",
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
    };
    try {
      const emailResult = await httpsRequest(emailOptions, emailBody);
      if (emailResult.status !== 200 && emailResult.status !== 201) {
        console.warn("Email warning:", emailResult.status, emailResult.body);
      }
    } catch (err) {
      console.warn("Email failed:", err.message);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      slug,
      review_page: `https://1to5reviewz.com/r/${slug}`,
    }),
  };
};
