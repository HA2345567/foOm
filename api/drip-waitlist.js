import pg from "pg";
import nodemailer from "nodemailer";

const { Pool } = pg;

// Initialize Postgres pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Helper to strip surrounding quotes from env variables if they were set literally in production
const cleanEnvVar = (val) => {
  if (!val) return val;
  val = val.trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.substring(1, val.length - 1);
  }
  return val;
};

const smtpHost = cleanEnvVar(process.env.SMTP_HOST || process.env.EMAIL_HOST) || "smtp.gmail.com";
const smtpPort = parseInt(cleanEnvVar(process.env.SMTP_PORT || process.env.EMAIL_PORT) || "587", 10);
const smtpUser = cleanEnvVar(process.env.SMTP_USER || process.env.EMAIL_USER);
const smtpPass = cleanEnvVar(process.env.SMTP_PASS || process.env.EMAIL_PASS);

const isGmail = smtpHost.includes("gmail.com");

const transportConfig = isGmail
  ? {
      service: "gmail",
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    }
  : {
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      tls: {
        rejectUnauthorized: false,
      },
    };

const transporter = nodemailer.createTransport(transportConfig);

const FROM = `"foOm" <${smtpUser}>`;

// Shared dark-mode email wrapper
function getFunnelHtml(title, headline, bodyHtml, ctaText, ctaUrl, unsubscribeEmail) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0D;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#F8FAFC;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:48px 18px;background:#0A0A0D;">
<tr>
<td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#111318;border:1px solid #1F2430;border-radius:30px;overflow:hidden;box-shadow:0 20px 40px rgba(0,0,0,0.5);">

<!-- Accent Line -->
<tr>
<td style="height:3px;background:linear-gradient(90deg, #7C3AED 0%, #8B5CF6 100%);"></td>
</tr>

<!-- Header Logo -->
<tr>
<td style="padding:48px 48px 24px 48px;text-align:center;">
<div style="display:inline-block;padding:10px 18px;border-radius:14px;background:#151821;border:1px solid #242938;margin-bottom:28px;">
<span style="font-size:24px;font-weight:700;letter-spacing:-1px;color:#ffffff;">
fo<span style="color:#8B5CF6;">Om</span>
</span>
</div>
<h1 style="margin:0;font-size:38px;line-height:1.1;font-weight:700;letter-spacing:-2px;color:#ffffff;">
${headline}
</h1>
</td>
</tr>

<!-- Body Text -->
<tr>
<td style="padding:0 48px 36px 48px;font-size:15px;line-height:1.7;color:#98A2B3;text-align:left;">
${bodyHtml}
</td>
</tr>

<!-- CTA Button -->
<tr>
<td style="padding:0 48px 48px 48px;text-align:center;">
<a href="${ctaUrl}" style="display:inline-block;padding:16px 36px;background:#8B5CF6;border-radius:14px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:-0.2px;">
${ctaText}
</a>
</td>
</tr>

<!-- Footer -->
<tr>
<td style="padding:28px 48px;background:#0D0F14;border-top:1px solid #1D2129;text-align:center;">
<p style="margin:0;font-size:12px;line-height:1.8;color:#667085;">
You received this because you requested Priority VIP access to the foOm waiting list.<br/>
You can <a href="https://foom-sepia.vercel.app/unsubscribe?email=${encodeURIComponent(unsubscribeEmail)}" style="color:#8B5CF6;text-decoration:none;">unsubscribe here</a> at any time.
</p>
</td>
</tr>

</table>
</td>
</tr>
</table>
</body>
</html>
  `;
}

// Sequence templates and subject lines
const DRIP_STAGES = {
  2: {
    subject: "⚡ Why heavy desktop recorders are dead",
    title: "Why heavy desktop recorders are dead",
    headline: "Canvas-Speed Power",
    body: (name) => `
      Hey ${name},<br/><br/>
      If you're still using heavy desktop recording tools that hog your CPU, make cooling fans roar, and produce massive raw files, it's time for a change.<br/><br/>
      Traditional recorders are built like tanks—inflexible and slow. foOm operates entirely within your browser using a native canvas-rendering pipeline.<br/><br/>
      No massive background tasks. It captures, pan-handles, and renders smooth zooms directly in your web sandbox. The moment you click stop, your ready-to-share export is ready instantly.<br/><br/>
      Let's record a demo that looks like it took 3 hours to edit, in under 30 seconds.
    `,
    ctaText: "Record a Test Clip Now",
    ctaUrl: "https://foom-sepia.vercel.app/record",
  },
  3: {
    subject: "🎬 How Alex hit the Product Hunt Top 3",
    title: "How Alex hit the Product Hunt Top 3",
    headline: "The 100k View Demo",
    body: (name) => `
      Hey ${name},<br/><br/>
      Alex was launching his SaaS tool on Product Hunt last month. He didn't have a budget for a professional video editor, so he decided to capture a standard screen recording.<br/><br/>
      Instead of posting a flat, static video, he recorded it with foOm. The AI-driven focal zoom perfectly tracked his mouse, giving his launch clip a premium, dynamic feel.<br/><br/>
      His post generated over 100,000 views on Twitter, leading directly to 1,200 waitlist signups in 48 hours. Everyone was asking what software he used to edit the sweeps.<br/><br/>
      Make your next product launch feel premium without spending a dollar on external editors.
    `,
    ctaText: "Generate Your Launch Video",
    ctaUrl: "https://foom-sepia.vercel.app/record",
  },
  4: {
    subject: "🎯 The math behind the perfect camera zoom",
    title: "The math behind the perfect camera zoom",
    headline: "Seamless Physics Easing",
    body: (name) => `
      Hey ${name},<br/><br/>
      A lot of people ask: *“If an AI is zooming in automatically, won’t the video look jerky or robotic?”*<br/><br/>
      The secret lies in the mathematics of physics easing. We didn't just write a simple follow-the-mouse script. foOm integrates real-time acceleration and deceleration formulas.<br/><br/>
      When your cursor moves rapidly, the camera lags slightly behind with an elegant momentum, catching up smoothly right as you slow down to click. It mimics organic, human camera sweeps.<br/><br/>
      See the physics engine in action on your own interface now.
    `,
    ctaText: "Test the Physics Slider",
    ctaUrl: "https://foom-sepia.vercel.app/record",
  },
  5: {
    subject: "🚀 Secure your permanent premium license",
    title: "Secure your permanent premium license",
    headline: "Priority VIP Access",
    body: (name) => `
      Hey ${name},<br/><br/>
      You've seen the power of browser-native cinematic screen recording. Now, it’s time to unlock unlimited, high-resolution 4K exports and remove the foOm watermark forever.<br/><br/>
      If you upgrade to the **foOm Pro Suite ($49/month)** within the next 48 hours, we will apply a special launch credit:<br/><br/>
      **Get 20% off your Pro Plan subscription for the first 6 months, plus priority serverless rendering bypass.**<br/><br/>
      Stop wasting hours manually zooming. Start recording like a filmmaker today.
    `,
    ctaText: "Claim 20% Pro Discount",
    ctaUrl: "https://foom-sepia.vercel.app/upgrade",
  },
};

export default async function handler(req, res) {
  // Optional security check (secures trigger route from malicious execution)
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized cron execution" });
  }

  try {
    console.log("Starting foOm waitlist drip execution...");
    
    // Fetch all active waitlist records eligible for their next sequence drips
    const query = 'SELECT * FROM "Waitlist" WHERE "lastDripSent" < 5 ORDER BY "createdAt" ASC;';
    const result = await pool.query(query);
    const records = result.rows;

    const summary = {
      processed: records.length,
      sentEmail2: 0,
      sentEmail3: 0,
      sentEmail4: 0,
      sentEmail5: 0,
      failed: 0,
    };

    const now = Date.now();

    for (const record of records) {
      const { id, email, createdAt, lastDripSent } = record;
      const ageHours = (now - new Date(createdAt).getTime()) / (1000 * 60 * 60);
      
      let nextStage = lastDripSent + 1;
      let shouldSend = false;

      // Define time delta windows (1 day per stage)
      if (nextStage === 2 && ageHours >= 24) shouldSend = true;
      if (nextStage === 3 && ageHours >= 48) shouldSend = true;
      if (nextStage === 4 && ageHours >= 72) shouldSend = true;
      if (nextStage === 5 && ageHours >= 96) shouldSend = true;

      if (shouldSend) {
        const stageConfig = DRIP_STAGES[nextStage];
        const displayName = email.split("@")[0]; // Fallback to email username

        try {
          const emailHtml = getFunnelHtml(
            stageConfig.title,
            stageConfig.headline,
            stageConfig.body(displayName),
            stageConfig.ctaText,
            stageConfig.ctaUrl,
            email
          );

          await transporter.sendMail({
            from: FROM,
            to: email,
            subject: stageConfig.subject,
            html: emailHtml,
            text: `Hey ${displayName}, check out foOm update: ${stageConfig.title} at ${stageConfig.ctaUrl}`,
          });

          // Persistent State Update
          await pool.query('UPDATE "Waitlist" SET "lastDripSent" = $1 WHERE id = $2;', [nextStage, id]);
          
          if (nextStage === 2) summary.sentEmail2++;
          if (nextStage === 3) summary.sentEmail3++;
          if (nextStage === 4) summary.sentEmail4++;
          if (nextStage === 5) summary.sentEmail5++;

          console.log(`✓ Sent Drip Email ${nextStage} to ${email}`);
        } catch (sendError) {
          console.error(`✗ Failed to send Drip Email ${nextStage} to ${email}:`, sendError);
          summary.failed++;
        }
      }
    }

    console.log("foOm waitlist drip sequence run completed.", summary);
    return res.status(200).json({ success: true, summary });
  } catch (error) {
    console.error("Drip sequence run failed:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
