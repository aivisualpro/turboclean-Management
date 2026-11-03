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
