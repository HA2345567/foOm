/**
 * @file email-system.ts
 * @description Email notification pipeline for foOm waitlist & launch announcements.
 *
 * NOTE: Provides Nodemailer template helpers with rate-limit protections.
 */

export interface EmailRecipient {
  email: string;
  name: string;
  position?: number;
}

export function generateWaitlistHtml(name: string, position: number): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { background-color: #0b0c10; color: #f0f0f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px 20px; }
    .card { max-width: 560px; margin: 0 auto; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 32px; backdrop-filter: blur(20px); }
    .logo { font-size: 24px; font-weight: 800; background: linear-gradient(135deg, #FF512F 0%, #DD2476 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .badge { display: inline-block; background: rgba(221, 36, 118, 0.2); border: 1px solid #DD2476; color: #ff758c; padding: 6px 16px; border-radius: 20px; font-weight: 700; margin: 20px 0; }
    .btn { display: block; text-align: center; background: linear-gradient(135deg, #FF512F 0%, #DD2476 100%); color: #fff; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: 600; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">foOm</div>
    <h2>🚀 You're on the foOm waitlist, ${name}!</h2>
    <p>We turn raw screen recordings into cinematic demos automatically with smart spring autozoom.</p>
    <div class="badge">Waitlist Spot #${position}</div>
    <p>Features included in your early access pass:</p>
    <ul>
      <li>Smart Cinematic Spring Autozoom</li>
      <li>Automatic Silence Removal</li>
      <li>AI-Generated Captions (Gemini)</li>
      <li>Windows + Mac Native Support</li>
    </ul>
    <a href="https://foom.app" class="btn">View Your Waitlist Status</a>
  </div>
</body>
</html>
  `.trim();
}

export function generateLaunchHtml(name: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { background-color: #0b0c10; color: #f0f0f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px 20px; }
    .card { max-width: 560px; margin: 0 auto; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 32px; }
    .hero-banner { background: linear-gradient(135deg, #FF512F 0%, #DD2476 100%); padding: 16px; border-radius: 12px; text-align: center; font-weight: 800; font-size: 20px; margin-bottom: 24px; }
    .btn { display: block; text-align: center; background: #ffffff; color: #000; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: 700; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="hero-banner">🔥 foOm IS OFFICIALLY LIVE</div>
    <h2>You're first in, ${name}!</h2>
    <p>Download foOm for Windows or Mac now and record your first cinematic demo in seconds.</p>
    <a href="https://foom.app/download" class="btn">Download foOm Desktop App</a>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Batch launch announcement dispatcher with rate limiting.
 */
export async function blastLaunchAnnouncement(
  recipients: EmailRecipient[],
  sendFn: (to: string, subject: string, html: string) => Promise<void>,
  delayMs: number = 200
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (const user of recipients) {
    try {
      const html = generateLaunchHtml(user.name);
      await sendFn(user.email, `🔥 foOm is LIVE — you're first in, ${user.name}`, html);
      sent++;
    } catch {
      failed++;
    }
    // Rate limit delay between emails
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return { sent, failed };
}
