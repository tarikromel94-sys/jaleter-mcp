# Jaleter Brand Style Guide
*The definitive reference for jaleter.com and all Jaleter web/print collateral.*

**Brand promise:** *Smart Budgeting. Wealthy Living.*
**Personality:** Quiet luxury · Faith-inspired · Trustworthy · Timeless

---

## 1. Color Palette

### Primary Golds — the signature "Jaleter gold"
| Role                | Hex        | Preview | Usage                                            |
|---------------------|------------|---------|--------------------------------------------------|
| Gold Light          | `#EED7AB` | ▮▮▮▮▮ | Headings on dark, decorative accents             |
| Gold Bright         | `#F4D28F` | ▮▮▮▮▮ | CTA gradient — start color                        |
| Gold Deep           | `#DEAA55` | ▮▮▮▮▮ | CTA gradient — end color, links on dark          |
| Gold Rich           | `#A57537` | ▮▮▮▮▮ | Icon accents, checkmarks                          |
| Gold Muted          | `#CDA86D` | ▮▮▮▮▮ | Eyebrow labels, muted metadata                    |

### Neutrals — the "quiet luxury" foundation
| Role                | Hex        | Usage                                             |
|---------------------|------------|---------------------------------------------------|
| Ink Black           | `#090908` | Primary background (dark theme), CTA text         |
| Ink Warm            | `#151411` | Card backgrounds on dark                          |
| Cream Base          | `#FBF6EC` | Primary background (light theme)                  |
| Cream Warm          | `#F5EDE0` | Section backgrounds, cards                        |
| Ink Muted           | `#615B52` | Body text on light                                |
| Ink Soft            | `#8E8A83` | Secondary text                                    |
| Ink Whisper         | `#AAA298` | Tertiary text, captions                           |

### Utility Colors
| Role                | Hex        | Usage                                             |
|---------------------|------------|---------------------------------------------------|
| Sage Success        | `#8FA88F` | Confirmations, "Active" badges                    |
| Rose Warning        | `#D69A7B` | Budget warnings, alerts                           |
| Divider             | `#E8DCC4` | Hairlines, card borders                           |

---

## 2. Typography

### Fonts — load these once in your WordPress `<head>` or Elementor Global Fonts:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
```

| Element               | Font              | Weight | Size (desktop) | Letter-spacing  | Case      |
|-----------------------|-------------------|--------|----------------|-----------------|-----------|
| Wordmark "Jaleter"    | Playfair Display  | 400    | 58–62 px       | 0               | Title     |
| H1 Hero               | Playfair Display  | 500    | 42–56 px       | -0.5 px         | Title     |
| H2 Section            | Playfair Display  | 500    | 30–36 px       | -0.3 px         | Title     |
| H3 Subsection        | Inter             | 700    | 18–22 px       | -0.2 px         | Sentence  |
| Eyebrow / Label       | Inter             | 700    | 10–11 px       | 2.8 px (0.28em) | UPPER     |
| Body                  | Inter             | 400    | 14–16 px       | 0               | Sentence  |
| Small / Caption       | Inter             | 500    | 11–12 px       | 0               | Sentence  |
| Button                | Inter             | 600    | 14–15 px       | -0.01em         | Title     |

### Voice & Tone Examples

- **DO:** *"Steward today. Build tomorrow."* / *"Smart budgeting. Wealthy living."* / *"Every decision, a step toward legacy."*
- **DO:** Speak with warmth + gravitas. Short. Purposeful. Faith-adjacent without being preachy.
- **DON'T:** *"Sign up now to get 30% off!"* / *"Click here for the best deal!"* — no urgency-hype language.
- **DON'T:** Overuse jargon like "monetize," "leverage," "synergy."

---

## 3. Signature UI Patterns

### 3.1 Gold CTA Button (primary)
```css
.jaleter-cta-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 16px 32px;
  min-height: 52px;
  border-radius: 999px;
  background: linear-gradient(135deg, #F4D28F 0%, #DEAA55 100%);
  color: #090908;
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 15px;
  letter-spacing: -0.01em;
  border: 0;
  box-shadow: 0 4px 20px rgba(222, 170, 85, 0.15);
  text-decoration: none;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.jaleter-cta-primary:hover  { box-shadow: 0 6px 24px rgba(222, 170, 85, 0.25); }
.jaleter-cta-primary:active { transform: scale(0.97); }
```

### 3.2 Ghost / Outline Button (secondary)
```css
.jaleter-cta-ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 14px 28px;
  min-height: 48px;
  border-radius: 999px;
  background: transparent;
  color: #DEAA55;
  border: 1px solid #DEAA5544;
  font-family: 'Inter', sans-serif;
  font-weight: 500;
  font-size: 14px;
  text-decoration: none;
  transition: border-color 120ms ease, background 120ms ease;
}
.jaleter-cta-ghost:hover { border-color: #DEAA55; background: rgba(222, 170, 85, 0.06); }
```

### 3.3 Pricing Card
```css
.jaleter-price-card {
  background: #FBF6EC;
  border: 1px solid #E8DCC4;
  border-radius: 20px;
  padding: 28px 24px;
  max-width: 380px;
}
.jaleter-price-card .eyebrow {
  color: #A57537;
  font-family: 'Inter';
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  margin-bottom: 8px;
}
.jaleter-price-card .price {
  font-family: 'Playfair Display', serif;
  font-weight: 500;
  color: #090908;
  font-size: 44px;
  line-height: 1;
  margin-bottom: 4px;
}
.jaleter-price-card .price-suffix {
  color: #8E8A83;
  font-family: 'Inter';
  font-size: 14px;
  font-weight: 500;
}
.jaleter-price-card ul { list-style: none; padding: 0; margin: 20px 0; }
.jaleter-price-card li {
  color: #615B52;
  font-family: 'Inter';
  font-size: 14px;
  padding: 6px 0 6px 24px;
  position: relative;
}
.jaleter-price-card li::before {
  content: "✓";
  position: absolute;
  left: 0;
  color: #A57537;
  font-weight: 700;
}
```

### 3.4 Eyebrow Label (over headings)
```css
.jaleter-eyebrow {
  font-family: 'Inter', sans-serif;
  color: #A57537;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  margin-bottom: 12px;
  display: block;
}
```

---

## 4. Spacing System (8-point grid)

Use multiples of 8: `8, 16, 24, 32, 48, 64, 96, 128 px`.

| Element               | Padding/Margin |
|-----------------------|----------------|
| Section vertical      | 96–128 px      |
| Card interior         | 24–32 px       |
| Button interior       | 16 × 32 px     |
| Between form fields   | 16 px          |
| Between paragraphs    | 16 px          |
| Content max-width     | 1160 px        |

---

## 5. Iconography

Use **Ionicons** (free, matches mobile app) via CDN:
```html
<script type="module" src="https://unpkg.com/ionicons@7/dist/ionicons/ionicons.esm.js"></script>
<script nomodule src="https://unpkg.com/ionicons@7/dist/ionicons/ionicons.js"></script>
```
Then in HTML: `<ion-icon name="checkmark" style="color:#A57537;"></ion-icon>`

**Recommended icons for Jaleter:**
- `chatbubble-outline` → Coaching
- `sparkles-outline` → Premium / Membership
- `trophy-outline` → Legacy
- `wallet-outline` → Budgeting
- `shield-checkmark-outline` → Security / Trust
- `mail-outline` → Contact
- `logo-instagram`, `logo-facebook` → Social

---

## 6. Photography & Imagery

- **Style:** Warm, natural light. Golden hour. Neutral tones (cream, taupe, deep brown, olive).
- **Never:** Cool blue office stock photos. Neon anything. Cartoon illustrations.
- **Great sources (free):** [Unsplash — search "warm light woman journaling"](https://unsplash.com), [Pexels](https://pexels.com)
- **Suggested imagery:**
  - Client testimonial: candid portrait, natural window light
  - Danyell's headshot: neutral background, soft light, warm expression
  - Hero: abstract gold ribbon/silk texture OR aerial shot of ocean/gold sunset

---

## 7. Website Structure (jaleter.com)

Recommended page order:

1. **/  (Home)** — Hero + tagline + primary CTA "Book Coaching"
2. **/coaching** — Coaching details, book & pay button ($50)
3. **/membership** — Membership benefits, subscribe button ($75/yr)
4. **/about** — Danyell's story, faith-forward mission
5. **/blog** *(optional)* — SEO + client education
6. **/contact** — Simple form + Calendly embed

**Footer on every page:**
- Small Jaleter wordmark
- 3-column links (Company · Legal · Contact)
- Copyright · social icons
- Muted background `#151411`, text `#8E8A83`, gold hover `#DEAA55`

---

## 8. Stripe Payment Link Integration (drop-in method)

1. In your Stripe Dashboard → **Products** → create:
   - "Jaleter Coaching Session" — $50, one-time
   - "Jaleter Premium Membership" — $75/year, recurring
2. For each, click **Create payment link**. Stripe gives you a URL like `https://buy.stripe.com/xxxxxxxx`.
3. In WordPress, wrap ANY styled button around that URL:
   ```html
   <a href="https://buy.stripe.com/YOUR_LINK" class="jaleter-cta-primary">
     Book Coaching — $50
   </a>
   ```
4. Optional: turn on **Custom domain** in Stripe (pro plan) so URL shows `pay.jaleter.com` — extra branded touch.

---

## 9. WordPress-Specific Tips

- **Theme:** Astra (free) or Kadence (free) — both work perfectly with these styles
- **Page Builder:** Elementor free tier is enough; upgrade to Pro only if you need advanced motion
- **Global colors in Elementor:** Site Settings → Global Colors → paste hex values above
- **Global fonts in Elementor:** Site Settings → Global Fonts → set Primary = Inter, Secondary = Playfair Display
- **Custom CSS location:** Appearance → Customize → Additional CSS — paste snippets from Section 3
- **Speed matters:** Compress images with [ShortPixel](https://shortpixel.com) or [Squoosh](https://squoosh.app); enable caching via WP Rocket or free LiteSpeed Cache

---

## 10. Accessibility

- **Contrast:** All gold-on-black passes WCAG AA. Gold-on-cream: ensure body text uses `#615B52` or darker.
- **Focus states:** Every button + link must have visible focus (a 2px `#DEAA55` outline works beautifully).
- **Alt text:** Every image needs meaningful alt text ("Danyell smiling in a warm-lit home office" not "danyell.jpg").
- **Tap targets:** Minimum 44 × 44 px on mobile.

---

## 11. Do & Don't Cheat Sheet

| ✅ Do                                       | 🚫 Don't                                     |
|---------------------------------------------|---------------------------------------------|
| Use Playfair Display for headings           | Use Comic Sans, Papyrus, or trendy scripts  |
| Warm creams + rich golds                    | Bright saturated blues/reds                 |
| Generous white space                        | Cluttered "kitchen-sink" layouts            |
| Sentence-case body, TITLE CASE eyebrows     | ALL CAPS BODY COPY                          |
| Subtle gold gradient CTAs                   | Neon-glow / drop-shadow overload            |
| Real client photos, warm-toned              | Cool corporate stock photos                 |
| One primary CTA per page                    | Multiple competing buttons                  |

---

## 12. Handoff Checklist for Your WordPress Designer

Give them this guide + these assets:

- [ ] Google Fonts embed code (Section 2)
- [ ] Colors added to WordPress Global Colors (Section 1)
- [ ] Fonts added to WordPress Global Fonts (Section 2)
- [ ] CTA button CSS in Additional CSS (Section 3.1)
- [ ] Pricing card CSS in Additional CSS (Section 3.3)
- [ ] Stripe payment links created (Section 8)
- [ ] Home page uses Playfair "Jaleter" wordmark hero
- [ ] Footer matches spec (Section 7)
- [ ] Icons load Ionicons CDN (Section 5)

---

*Prepared for Jaleter · Version 1.0 · June 2026*
*This guide is meant to evolve — update it as the brand grows.*
