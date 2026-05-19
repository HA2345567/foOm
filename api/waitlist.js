import pg from "pg";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { waitUntil } from "@vercel/functions";

const { Pool } = pg;

// Initialize standard Postgres client pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Configure Nodemailer transporter supporting both SMTP_* and EMAIL_* keys with connection pooling
const transporter = nodemailer.createTransport({
  pool: true, // Enable connection pooling for faster reused connections
  host: process.env.SMTP_HOST || process.env.EMAIL_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || process.env.EMAIL_PORT || "587", 10),
  secure: (process.env.SMTP_PORT || process.env.EMAIL_PORT) === "465", // true for 465 (SMTPS), false for 587 (STARTTLS)
  auth: {
    user: process.env.SMTP_USER || process.env.EMAIL_USER,
    pass: process.env.SMTP_PASS || process.env.EMAIL_PASS,
  },
  maxConnections: 5,
  maxMessages: 100,
});

const FROM = `"foOm" <${process.env.SMTP_USER || process.env.EMAIL_USER}>`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email, name } = req.body;

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email is required" });
  }

  try {
    const id = `wl_${crypto.randomUUID().replace(/-/g, "").substring(0, 22)}`;
    const now = new Date();

    // Insert into the PostgreSQL Waitlist table directly using pg
    const query = 'INSERT INTO "Waitlist" (id, email, "createdAt") VALUES ($1, $2, $3) RETURNING *';
    const values = [id, email, now];

    // Query Neon database concurrently to save round-trip time
    const [result, countResult] = await Promise.all([
      pool.query(query, values),
      pool.query('SELECT COUNT(*) FROM "Waitlist";')
    ]);

    const waitlistEntry = result.rows[0];
    const position = parseInt(countResult.rows[0].count, 10);

    // Send the premium welcome email with waitlist position
    if (process.env.SMTP_USER || process.env.EMAIL_USER) {
      const displayName = name ? name.split(" ")[0] : "there";
      const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Welcome to foOm</title>
</head>
<body style="margin:0;padding:40px 20px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;line-height:1.7;font-size:16px;-webkit-font-smoothing:antialiased;">

<div style="max-width:560px;margin:0 auto;">
  <div style="text-align: center; margin-bottom: 40px;">
    <!-- Premium dark-themed brand header lockup matching Screenshot 2026-05-19 013904.png exactly -->
    <div style="display: inline-block; padding: 12px 28px; background: #0A0A0D; border-radius: 16px; border: 1px solid #1F2430;">
      <table cellpadding="0" cellspacing="0" style="border-collapse: collapse; margin: 0 auto;">
        <tr>
          <td style="vertical-align: middle;">
            <!-- foOm brand name in crisp bold white matching the screenshot -->
            <span style="font-size: 26px; font-weight: 800; letter-spacing: -1px; color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1;">
              foOm
            </span>
          </td>
        </tr>
      </table>
    </div>
  </div>

  <p>Hi ${displayName},</p>

  <p>Thanks for joining the foOm waitlist! We're building a next-generation browser-native screen recorder designed specifically for creators, developers, and modern product teams.</p>

  <p style="margin:24px 0;padding:16px 20px;background:#f8fafc;border-left:4px solid #8b5cf6;border-radius:4px;font-size:15px;color:#334155;">
    <strong>Your Waitlist Position:</strong> #${position}
  </p>

  <p>Here's everything you can do with foOm right in your browser:</p>

  <ul style="padding-left:20px;margin:16px 0;line-height:1.8;">
    <li style="margin-bottom:10px;"><strong>Smart Auto-Zoom:</strong> Automatically zooms into your clicks, typing, and UI interactions with cinematic, physics-eased camera pans.</li>
    <li style="margin-bottom:10px;"><strong>Silence & Pause Removal:</strong> Automatically detects and removes dead pauses to keep your presentation pacing tight and engaging.</li>
    <li style="margin-bottom:10px;"><strong>Auto Subtitles:</strong> Speech-to-text powered by Whisper running fully locally in your browser. Edit, style, and bake them into your video.</li>
    <li style="margin-bottom:10px;"><strong>Cursor Intelligence:</strong> Highlights intentional clicks, filters out accidental mouse drift, and adds premium spotlight visual guides.</li>
    <li style="margin-bottom:10px;"><strong>Webcam Overlay:</strong> Add your face in a fully customizable camera bubble (circle, rounded, or square) positioned anywhere on screen.</li>
    <li style="margin-bottom:10px;"><strong>Studio Audio & Music:</strong> Clean up background noise automatically and mix in royalty-free background tracks to complete the vibe.</li>
  </ul>



  <p>We'll notify you as soon as your priority server access is ready.</p>

  <p style="margin-top:40px;color:#64748b;">
    Best,<br/>
    The foOm Team
  </p>

  <hr style="margin:48px 0 24px 0;border:0;border-top:1px solid #e2e8f0;"/>

  <p style="font-size:12px;color:#94a3b8;line-height:1.5;">
    You received this because you joined the priority foOm waiting list.<br/>
    If this was a mistake, you can <a href="https://foom-sepia.vercel.app/unsubscribe?email=${encodeURIComponent(email)}" style="color:#8b5cf6;text-decoration:none;">unsubscribe here</a>.
  </p>
</div>

</body>
</html>
        `;

      waitUntil(
        transporter.sendMail({
          from: FROM,
          to: email,
          subject: ` You're on the foOm waitlist, ${displayName}`,
          html,
          text: `Hey ${displayName}, you're on the foOm waitlist! Visit https://foom-sepia.vercel.app to learn more.`,
        }).then(() => {
          console.log(`Custom waitlist welcome email successfully sent to ${email} (Position #${position}) via Gmail SMTP.`);
        }).catch((emailError) => {
          console.error("Failed to send welcome email via SMTP in background:", emailError);
        })
      );
    } else {
      console.log("No SMTP credentials found in environment, skipping welcome email.");
    }

    return res.status(200).json({ success: true, entry: waitlistEntry });
  } catch (error) {
    // Handle unique constraint violation (PostgreSQL error code 23505)
    if (error.code === "23505") {
      return res.status(409).json({ error: "Email is already on the waitlist" });
    }
    console.error("Error adding to waitlist:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
