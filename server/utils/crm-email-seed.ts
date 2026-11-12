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

/**
 * "Missing Photos" V3 — the branded inventory review (matches the "Branhaven CDJR" print piece):
 * deep-green brand band, breadcrumb, "Your online inventory. A measurable opportunity.", executive
 * summary, KPI cards, why it matters, the recommended operating approach (01 Identify · 02 Prep +
 * Capture · 03 Verify + Maintain), how ZRZ OPS manages the handoffs, daily accountability, next step.
 * Icons are small PNGs served from /email/icons on the app (`__ICONS__` is replaced when seeded).
 */
const V3_FONT = `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;`
const v3Icon = (name: string, size = 46) => `<img src="__ICONS__/${name}.png" width="${size}" height="${size}" alt="" style="display:block;width:${size}px;height:${size}px;border:0;">`
const v3Kpi = (icon: string, value: string, label: string, color: string) => `<td class="stack" width="32%" valign="top" style="background:#f3faf7;border:1px solid #d7ebe2;border-radius:12px;padding:14px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="46" valign="middle">${v3Icon(icon, 40)}</td>
          <td valign="middle" style="padding-left:10px;border-left:1px solid #d7ebe2;">
            <div class="kpi-num" style="${V3_FONT}font-size:30px;line-height:34px;font-weight:800;letter-spacing:-.6px;color:${color};">${value}</div>
            <div style="${V3_FONT}margin-top:4px;font-size:10px;line-height:13px;font-weight:700;letter-spacing:.6px;color:#101828;">${label}</div>
          </td>
        </tr></table>
      </td>`
const v3Why = (icon: string, title: string, text: string) => `<td class="stack" width="32%" valign="top" style="border:1px solid #d7ebe2;border-radius:12px;padding:16px 14px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="40" valign="top">${v3Icon(icon, 34)}</td><td valign="middle" style="${V3_FONT}padding-left:8px;font-size:14px;line-height:18px;font-weight:700;color:#101828;">${title}</td></tr></table>
        <div style="${V3_FONT}margin-top:10px;font-size:12px;line-height:18px;color:#667085;">${text}</div>
      </td>`
const v3Step = (n: string, title: string, text: string) => `<tr><td style="padding:0 0 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #d7ebe2;border-radius:12px;"><tr>
        <td width="64" align="center" valign="middle" style="padding:16px 0 16px 14px;"><div style="${V3_FONT}width:46px;height:46px;line-height:46px;border-radius:23px;background:#e2f5ec;color:#128a5e;font-size:16px;font-weight:800;text-align:center;">${n}</div></td>
        <td valign="middle" style="padding:16px 18px 16px 14px;border-left:1px solid #d7ebe2;">
          <div style="${V3_FONT}font-size:15px;font-weight:800;letter-spacing:.4px;color:#101828;">${title}</div>
          <div style="${V3_FONT}margin-top:4px;font-size:13px;line-height:19px;color:#667085;">${text}</div>
        </td>
      </tr></table>
    </td></tr>`
const v3Flow = (icon: string, n: string, title: string, text: string) => `<td class="stack" width="49%" valign="top" align="center" style="border:1px solid #d7ebe2;border-radius:12px;padding:16px 12px;">
        ${v3Icon(icon, 44).replace('display:block;', 'display:inline-block;')}
        <div style="${V3_FONT}margin-top:6px;font-size:12px;font-weight:800;color:#128a5e;">${n}</div>
        <div style="${V3_FONT}margin-top:2px;font-size:12px;font-weight:800;letter-spacing:.4px;color:#101828;">${title}</div>
        <div style="${V3_FONT}margin-top:6px;font-size:12px;line-height:17px;color:#667085;">${text}</div>
      </td>`
const v3Eyebrow = (text: string) => `<p style="${V3_FONT}margin:0;font-size:11px;font-weight:800;letter-spacing:1.4px;color:#128a5e;text-transform:uppercase;">${text}</p>`
const v3Band = (icon: string, title: string, text: string, dark: boolean) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${dark ? '#0f4a3e' : '#dcf5ea'};border-radius:12px;"><tr>
      <td width="76" align="center" valign="middle" style="padding:18px 0 18px 16px;">${v3Icon(icon, 50)}</td>
      <td valign="middle" style="padding:18px 22px 18px 16px;border-left:1px solid ${dark ? '#2f6f60' : '#b8e6d0'};">
        ${title ? `<div style="${V3_FONT}font-size:12px;font-weight:800;letter-spacing:1.2px;color:${dark ? '#5fd3a3' : '#128a5e'};">${title}</div>` : ''}
        <div style="${V3_FONT}${title ? 'margin-top:6px;' : ''}font-size:14px;line-height:21px;color:${dark ? '#ffffff' : '#101828'};">${text}</div>
      </td>
    </tr></table>`

export const MISSING_PHOTOS_HTML_V3 = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>{{dealership}} — inventory review</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
  @media only screen and (max-width:620px) {
    .container { width:100% !important; }
    .px { padding-left:20px !important; padding-right:20px !important; }
    .hero-h1 { font-size:30px !important; line-height:36px !important; }
    .h2 { font-size:24px !important; line-height:30px !important; }
    .stack { display:block !important; width:100% !important; box-sizing:border-box; }
    .stack-gap { display:block !important; width:100% !important; height:10px !important; }
    .kpi-num { font-size:28px !important; line-height:32px !important; }
    .hide-sm { display:none !important; }
    .btn a { display:block !important; text-align:center !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#eef2f0;word-spacing:normal;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Inventory review for {{dealership}}: {{usedMissingPhotos}} of {{usedTotal}} pre-owned listings are missing vehicle photos — and a simple way to close the gap.&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f0;">
<tr><td align="center" style="padding:24px 10px 40px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;${V3_FONT}">

  <!-- Brand band -->
  <tr><td class="px" style="background:#0f4a3e;padding:26px 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="${V3_FONT}font-size:26px;font-weight:800;letter-spacing:1px;color:#ffffff;">ZRZ&nbsp;&nbsp;<span style="color:#5fd3a3;">OPS</span></td>
      <td align="right" class="hide-sm" style="${V3_FONT}font-size:11px;font-weight:800;letter-spacing:.6px;color:#ffffff;">DEALERSHIP INVENTORY INTELLIGENCE</td>
    </tr></table>
  </td></tr>
  <tr><td class="px" style="padding:0 36px;"><div style="height:3px;line-height:3px;font-size:0;background:#4ad6a0;">&nbsp;</div></td></tr>

  <!-- Hero -->
  <tr><td class="px" style="padding:22px 36px 0;">
    ${v3Eyebrow('{{dealership}} &nbsp;/&nbsp; Inventory review &nbsp;/&nbsp; {{auditDateUpper}}')}
    <h1 class="hero-h1" style="${V3_FONT}margin:22px 0 0;font-size:38px;line-height:44px;font-weight:800;letter-spacing:-.6px;color:#111827;">Your online inventory.<br><span style="color:#128a5e;">A measurable opportunity.</span></h1>
    <p style="${V3_FONT}margin:16px 0 0;font-size:15px;line-height:23px;color:#667085;">Prepared for {{dealership}} | A focused review of pre-owned vehicle photography and merchandising consistency.</p>
  </td></tr>

  <!-- Executive summary -->
  <tr><td class="px" style="padding:28px 36px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #d7ebe2;border-left:5px solid #128a5e;border-radius:12px;"><tr><td style="padding:18px 20px 20px;">
      ${v3Eyebrow('Executive summary')}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr>
        <td width="58" valign="middle">${v3Icon('file-text-light', 46)}</td>
        <td valign="middle" style="${V3_FONT}padding-left:16px;border-left:1px solid #d7ebe2;font-size:15px;line-height:23px;color:#111827;">Hi {{firstName|there}} &mdash; we reviewed {{dealership}}&rsquo;s publicly listed pre-owned inventory and identified a visible online merchandising gap: <strong>{{usedMissingPhotos}} of {{usedTotal}}</strong> pre-owned listings are currently missing vehicle photos.</td>
      </tr></table>
    </td></tr></table>
  </td></tr>

  <!-- At a glance -->
  <tr><td class="px" style="padding:26px 36px 0;">
    ${v3Eyebrow('Your inventory, at a glance')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;"><tr>
      ${v3Kpi('car-light', '{{usedTotal}}', 'VISIBLE PRE-OWNED VEHICLES', '#111827')}
      <td class="stack-gap" width="2%" style="font-size:0;line-height:0;">&nbsp;</td>
      ${v3Kpi('camera-light', '{{usedMissingPhotos}}', 'LISTINGS FLAGGED FOR MISSING PHOTOS', '#128a5e')}
      <td class="stack-gap" width="2%" style="font-size:0;line-height:0;">&nbsp;</td>
      ${v3Kpi('chart-pie-light', '{{usedMissingPhotoPct}}', 'MISSING-PHOTO RATE', '#128a5e')}
    </tr></table>
  </td></tr>
  <tr><td class="px" style="padding:16px 36px 0;">{{inventoryByPage}}</td></tr>

  <!-- Why this matters -->
  <tr><td class="px" style="padding:22px 36px 0;">
    ${v3Eyebrow('Why this matters')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;"><tr>
      ${v3Why('eye-light', 'First impression', 'Listings without photos create friction before a shopper even clicks.')}
      <td class="stack-gap" width="2%" style="font-size:0;line-height:0;">&nbsp;</td>
      ${v3Why('layers-light', 'Merchandising consistency', 'Incomplete photo coverage makes inventory look less curated and less market-ready.')}
      <td class="stack-gap" width="2%" style="font-size:0;line-height:0;">&nbsp;</td>
      ${v3Why('chart-column-light', 'Missed opportunity', 'Every unphotographed unit is a vehicle that can underperform online.')}
    </tr></table>
  </td></tr>
  <tr><td class="px" style="padding:16px 36px 0;">${v3Band('pencil-mint', '', 'ZRZ OPS helps dealerships close these gaps with detailing, photography, and repeatable inventory support.', false)}</td></tr>

  <!-- Evidence + history (render only when there is data) -->
  <tr><td class="px" style="padding:24px 36px 0;">{{auditEvidence}}</td></tr>
  <tr><td class="px" style="padding:20px 36px 0;">{{auditTrend}}</td></tr>

  <!-- Recommended operating approach -->
  <tr><td class="px" style="padding:36px 36px 0;">
    <div style="height:3px;line-height:3px;font-size:0;background:#4ad6a0;margin-bottom:22px;">&nbsp;</div>
    ${v3Eyebrow('Recommended operating approach &nbsp;/&nbsp; {{dealership}}')}
    <h2 class="h2" style="${V3_FONT}margin:18px 0 0;font-size:30px;line-height:36px;font-weight:800;letter-spacing:-.5px;color:#111827;">From missing photos<br><span style="color:#128a5e;">to a repeatable process.</span></h2>
    <p style="${V3_FONT}margin:14px 0 18px;font-size:15px;line-height:23px;color:#667085;">ZRZ OPS supports dealerships with reconditioning, vehicle photography, and an accountable workflow from ready-for-sale to online presentation.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${v3Step('01', 'IDENTIFY', 'Review the active pre-owned inventory and flag missing-photo or incomplete listings.')}
      ${v3Step('02', 'PREP + CAPTURE', 'Coordinate vehicle readiness and complete consistent exterior and interior photos.')}
      ${v3Step('03', 'VERIFY + MAINTAIN', 'Track open exceptions, confirm photo publication, and repeat the check for new arrivals.')}
    </table>
  </td></tr>
  <tr><td class="px" style="padding:6px 36px 0;">${v3Band('chart-column-dark', '<span style="text-transform:uppercase;">WHAT {{dealership}} GETS</span>', 'Clear exceptions &bull; consistent merchandising standards &bull; fewer units slipping through the cracks', true)}</td></tr>

  <!-- How ZRZ OPS helps -->
  <tr><td class="px" style="padding:36px 36px 0;">
    <div style="height:3px;line-height:3px;font-size:0;background:#4ad6a0;margin-bottom:22px;">&nbsp;</div>
    ${v3Eyebrow('How ZRZ OPS helps &nbsp;/&nbsp; The operating system behind the detail')}
    <h2 class="h2" style="${V3_FONT}margin:18px 0 0;font-size:30px;line-height:36px;font-weight:800;letter-spacing:-.5px;color:#111827;">We do more than detail cars.</h2>
    <h3 style="${V3_FONT}margin:8px 0 0;font-size:22px;line-height:28px;font-weight:800;color:#128a5e;">We manage the handoffs that slow inventory down.</h3>
    <p style="${V3_FONT}margin:14px 0 18px;font-size:15px;line-height:23px;color:#667085;">The goal is simple: when a vehicle hits the ground, every department knows where it is, what it needs, and what happens next &mdash; so the vehicle can be cleaned, photographed, merchandised, and online as quickly as possible.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td class="stack" width="49%" valign="top" style="background:#fbe5e2;border:1px solid #f3c6c0;border-radius:12px;padding:18px 18px;">
        <div style="${V3_FONT}font-size:12px;font-weight:800;letter-spacing:1.2px;color:#c2453b;">THE PAIN POINT</div>
        <div style="${V3_FONT}margin-top:10px;font-size:13px;line-height:20px;color:#111827;">Detailers can be waiting for work while vehicles sit in service, on the lot, or between departments. Management may think recon is behind when the real issue is handoff and communication.</div>
      </td>
      <td class="stack-gap" width="2%" style="font-size:0;line-height:0;">&nbsp;</td>
      <td class="stack" width="49%" valign="top" style="background:#f3faf7;border:1px solid #d7ebe2;border-radius:12px;padding:18px 18px;">
        <div style="${V3_FONT}font-size:12px;font-weight:800;letter-spacing:1.2px;color:#128a5e;">THE ZRZ RESPONSE</div>
        <div style="${V3_FONT}margin-top:10px;font-size:13px;line-height:20px;color:#111827;">ZRZ actively coordinates with service, the foreman, dispatcher, and used-car management to keep the next available vehicle moving instead of waiting in a queue.</div>
      </td>
    </tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr>
      ${v3Flow('car-light', '01', 'VEHICLE ARRIVES', 'Used or new inventory hits the ground.')}
      <td class="stack-gap" width="2%" style="font-size:0;line-height:0;">&nbsp;</td>
      ${v3Flow('users-light', '02', 'SERVICE / SAFETY', 'If service can only work on part of the queue, ZRZ pulls available units forward.')}
    </tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr>
      ${v3Flow('camera-light', '03', 'RECON + PHOTO', 'Available units are detailed, photographed, and merchandised immediately.')}
      <td class="stack-gap" width="2%" style="font-size:0;line-height:0;">&nbsp;</td>
      ${v3Flow('arrow-left-right-light', '04', 'BACK TO SERVICE', 'Vehicle returns quickly for remaining service work once a bay is ready.')}
    </tr></table>
  </td></tr>
  <tr><td class="px" style="padding:14px 36px 0;">${v3Band('clock-dark', 'DAILY ACCOUNTABILITY', 'ZRZ works closely with the used-car manager and provides clear daily updates on what was completed, what is waiting, and what is blocked. That visibility makes it easier to push the missing-photo percentage toward the lowest practical level.', true)}</td></tr>
  <tr><td class="px" style="padding:14px 36px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#dcf5ea;border-radius:12px;"><tr><td style="padding:18px 22px;">
      <div style="${V3_FONT}font-size:12px;font-weight:800;letter-spacing:1.2px;color:#128a5e;">THE OUTCOME</div>
      <div style="${V3_FONT}margin-top:8px;font-size:14px;line-height:21px;color:#111827;">Less idle time. Fewer lost vehicles. Faster merchandising. Better communication between departments. More inventory online while sales and service finish the rest of the decision process.</div>
    </td></tr></table>
  </td></tr>

  <!-- Next step -->
  <tr><td class="px" style="padding:28px 36px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#dcf5ea;border-radius:12px;"><tr>
      <td width="76" align="center" valign="top" style="padding:20px 0 20px 16px;">${v3Icon('pencil-mint', 50)}</td>
      <td valign="top" style="padding:20px 22px 22px 16px;border-left:1px solid #b8e6d0;">
        <div style="${V3_FONT}font-size:12px;font-weight:800;letter-spacing:1.2px;color:#128a5e;">NEXT STEP</div>
        <div style="${V3_FONT}margin-top:6px;font-size:14px;line-height:21px;color:#111827;">A 15-minute walkthrough to validate the inventory data and discuss how a photo-ready workflow could fit {{dealership}}&rsquo;s current operation.</div>
        <table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0" style="margin-top:16px;"><tr><td style="border-radius:10px;background:#0f4a3e;">
          <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="{{replyMailto}}" style="height:46px;v-text-anchor:middle;width:300px;" arcsize="20%" stroke="f" fillcolor="#0f4a3e"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">Book a 15-minute walkthrough &rarr;</center></v:roundrect><![endif]-->
          <!--[if !mso]><!--><a href="{{replyMailto}}" style="display:inline-block;padding:14px 24px;border-radius:10px;${V3_FONT}font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">Book a 15-minute walkthrough &rarr;</a><!--<![endif]-->
        </td></tr></table>
        <div style="${V3_FONT}margin-top:12px;font-size:13px;line-height:19px;"><a href="{{reportUrl}}" style="color:#128a5e;font-weight:700;text-decoration:none;">Open the full inventory report &rarr;</a></div>
      </td>
    </tr></table>
  </td></tr>

  <!-- Signature -->
  <tr><td class="px" style="padding:30px 36px 34px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #e5ece9;"><tr><td style="padding-top:22px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="52" valign="top"><div style="${V3_FONT}width:44px;height:44px;line-height:44px;border-radius:22px;background:#0f4a3e;color:#5fd3a3;font-size:16px;font-weight:800;text-align:center;">{{senderInitials|ZO}}</div></td>
        <td valign="top" style="padding-left:12px;">
          <div style="${V3_FONT}font-size:16px;font-weight:800;color:#111827;">{{senderName}}</div>
          <div style="${V3_FONT}margin-top:2px;font-size:13px;color:#667085;">{{senderTitle|Owner}} &middot; {{senderCompany}}</div>
          <div style="${V3_FONT}margin-top:8px;font-size:13px;line-height:20px;color:#344054;"><a href="tel:{{senderPhone}}" style="color:#344054;text-decoration:none;">{{senderPhone}}</a> &nbsp;&middot;&nbsp; <a href="mailto:{{senderEmail}}" style="color:#128a5e;text-decoration:none;">{{senderEmail}}</a></div>
        </td>
      </tr></table>
    </td></tr></table>
  </td></tr>

  <!-- Footer -->
  <tr><td class="px" style="padding:16px 36px 22px;border-top:1px solid #e5ece9;">
    <p style="${V3_FONT}margin:0;font-size:10px;line-height:15px;letter-spacing:.6px;color:#667085;">ZRZ OPS &nbsp;/&nbsp; RECONDITIONING + INVENTORY OPERATIONS</p>
    <p style="${V3_FONT}margin:6px 0 0;font-size:11px;line-height:16px;color:#98a2b3;">Snapshot of publicly visible listings on {{auditDate}}; counts change as inventory is updated. Sent to {{dealership}} by {{senderCompany}}, {{senderRegion|Connecticut & Massachusetts}}. Not the right person, or not interested? Reply &ldquo;no thanks&rdquo; and we won&rsquo;t follow up.</p>
  </td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`

/**
 * "Missing Photos" V4 — the inventory audit email as it is sent by hand today (reference: "Westbrook
 * Honda | Inventory Audit: 23 Pre-Owned Vehicles Missing Photos"):
 *   charcoal header with the green rule · greeting and the three-line headline · "at a glance"
 *   numbers · EVIDENCE: the flagged listings pictured as the dealer's website shows them
 *   ({{auditGallery}}) · why it matters · what ZRZ OPS does differently (01 / 02 / 03) ·
 *   one question and one button · point-of-contact footer.
 * Square corners, one green, Helvetica — measured from the reference (colours sampled from it).
 * No web fonts and no remote images of ours: the only pictures are the listing photos, which are
 * embedded in the message when it is sent.
 */
const V4_FONT = `font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;`
const v4Label = (text: string, color: string) => `<p style="${V4_FONT}margin:0;font-size:11px;line-height:14px;font-weight:700;letter-spacing:2.2px;color:${color};text-transform:uppercase;">${text}</p>`
const v4Tile = (value: string, label: string, bg: string, color: string) => `<td class="tile" width="33%" align="center" valign="middle" style="background:${bg};padding:28px 10px 30px;">
        <div class="tile-num" style="${V4_FONT}font-size:50px;line-height:54px;font-weight:700;letter-spacing:-1px;color:${color};">${value}</div>
        <div class="tile-label" style="${V4_FONT}margin-top:10px;font-size:12px;line-height:17px;font-weight:700;letter-spacing:.4px;color:#59675e;">${label}</div>
      </td>`
const v4Step = (n: string, title: string, text: string, last = false) => `<tr>
        <td width="42" valign="top" style="padding:0 0 ${last ? 0 : 18}px;"><div style="${V4_FONT}width:42px;height:38px;line-height:38px;background:#137a4b;color:#ffffff;font-size:13px;font-weight:700;text-align:center;">${n}</div></td>
        <td valign="top" style="padding:0 0 ${last ? 0 : 18}px 12px;">
          <div style="${V4_FONT}font-size:16px;line-height:21px;font-weight:700;color:#000000;">${title}</div>
          <div style="${V4_FONT}margin-top:3px;font-size:14px;line-height:21px;color:#56645c;">${text}</div>
        </td>
      </tr>`

/**
 * V5 = the same email, laid out for a desktop inbox: the column is fluid up to 820px (it was a fixed
 * 600px, which looked like a narrow strip in a wide Gmail / Outlook window) and still collapses to
 * the full width of a phone. Larger type and roomier padding at desktop width; the listing cards
 * grow with the column so the photos are the size of real thumbnails.
 */
export const MISSING_PHOTOS_HTML_V5 = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>{{dealership}} | Inventory audit</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { -ms-interpolation-mode:bicubic; }
  a[x-apple-data-detectors] { color:inherit !important; text-decoration:none !important; }
  u + #body a { color:inherit; }
  @media only screen and (max-width:620px) {
    .container { width:100% !important; }
    .outer { padding:0 !important; }
    .px { padding-left:22px !important; padding-right:22px !important; }
    .hero-h1 { font-size:31px !important; line-height:37px !important; }
    .lead { font-size:15px !important; line-height:23px !important; }
    .h2 { font-size:22px !important; line-height:28px !important; }
    .gpic { height:104px !important; }
    .tile { padding:16px 4px 18px !important; }
    .tile-gap { width:3px !important; }
    .tile-num { font-size:30px !important; line-height:34px !important; }
    .tile-label { font-size:10px !important; line-height:14px !important; }
    .gcard { width:50% !important; min-width:0 !important; }
    .hide-sm { display:none !important; }
    .btn, .btn a { display:block !important; text-align:center !important; }
  }
</style>
</head>
<body id="body" style="margin:0;padding:0;background:#edf0ee;word-spacing:normal;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">{{usedMissingPhotos}} of {{usedTotal}} pre-owned listings at {{dealership}} are missing photos &mdash; what we found, with the listings, and how to close the gap.&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#edf0ee;">
<tr><td class="outer" align="center" style="padding:28px 16px 28px;">
<!--[if mso]><table role="presentation" align="center" width="820" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="container" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:820px;margin:0 auto;background:#ffffff;${V4_FONT}">

  <!-- Header -->
  <tr><td class="px" style="background:#1b2422;padding:30px 48px 29px;border-bottom:3px solid #20b66a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" style="${V4_FONT}font-size:22px;line-height:26px;font-weight:700;letter-spacing:2.6px;color:#ffffff;white-space:nowrap;">ZRZ <span style="color:#91f2b9;">OPS</span></td>
      <td align="right" valign="middle" style="${V4_FONT}font-size:10px;line-height:13px;font-weight:700;letter-spacing:2.4px;color:#c5dfd0;">RECONDITIONING<br>&amp; INVENTORY OPERATIONS</td>
    </tr></table>
  </td></tr>

  <!-- Opening -->
  <tr><td class="px" style="background:#18231f;padding:48px 48px 52px;">
    ${v4Label('Inventory review &nbsp;/&nbsp; {{auditDateUpper}}', '#76edab')}
    <p style="${V4_FONT}margin:24px 0 0;font-size:16px;line-height:22px;font-weight:700;color:#ffffff;">Hi {{firstName|there}},</p>
    <p class="lead" style="${V4_FONT}margin:18px 0 0;max-width:640px;font-size:16px;line-height:25px;color:#d9f3e4;">I took a look at your dealership&rsquo;s online inventory and noticed something worth bringing to your attention.</p>
    <h1 class="hero-h1" style="${V4_FONT}margin:28px 0 0;font-size:46px;line-height:52px;font-weight:700;letter-spacing:-.8px;color:#ffffff;">{{usedMissingHeadline|Pre-owned vehicles}}<br><span style="color:#91f2b9;">Missing photos.</span><br>One fixable gap.</h1>
    <p class="lead" style="${V4_FONT}margin:22px 0 0;max-width:640px;font-size:17px;line-height:27px;color:#d9f3e4;">We reviewed your publicly listed pre-owned inventory and identified vehicles with missing photos. Here&rsquo;s what stood out&mdash;and how ZRZ OPS helps dealership teams close these gaps.</p>
  </td></tr>

  <!-- At a glance -->
  <tr><td class="px" style="padding:46px 48px 0;">
    ${v4Label('Your inventory, at a glance', '#126c43')}
    <h2 class="h2" style="${V4_FONT}margin:10px 0 0;font-size:28px;line-height:34px;font-weight:700;letter-spacing:-.4px;color:#000000;">A visible gap in your online inventory.</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;"><tr>
      ${v4Tile('{{usedTotal}}', 'VISIBLE USED<br>VEHICLES', '#edf6ef', '#000000')}
      <td class="tile-gap" width="6" style="width:6px;font-size:0;line-height:0;">&nbsp;</td>
      ${v4Tile('{{usedMissingPhotos}}', 'LISTINGS FLAGGED FOR<br>MISSING PHOTOS', '#dff4e7', '#14784b')}
      <td class="tile-gap" width="6" style="width:6px;font-size:0;line-height:0;">&nbsp;</td>
      ${v4Tile('{{usedMissingPhotoPct}}', 'OF VISIBLE USED<br>INVENTORY', '#c7ecd5', '#14784b')}
    </tr></table>
  </td></tr>

  <!-- Evidence: the flagged listings, pictured as the website shows them (nothing when the audit has none) -->
  <tr><td class="px" style="padding:26px 48px 0;">{{auditGallery}}</td></tr>

  <!-- Why this matters -->
  <tr><td class="px" style="padding:26px 48px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="4" style="width:4px;background:#20b66a;font-size:0;line-height:0;">&nbsp;</td>
      <td style="background:#edf9f1;padding:18px 24px 20px 20px;${V4_FONT}font-size:15px;line-height:24px;color:#26332e;"><strong>Why this matters:</strong> A vehicle without a complete photo presentation may be harder for shoppers to evaluate. Some gaps are unavoidable, but others come down to process, ownership, and follow-through.</td>
    </tr></table>
    <p style="${V4_FONT}margin:14px 0 0;font-size:11px;line-height:17px;color:#65746a;">Snapshot of publicly visible inventory on {{auditDate}}. Counts can change as listings are updated.</p>
  </td></tr>

  <!-- What ZRZ OPS does differently -->
  <tr><td style="padding:34px 0 0;"><div style="height:1px;line-height:1px;font-size:0;background:#dfe7e2;">&nbsp;</div></td></tr>
  <tr><td class="px" style="background:#f3f8f4;padding:40px 48px 42px;">
    ${v4Label('What ZRZ OPS does differently', '#126c43')}
    <h2 class="h2" style="${V4_FONT}margin:12px 0 22px;font-size:28px;line-height:34px;font-weight:700;letter-spacing:-.4px;color:#000000;">We don&rsquo;t just detail cars.<br>We help keep inventory moving.</h2>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${v4Step('01', 'RECON &mdash; Get vehicles ready', 'Coordinate detailing and vehicle preparation to reduce avoidable handoff delays.')}
      ${v4Step('02', 'MERCHANDISE &mdash; Get vehicles online', 'Capture photos and support merchandising so inventory can be presented promptly.')}
      ${v4Step('03', 'MONITOR &mdash; Catch what&rsquo;s missing', 'Review online listings, flag gaps, and communicate issues before they sit unresolved.', true)}
    </table>
  </td></tr>

  <!-- One question, one button -->
  <tr><td class="px" style="padding:50px 48px 50px;">
    <h2 class="h2" style="${V4_FONT}margin:0;font-size:28px;line-height:34px;font-weight:700;letter-spacing:-.4px;color:#000000;">Would a 10-minute conversation be worth it?</h2>
    <p style="${V4_FONT}margin:14px 0 0;max-width:640px;font-size:16px;line-height:25px;color:#4b5b53;">I can walk you through what we found, which gaps may be controllable, and how our team approaches recon, photos, and inventory follow-up across dealership operations.</p>
    <table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr><td align="center" style="background:#137a4b;">
      <!--[if mso]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" href="{{replyMailto}}" style="height:46px;v-text-anchor:middle;width:366px;" stroke="f" fillcolor="#137a4b"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:bold;">REPLY TO SCHEDULE A 10-MINUTE REVIEW &rarr;</center></v:rect><![endif]-->
      <!--[if !mso]><!--><a href="{{replyMailto}}" style="display:inline-block;padding:15px 24px;${V4_FONT}font-size:14px;line-height:18px;font-weight:700;letter-spacing:.2px;color:#ffffff;text-decoration:none;">REPLY TO SCHEDULE A 10-MINUTE REVIEW &rarr;</a><!--<![endif]-->
    </td></tr></table>
    <p style="${V4_FONT}margin:16px 0 0;font-size:13px;line-height:20px;color:#65746a;">Or simply reply to this email with a good time to connect.</p>
  </td></tr>

  <!-- Point of contact -->
  <tr><td class="px" style="background:#1b2422;padding:36px 48px 38px;">
    ${v4Label('Your point of contact', '#91e2b7')}
    <p style="${V4_FONT}margin:14px 0 0;font-size:23px;line-height:28px;font-weight:700;color:#ffffff;">{{senderName}}</p>
    <p style="${V4_FONT}margin:6px 0 0;font-size:13px;line-height:18px;color:#c5dfd0;">{{senderTitle|Owner}} | {{senderCompany}}</p>
    <div style="height:1px;line-height:1px;font-size:0;background:#42534a;margin:18px 0 14px;">&nbsp;</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="${V4_FONT}padding:0 14px 6px 0;font-size:11px;line-height:18px;letter-spacing:.4px;color:#a9bcb1;">DIRECT</td><td style="${V4_FONT}padding:0 0 6px;font-size:14px;line-height:18px;"><a href="tel:{{senderPhone}}" style="color:#ffffff;text-decoration:none;">{{senderPhone}}</a></td></tr>
      <tr><td style="${V4_FONT}padding:0 14px 0 0;font-size:11px;line-height:18px;letter-spacing:.4px;color:#a9bcb1;">EMAIL</td><td style="${V4_FONT}font-size:14px;line-height:18px;"><a href="mailto:{{senderEmail}}" style="color:#ffffff;text-decoration:underline;">{{senderEmail}}</a></td></tr>
    </table>
    <p style="${V4_FONT}margin:18px 0 0;font-size:11px;line-height:17px;letter-spacing:.3px;color:#a9bcb1;">{{senderTagline|DEALERSHIP RECONDITIONING  ·  INVENTORY MERCHANDISING  ·  MONITORING}}<br>{{senderRegion|Connecticut & Massachusetts}}</p>
  </td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
<!--[if mso]><table role="presentation" align="center" width="820" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="container" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:820px;margin:0 auto;"><tr><td class="px" style="padding:14px 48px 0;${V4_FONT}font-size:11px;line-height:17px;color:#7c8a82;">Sent to {{dealership}} by {{senderCompany}}. Not the right person, or not interested? Reply &ldquo;no thanks&rdquo; and we won&rsquo;t follow up.</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`

/** Fresh installs start on the current design; existing ones get it as a new version (seedMissingPhotosV5). */
export const MISSING_PHOTOS_HTML_V4 = MISSING_PHOTOS_HTML_V5
