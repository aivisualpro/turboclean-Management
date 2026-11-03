/**
 * "Missing Photos" V1 — HTML inventory-report email, rebuilt from
 * "UPDATED HTML BODY EMAIL INVENTORY REPORT TEMPLATE" (Shams Zia, Oct 11 2026).
 *
 * Email-safe: table layout, inline styles, 600px. Numbers come from the dealership's latest
 * inventory audit; the evidence screenshot is the audit's screenshot (sent inline as cid:audit-shot).
 * Sender block comes from the sender's profile (CRM → Email → Settings).
 */
export const MISSING_PHOTOS_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>Inventory review — {{dealership}}</title>
</head>
<body style="margin:0;padding:0;background:#eceeed;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{{usedMissingPhotos}} of {{usedTotal}} visible pre-owned listings at {{dealership}} were missing photos on {{auditDate}}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eceeed;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;font-family:Helvetica,Arial,sans-serif;">

  <!-- Brand bar -->
  <tr><td style="background:#1e2523;padding:28px 40px;border-bottom:3px solid #22c55e;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:22px;font-weight:700;letter-spacing:3px;color:#ffffff;">ZRZ <span style="color:#86efac;">OPS</span></td>
      <td align="right" style="font-size:10px;font-weight:700;letter-spacing:2.5px;color:#d1d5db;line-height:15px;">RECONDITIONING<br>&amp; INVENTORY OPERATIONS</td>
    </tr></table>
  </td></tr>

  <!-- Hero -->
  <tr><td style="background:#1e2523;padding:36px 40px 40px;">
    <p style="margin:0 0 18px;font-size:11px;font-weight:700;letter-spacing:2.5px;color:#86efac;">INVENTORY REVIEW / {{auditDateUpper}}</p>
    <h1 style="margin:0 0 22px;font-size:40px;line-height:46px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">{{usedMissingPhotos}} vehicles.<br><span style="color:#86efac;">Missing photos.</span><br>One fixable gap.</h1>
    <p style="margin:0;font-size:16px;line-height:25px;color:#e5e7eb;">We reviewed your publicly listed pre-owned inventory and identified vehicles with missing photos. Here's what stood out&mdash;and how ZRZ OPS helps dealership teams close these gaps.</p>
  </td></tr>

  <!-- At a glance -->
  <tr><td style="padding:36px 40px 8px;">
    <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2.5px;color:#15803d;">YOUR INVENTORY, AT A GLANCE</p>
    <h2 style="margin:0 0 20px;font-size:24px;line-height:30px;font-weight:800;color:#111827;">A visible gap in your online inventory.</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="33%" align="center" style="background:#eef7f1;padding:22px 8px;">
        <div style="font-size:38px;line-height:42px;font-weight:800;color:#111827;">{{usedTotal}}</div>
        <div style="margin-top:8px;font-size:11px;line-height:15px;font-weight:700;letter-spacing:.5px;color:#4b5563;">VISIBLE USED<br>VEHICLES</div>
      </td>
      <td width="4" style="font-size:0;">&nbsp;</td>
      <td width="33%" align="center" style="background:#e3f3e9;padding:22px 8px;">
        <div style="font-size:38px;line-height:42px;font-weight:800;color:#15803d;">{{usedMissingPhotos}}</div>
        <div style="margin-top:8px;font-size:11px;line-height:15px;font-weight:700;letter-spacing:.5px;color:#4b5563;">LISTINGS FLAGGED<br>FOR PHOTOS</div>
      </td>
      <td width="4" style="font-size:0;">&nbsp;</td>
      <td width="33%" align="center" style="background:#cdeedb;padding:22px 8px;">
        <div style="font-size:38px;line-height:42px;font-weight:800;color:#15803d;">{{usedMissingPhotoPct}}</div>
        <div style="margin-top:8px;font-size:11px;line-height:15px;font-weight:700;letter-spacing:.5px;color:#4b5563;">OF VISIBLE USED<br>INVENTORY</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- Evidence -->
  <tr><td style="padding:20px 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #d1e7d9;background:#f4faf6;">
      <tr><td style="padding:16px 16px 10px;font-size:11px;font-weight:700;letter-spacing:2px;color:#15803d;">EVIDENCE / DEALERSHIP WEBSITE REVIEW</td></tr>
      <tr><td style="padding:0 16px;">{{auditScreenshot}}</td></tr>
      <tr><td style="padding:12px 16px 16px;font-size:13px;line-height:20px;color:#4b5563;"><strong style="color:#111827;">Audit finding:</strong> {{usedMissingPhotos}} of {{usedTotal}} visible pre-owned listings were identified as missing photos during our {{auditDate}} review. Screenshot shows the dealership inventory website used in the review; it does not individually document all {{usedMissingPhotos}} listings.</td></tr>
    </table>
  </td></tr>

  <!-- Why it matters -->
  <tr><td style="padding:24px 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="border-left:4px solid #22c55e;background:#eef7f1;padding:18px 20px;font-size:15px;line-height:23px;color:#374151;"><strong style="color:#111827;">Why this matters:</strong> A vehicle without a complete photo presentation may be harder for shoppers to evaluate. Some gaps are unavoidable, but others come down to process, ownership, and follow-through.</td>
    </tr></table>
    <p style="margin:12px 0 28px;font-size:12px;line-height:17px;color:#6b7280;">Snapshot of publicly visible inventory on {{auditDate}}. Counts can change as listings are updated.</p>
  </td></tr>

  <!-- What we do -->
  <tr><td style="background:#eef7f1;padding:36px 40px;">
    <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:2.5px;color:#15803d;">WHAT ZRZ OPS DOES DIFFERENTLY</p>
    <h2 style="margin:0 0 22px;font-size:26px;line-height:32px;font-weight:800;color:#111827;">We don't just detail cars.<br>We help keep inventory moving.</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td width="44" valign="top" style="padding-bottom:18px;"><div style="width:36px;height:36px;line-height:36px;background:#15803d;color:#ffffff;font-size:13px;font-weight:700;text-align:center;">01</div></td>
        <td valign="top" style="padding:0 0 18px 12px;"><div style="font-size:16px;font-weight:700;color:#111827;">RECON &mdash; Get vehicles ready</div><div style="margin-top:3px;font-size:14px;line-height:21px;color:#4b5563;">Coordinate detailing and vehicle preparation to reduce avoidable handoff delays.</div></td></tr>
      <tr><td width="44" valign="top" style="padding-bottom:18px;"><div style="width:36px;height:36px;line-height:36px;background:#15803d;color:#ffffff;font-size:13px;font-weight:700;text-align:center;">02</div></td>
        <td valign="top" style="padding:0 0 18px 12px;"><div style="font-size:16px;font-weight:700;color:#111827;">MERCHANDISE &mdash; Get vehicles online</div><div style="margin-top:3px;font-size:14px;line-height:21px;color:#4b5563;">Capture photos and support merchandising so inventory can be presented promptly.</div></td></tr>
      <tr><td width="44" valign="top"><div style="width:36px;height:36px;line-height:36px;background:#15803d;color:#ffffff;font-size:13px;font-weight:700;text-align:center;">03</div></td>
        <td valign="top" style="padding:0 0 0 12px;"><div style="font-size:16px;font-weight:700;color:#111827;">MONITOR &mdash; Catch what's missing</div><div style="margin-top:3px;font-size:14px;line-height:21px;color:#4b5563;">Review online listings, flag gaps, and communicate issues before they sit unresolved.</div></td></tr>
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:40px 40px 40px;">
    <h2 style="margin:0 0 14px;font-size:26px;line-height:32px;font-weight:800;color:#111827;">Would a 10-minute conversation be worth it?</h2>
    <p style="margin:0 0 24px;font-size:15px;line-height:24px;color:#4b5563;">I can walk you through what we found, which gaps may be controllable, and how our team approaches recon, photos, and inventory follow-up across dealership operations.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#15803d;">
      <a href="{{replyMailto}}" style="display:inline-block;padding:15px 26px;font-size:14px;font-weight:700;letter-spacing:.3px;color:#ffffff;text-decoration:none;">REPLY TO SCHEDULE A 10-MINUTE REVIEW &rarr;</a>
    </td></tr></table>
    <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">Or simply reply to this email with a good time to connect.</p>
  </td></tr>

  <!-- Point of contact -->
  <tr><td style="background:#1e2523;padding:32px 40px;">
    <p style="margin:0 0 12px;font-size:11px;font-weight:700;letter-spacing:2.5px;color:#86efac;">YOUR POINT OF CONTACT</p>
    <p style="margin:0;font-size:24px;font-weight:800;color:#ffffff;">{{senderName}}</p>
    <p style="margin:6px 0 18px;font-size:13px;color:#d1d5db;">{{senderTitle|Owner}} <span style="color:#22c55e;">|</span> {{senderCompany}}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #3b4442;">
      <tr><td style="padding-top:16px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="font-size:11px;letter-spacing:1px;color:#9ca3af;padding:0 16px 6px 0;">DIRECT</td><td style="font-size:14px;color:#ffffff;padding-bottom:6px;">{{senderPhone}}</td></tr>
          <tr><td style="font-size:11px;letter-spacing:1px;color:#9ca3af;padding:0 16px 0 0;">EMAIL</td><td style="font-size:14px;"><a href="mailto:{{senderEmail}}" style="color:#ffffff;">{{senderEmail}}</a></td></tr>
        </table>
        <p style="margin:18px 0 0;font-size:11px;letter-spacing:.5px;color:#9ca3af;">{{senderTagline|DEALERSHIP RECONDITIONING · INVENTORY MERCHANDISING · MONITORING}}</p>
        <p style="margin:4px 0 0;font-size:11px;color:#9ca3af;">{{senderRegion|Connecticut & Massachusetts}}</p>
      </td></tr>
    </table>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`

/**
 * "Missing Photos" V2 — the premium inventory report (2026-11-03).
 *
 * Built on the V1 design, upgraded for the Inventory Scanner (no screenshot needed):
 * personal hero, KPI cards, a "with / without real photos" bar, what-we-found breakdown, a clickable
 * spot-check list of real listings (the evidence), the ZRZ OPS method, a bulletproof CTA (Outlook
 * VML) and an honest footer with an easy opt-out. Mobile: cards stack, type scales down.
 * Blocks ({{usedPhotoBar}}, {{auditBreakdown}}, {{auditEvidence}}, {{newInventoryNote}}) render
 * from the latest audit and disappear when there is no data.
 */
export const MISSING_PHOTOS_HTML_V2 = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>{{dealership}} — inventory photo review</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
  @media only screen and (max-width:620px) {
    .container { width:100% !important; }
    .px { padding-left:22px !important; padding-right:22px !important; }
    .hero-h1 { font-size:34px !important; line-height:39px !important; }
    .h2 { font-size:22px !important; line-height:28px !important; }
    .stack { display:block !important; width:100% !important; box-sizing:border-box; }
    .stack-gap { display:block !important; width:100% !important; height:10px !important; }
    .kpi-num { font-size:34px !important; line-height:38px !important; }
    .hide-sm { display:none !important; }
    .btn a { display:block !important; text-align:center !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#eef1ef;word-spacing:normal;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">{{usedMissingPhotos}} of {{usedTotal}} pre-owned listings at {{dealership}} had no real photo on {{auditDate}} — here are a few you can check yourself.&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1ef;">
<tr><td align="center" style="padding:28px 12px 40px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <!-- Brand bar -->
  <tr><td class="px" style="background:#0e1714;padding:22px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:20px;font-weight:800;letter-spacing:4px;color:#ffffff;">ZRZ<span style="color:#4ade80;">&nbsp;OPS</span></td>
      <td align="right" class="hide-sm" style="font-size:10px;font-weight:700;letter-spacing:2.4px;color:#9fb3ab;">INVENTORY PHOTO REVIEW</td>
    </tr></table>
  </td></tr>
  <tr><td style="height:3px;line-height:3px;font-size:0;background:#22c55e;">&nbsp;</td></tr>

  <!-- Hero -->
  <tr><td class="px" style="background:#0e1714;padding:40px 40px 44px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#173026;border:1px solid #24493a;border-radius:999px;padding:6px 12px;font-size:11px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#86efac;">PREPARED FOR {{dealership}} &nbsp;&middot;&nbsp; {{auditDateUpper}}</td></tr></table>
    <h1 class="hero-h1" style="margin:22px 0 0;font-size:44px;line-height:49px;font-weight:800;letter-spacing:-1px;color:#ffffff;">{{usedMissingPhotos}} pre-owned cars.<br><span style="color:#4ade80;">No real photos.</span><br>We fix that for you.</h1>
    <p style="margin:22px 0 0;font-size:16px;line-height:26px;color:#c9d6d0;">Hi {{firstName|there}} &mdash; we went through every pre-owned listing on <span style="color:#ffffff;">{{website}}</span> the way a shopper does. {{usedMissingPhotos}} of them have no real photo of the actual car. That&rsquo;s inventory you paid for that is hard to sell online &mdash; and it&rsquo;s exactly the problem ZRZ OPS takes off your team&rsquo;s plate.</p>
  </td></tr>

  <!-- At a glance -->
  <tr><td class="px" style="padding:40px 40px 0;">
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2.2px;color:#15803d;">YOUR INVENTORY, AT A GLANCE</p>
    <h2 class="h2" style="margin:0 0 22px;font-size:26px;line-height:32px;font-weight:800;letter-spacing:-.4px;color:#101828;">A visible gap in your online showroom.</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="stack" width="32%" valign="top" style="background:#f6f8f7;border:1px solid #e4e9e6;border-top:3px solid #98a2b3;border-radius:12px;padding:18px 16px;">
        <div class="kpi-num" style="font-size:38px;line-height:42px;font-weight:800;letter-spacing:-1px;color:#101828;">{{usedTotal}}</div>
        <div style="margin-top:6px;font-size:11px;line-height:15px;font-weight:700;letter-spacing:.8px;color:#667085;">PRE-OWNED LISTINGS REVIEWED</div>
      </td>
      <td class="stack-gap" width="2%" style="font-size:0;line-height:0;">&nbsp;</td>
      <td class="stack" width="32%" valign="top" style="background:#fff5f5;border:1px solid #fbd5d5;border-top:3px solid #e5484d;border-radius:12px;padding:18px 16px;">
        <div class="kpi-num" style="font-size:38px;line-height:42px;font-weight:800;letter-spacing:-1px;color:#c62a2f;">{{usedMissingPhotos}}</div>
        <div style="margin-top:6px;font-size:11px;line-height:15px;font-weight:700;letter-spacing:.8px;color:#667085;">WITHOUT A REAL PHOTO</div>
      </td>
      <td class="stack-gap" width="2%" style="font-size:0;line-height:0;">&nbsp;</td>
      <td class="stack" width="32%" valign="top" style="background:#effaf3;border:1px solid #cdeedb;border-top:3px solid #16a34a;border-radius:12px;padding:18px 16px;">
        <div class="kpi-num" style="font-size:38px;line-height:42px;font-weight:800;letter-spacing:-1px;color:#15803d;">{{usedMissingPhotoPct}}</div>
        <div style="margin-top:6px;font-size:11px;line-height:15px;font-weight:700;letter-spacing:.8px;color:#667085;">OF YOUR PRE-OWNED INVENTORY</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td class="px" style="padding:22px 40px 0;">{{usedPhotoBar}}</td></tr>
  <tr><td class="px" style="padding:18px 40px 0;">{{auditBreakdown}}</td></tr>
  <tr><td class="px" style="padding:12px 40px 0;">{{newInventoryNote}}</td></tr>

  <!-- Evidence -->
  <tr><td class="px" style="padding:26px 40px 0;">{{auditEvidence}}</td></tr>

  <!-- Why it matters -->
  <tr><td class="px" style="padding:26px 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="border-left:4px solid #e5484d;background:#fff7f7;border-radius:0 10px 10px 0;padding:18px 20px;font-size:15px;line-height:24px;color:#344054;"><strong style="color:#101828;">What it&rsquo;s costing you:</strong> online, the photo <em>is</em> the first test drive. Shoppers scroll past listings they can&rsquo;t see, so these cars get fewer leads, sit longer and keep adding holding cost every day they wait. It&rsquo;s rarely a people problem &mdash; it&rsquo;s a handoff between recon, photos and the website that nobody owns.</td>
    </tr></table>
    <p style="margin:12px 0 0;font-size:12px;line-height:18px;color:#98a2b3;">Snapshot of publicly visible listings on {{auditDate}}. Counts change as your inventory is updated.</p>
  </td></tr>

  <!-- Method -->
  <tr><td class="px" style="padding:40px 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0e1714;border-radius:14px;">
      <tr><td style="padding:30px 28px 8px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:2.2px;color:#86efac;">WHAT ZRZ OPS DOES DIFFERENTLY</p>
        <h2 class="h2" style="margin:0 0 20px;font-size:24px;line-height:30px;font-weight:800;letter-spacing:-.3px;color:#ffffff;">One partner owns the gap &mdash;<br>from recon to a live listing.</h2>
      </td></tr>
      <tr><td style="padding:0 28px 6px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td width="46" valign="top" style="padding:0 0 18px;"><div style="width:34px;height:34px;line-height:34px;border-radius:9px;background:#22c55e;color:#0e1714;font-size:13px;font-weight:800;text-align:center;">01</div></td>
            <td valign="top" style="padding:0 0 18px 4px;"><div style="font-size:15px;font-weight:700;color:#ffffff;">Recon &mdash; get vehicles front-line ready</div><div style="margin-top:3px;font-size:14px;line-height:21px;color:#a9bbb3;">Detailing and preparation coordinated so cars don&rsquo;t stall between handoffs.</div></td></tr>
          <tr><td width="46" valign="top" style="padding:0 0 18px;"><div style="width:34px;height:34px;line-height:34px;border-radius:9px;background:#22c55e;color:#0e1714;font-size:13px;font-weight:800;text-align:center;">02</div></td>
            <td valign="top" style="padding:0 0 18px 4px;"><div style="font-size:15px;font-weight:700;color:#ffffff;">Merchandise &mdash; real photos, online fast</div><div style="margin-top:3px;font-size:14px;line-height:21px;color:#a9bbb3;">We capture and publish real photos so every car is presented the day it&rsquo;s ready.</div></td></tr>
          <tr><td width="46" valign="top" style="padding:0 0 24px;"><div style="width:34px;height:34px;line-height:34px;border-radius:9px;background:#22c55e;color:#0e1714;font-size:13px;font-weight:800;text-align:center;">03</div></td>
            <td valign="top" style="padding:0 0 24px 4px;"><div style="font-size:15px;font-weight:700;color:#ffffff;">Monitor &mdash; catch what&rsquo;s missing</div><div style="margin-top:3px;font-size:14px;line-height:21px;color:#a9bbb3;">We review your live listings and flag gaps like these before they sit unresolved.</div></td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  <!-- How it works -->
  <tr><td class="px" style="padding:40px 40px 0;">
    <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:2.2px;color:#15803d;">HOW IT WORKS</p>
    <h2 class="h2" style="margin:0 0 20px;font-size:26px;line-height:32px;font-weight:800;letter-spacing:-.4px;color:#101828;">Three steps. Your team does none of the legwork.</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td class="stack" width="32%" valign="top" style="border:1px solid #eaecf0;border-radius:12px;padding:18px 16px;">
          <div style="font-size:12px;font-weight:800;color:#16a34a;">STEP 1</div>
          <div style="margin-top:6px;font-size:15px;line-height:20px;font-weight:700;color:#101828;">10-minute call</div>
          <div style="margin-top:4px;font-size:13px;line-height:19px;color:#667085;">We walk through the full list together and agree what to fix first.</div>
        </td>
        <td class="stack-gap" width="2%" style="font-size:0;line-height:0;">&nbsp;</td>
        <td class="stack" width="32%" valign="top" style="border:1px solid #eaecf0;border-radius:12px;padding:18px 16px;">
          <div style="font-size:12px;font-weight:800;color:#16a34a;">STEP 2</div>
          <div style="margin-top:6px;font-size:15px;line-height:20px;font-weight:700;color:#101828;">We get them online</div>
          <div style="margin-top:4px;font-size:13px;line-height:19px;color:#667085;">Recon where needed, real photos of every car, listings updated.</div>
        </td>
        <td class="stack-gap" width="2%" style="font-size:0;line-height:0;">&nbsp;</td>
        <td class="stack" width="32%" valign="top" style="border:1px solid #eaecf0;border-radius:12px;padding:18px 16px;">
          <div style="font-size:12px;font-weight:800;color:#16a34a;">STEP 3</div>
          <div style="margin-top:6px;font-size:15px;line-height:20px;font-weight:700;color:#101828;">Proof every week</div>
          <div style="margin-top:4px;font-size:13px;line-height:19px;color:#667085;">We re-check your site and show you the gap closing &mdash; car by car.</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td class="px" style="padding:36px 40px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#effaf3;border:1px solid #cdeedb;border-radius:14px;"><tr><td style="padding:28px 26px;">
      <h2 class="h2" style="margin:0 0 10px;font-size:24px;line-height:30px;font-weight:800;letter-spacing:-.4px;color:#101828;">Want us to start with these {{usedMissingPhotos}} cars?</h2>
      <p style="margin:0 0 22px;font-size:15px;line-height:24px;color:#475467;">Give me 10 minutes. I&rsquo;ll bring the full list, show you which gaps are quickest to close, and how we&rsquo;d handle recon, photos and listing follow-up for {{dealership}}.</p>
      <table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:10px;background:#16a34a;">
        <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="{{replyMailto}}" style="height:50px;v-text-anchor:middle;width:330px;" arcsize="20%" stroke="f" fillcolor="#16a34a"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">Yes &mdash; let&rsquo;s talk for 10 minutes &rarr;</center></v:roundrect><![endif]-->
        <!--[if !mso]><!--><a href="{{replyMailto}}" style="display:inline-block;padding:16px 28px;border-radius:10px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">Yes &mdash; let&rsquo;s talk for 10 minutes &rarr;</a><!--<![endif]-->
      </td></tr></table>
      <p style="margin:16px 0 0;font-size:13px;line-height:20px;color:#667085;">Or just reply with a good time &mdash; I&rsquo;ll send the full list either way, no strings attached.</p>
    </td></tr></table>
  </td></tr>

  <!-- Signature -->
  <tr><td class="px" style="padding:32px 40px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eaecf0;"><tr><td style="padding-top:26px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="52" valign="top"><div style="width:44px;height:44px;line-height:44px;border-radius:22px;background:#0e1714;color:#4ade80;font-size:16px;font-weight:800;text-align:center;">{{senderInitials|ZO}}</div></td>
        <td valign="top" style="padding-left:12px;">
          <div style="font-size:17px;font-weight:800;color:#101828;">{{senderName}}</div>
          <div style="margin-top:2px;font-size:13px;color:#667085;">{{senderTitle|Owner}} &middot; {{senderCompany}}</div>
          <div style="margin-top:10px;font-size:13px;line-height:20px;color:#344054;"><a href="tel:{{senderPhone}}" style="color:#344054;text-decoration:none;">{{senderPhone}}</a> &nbsp;&middot;&nbsp; <a href="mailto:{{senderEmail}}" style="color:#15803d;text-decoration:none;">{{senderEmail}}</a></div>
        </td>
      </tr></table>
    </td></tr></table>
  </td></tr>

  <!-- Footer -->
  <tr><td class="px" style="background:#0e1714;padding:22px 40px;">
    <p style="margin:0;font-size:11px;line-height:17px;letter-spacing:1.2px;color:#9fb3ab;">{{senderTagline|DEALERSHIP RECONDITIONING · INVENTORY MERCHANDISING · MONITORING}}</p>
    <p style="margin:8px 0 0;font-size:11px;line-height:17px;color:#7d918a;">Sent to {{dealership}} by {{senderCompany}}, {{senderRegion|Connecticut & Massachusetts}}. Based on publicly listed inventory. Not the right person, or not interested? Reply &ldquo;no thanks&rdquo; and we won&rsquo;t follow up.</p>
  </td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`

/**
 * "Then vs Now" — re-engage / check-in email built on the audit history: the latest review vs the
 * one ~3 months earlier ({{auditTrend}}), today's evidence list, and a button to the dealer's own
 * full report ({{reportUrl}}). Same house style as Missing Photos V2. Needs at least two audits.
 */
export const THEN_VS_NOW_HTML = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>{{dealership}} — then vs now</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
  @media only screen and (max-width:620px) {
    .container { width:100% !important; }
    .px { padding-left:22px !important; padding-right:22px !important; }
    .hero-h1 { font-size:34px !important; line-height:39px !important; }
    .h2 { font-size:22px !important; line-height:28px !important; }
    .stack { display:block !important; width:100% !important; box-sizing:border-box; }
    .stack-gap { display:block !important; width:100% !important; height:10px !important; }
    .kpi-num { font-size:34px !important; line-height:38px !important; }
    .hide-sm { display:none !important; }
    .btn a { display:block !important; text-align:center !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#eef1ef;word-spacing:normal;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">{{auditPeriod|A few months}} ago {{prevUsedMissingPhotos}} pre-owned cars at {{dealership}} had no real photo. Today it&rsquo;s {{usedMissingPhotos}}. Your full report is inside.&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef1ef;">
<tr><td align="center" style="padding:28px 12px 40px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <!-- Brand bar -->
  <tr><td class="px" style="background:#0e1714;padding:22px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font-size:20px;font-weight:800;letter-spacing:4px;color:#ffffff;">ZRZ<span style="color:#4ade80;">&nbsp;OPS</span></td>
      <td align="right" class="hide-sm" style="font-size:10px;font-weight:700;letter-spacing:2.4px;color:#9fb3ab;">INVENTORY CHECK-IN</td>
    </tr></table>
  </td></tr>
  <tr><td style="height:3px;line-height:3px;font-size:0;background:#22c55e;">&nbsp;</td></tr>

  <!-- Hero -->
  <tr><td class="px" style="background:#0e1714;padding:40px 40px 44px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#173026;border:1px solid #24493a;border-radius:999px;padding:6px 12px;font-size:11px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#86efac;">{{dealership}} &nbsp;&middot;&nbsp; {{prevAuditDate}} &rarr; {{auditDate}}</td></tr></table>
    <h1 class="hero-h1" style="margin:22px 0 0;font-size:42px;line-height:48px;font-weight:800;letter-spacing:-1px;color:#ffffff;">{{auditPeriod|A few months}} ago: {{prevUsedMissingPhotos}}.<br><span style="color:#4ade80;">Today: {{usedMissingPhotos}}.</span><br>Pre-owned cars with no real photo.</h1>
    <p style="margin:22px 0 0;font-size:16px;line-height:26px;color:#c9d6d0;">Hi {{firstName|there}} &mdash; we checked {{website}} again, the same way a shopper sees it. Here&rsquo;s how your online inventory has changed since our last review, and the cars that still need real photos today.</p>
  </td></tr>

  <!-- Then vs now -->
  <tr><td class="px" style="padding:36px 40px 0;">{{auditTrend}}</td></tr>
  <tr><td class="px" style="padding:18px 40px 0;">{{auditBreakdown}}</td></tr>

  <!-- Evidence -->
  <tr><td class="px" style="padding:22px 40px 0;">{{auditEvidence}}</td></tr>

  <!-- Why -->
  <tr><td class="px" style="padding:24px 40px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="border-left:4px solid #e5484d;background:#fff7f7;border-radius:0 10px 10px 0;padding:18px 20px;font-size:15px;line-height:24px;color:#344054;"><strong style="color:#101828;">Why it keeps coming back:</strong> new trade-ins arrive every week. Without one owner for recon &rarr; photos &rarr; listing, the gap refills as fast as it&rsquo;s closed. That handoff is exactly what ZRZ OPS runs for dealerships &mdash; and we prove it every week.</td>
    </tr></table>
  </td></tr>

  <!-- CTA -->
  <tr><td class="px" style="padding:32px 40px 8px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#effaf3;border:1px solid #cdeedb;border-radius:14px;"><tr><td style="padding:26px 24px;">
      <h2 class="h2" style="margin:0 0 10px;font-size:23px;line-height:29px;font-weight:800;letter-spacing:-.4px;color:#101828;">Your full report is ready</h2>
      <p style="margin:0 0 20px;font-size:15px;line-height:24px;color:#475467;">Every review side by side, the trend, and the full list of listings without a real photo &mdash; open it, forward it, print it.</p>
      <table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:10px;background:#16a34a;">
        <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="{{reportUrl}}" style="height:50px;v-text-anchor:middle;width:300px;" arcsize="20%" stroke="f" fillcolor="#16a34a"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">See my inventory report &rarr;</center></v:roundrect><![endif]-->
        <!--[if !mso]><!--><a href="{{reportUrl}}" style="display:inline-block;padding:16px 28px;border-radius:10px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;">See my inventory report &rarr;</a><!--<![endif]-->
      </td></tr></table>
      <p style="margin:16px 0 0;font-size:14px;line-height:22px;color:#475467;">Want us to start closing the gap? <a href="{{replyMailto}}" style="color:#15803d;font-weight:700;text-decoration:none;">Reply with a good time for 10 minutes &rarr;</a></p>
    </td></tr></table>
  </td></tr>

  <!-- Signature -->
  <tr><td class="px" style="padding:32px 40px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eaecf0;"><tr><td style="padding-top:26px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="52" valign="top"><div style="width:44px;height:44px;line-height:44px;border-radius:22px;background:#0e1714;color:#4ade80;font-size:16px;font-weight:800;text-align:center;">{{senderInitials|ZO}}</div></td>
        <td valign="top" style="padding-left:12px;">
          <div style="font-size:17px;font-weight:800;color:#101828;">{{senderName}}</div>
          <div style="margin-top:2px;font-size:13px;color:#667085;">{{senderTitle|Owner}} &middot; {{senderCompany}}</div>
          <div style="margin-top:10px;font-size:13px;line-height:20px;color:#344054;"><a href="tel:{{senderPhone}}" style="color:#344054;text-decoration:none;">{{senderPhone}}</a> &nbsp;&middot;&nbsp; <a href="mailto:{{senderEmail}}" style="color:#15803d;text-decoration:none;">{{senderEmail}}</a></div>
        </td>
      </tr></table>
    </td></tr></table>
  </td></tr>

  <!-- Footer -->
  <tr><td class="px" style="background:#0e1714;padding:22px 40px;">
    <p style="margin:0;font-size:11px;line-height:17px;letter-spacing:1.2px;color:#9fb3ab;">{{senderTagline|DEALERSHIP RECONDITIONING · INVENTORY MERCHANDISING · MONITORING}}</p>
    <p style="margin:8px 0 0;font-size:11px;line-height:17px;color:#7d918a;">Sent to {{dealership}} by {{senderCompany}}, {{senderRegion|Connecticut & Massachusetts}}. Based on publicly listed inventory. Not the right person, or not interested? Reply &ldquo;no thanks&rdquo; and we won&rsquo;t follow up.</p>
  </td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`
