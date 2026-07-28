# Jaleter — Billing Website Package

Two files for building the billing/marketing site at **jaleter.com**.

---

## 📦 What's Inside

### 1. `JALETER_WORDPRESS_LANDING.html`
A ready-to-paste HTML landing page.  Drop it into any WordPress "Custom HTML" block (Gutenberg) or "HTML" widget (Elementor).

Includes:
- Animated gold-glass ribbon hero (matches the mobile app Welcome screen)
- Playfair Display "Jaleter" wordmark + tagline
- Feature grid (Honest Budgeting · Legacy Planning · Private Coaching · Bank-Independent Privacy)
- Scripture quote strip (1 Corinthians 14:40)
- Two branded pricing cards (Coaching $50 · Membership $75/yr)
- Final CTA section
- Dark footer with links

### 2. `JALETER_BRAND_STYLE_GUIDE.md`
The definitive Jaleter brand reference — colors, typography, spacing, iconography, voice, and reusable CSS snippets.  Share with your WordPress designer or use it yourself.

---

## 🛠️ Quick Start (10 minutes)

### Step 1 — Create Stripe Payment Links
1. Log into https://dashboard.stripe.com
2. Products → +Add Product → create:
   - "Jaleter Coaching Session" — $50 one-time
   - "Jaleter Premium Membership" — $75/year recurring
3. For each, click "Create Payment Link" and copy the URL (looks like `https://buy.stripe.com/xxxxxxxx`)

### Step 2 — Copy your Calendly URL
Grab the public URL of your Calendly page (e.g. `https://calendly.com/jaleter/coaching`)

### Step 3 — Update the three placeholders in the HTML file
Open `JALETER_WORDPRESS_LANDING.html` and Find/Replace:

| Find                    | Replace With                          |
|-------------------------|---------------------------------------|
| `COACHING_STRIPE_LINK`  | your Coaching Payment Link URL        |
| `MEMBERSHIP_STRIPE_LINK`| your Membership Payment Link URL      |
| `CALENDLY_LINK`         | your Calendly URL                     |

### Step 4 — Paste into WordPress
1. WordPress admin → Pages → Add New → name it "Jaleter"
2. Add a **Custom HTML** block (Gutenberg) or **HTML** widget (Elementor)
3. Paste EVERYTHING in the HTML file between the `<!-- START -->` and `<!-- END -->` markers
4. Publish
5. Settings → Reading → "Your homepage displays a static page" → select "Jaleter"

Done — jaleter.com now shows the branded landing page.

---

## 💡 Tips

- The animated canvas needs modern browsers (Chrome/Safari/Firefox 90+) — falls back gracefully on older browsers
- The CSS is scoped under `.jaleter-page` so it won't conflict with your WordPress theme
- Google Fonts (Playfair Display + Inter) and Ionicons load automatically from CDN
- Mobile-responsive out of the box — try it in browser dev tools mobile view

---

## 🎨 Want to Customize?

The Brand Style Guide has all the colors, fonts, and CSS snippets.  Common tweaks:

- Change the tagline: search for `SMART BUDGETING · WEALTHY LIVING` in the HTML
- Change the scripture quote: search for `Let all things be done`
- Add/remove pricing card bullets: search for `<ul>` inside the pricing section
- Change footer links: search for `Company`, `Services`, `Legal` sections at the bottom

---

Prepared for Jaleter · June 2026
