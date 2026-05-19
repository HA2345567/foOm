import fs from 'fs';
import path from 'path';

// Load .env variables before importing the email system
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value;
      }
    });
    console.log("Loaded environment variables from .env");
  }
} catch (err) {
  console.error("Error loading .env", err);
}

// Dynamically import the email funnel actions
const { 
  sendWelcomeEmail2, 
  sendCartAbandonmentEmail, 
  sendTwitterReferralEmail 
} = await import('../src/lib/email-system.ts');

const targetEmail = "curiousharsh03@gmail.com";

console.log(`Sending Welcome Email 2 to ${targetEmail}...`);
await sendWelcomeEmail2(targetEmail, "Harsh Bhardwaj");
console.log("✓ Welcome Email 2 Sent Successfully!");

console.log(`Sending Cart Abandonment Rescue Email to ${targetEmail}...`);
await sendCartAbandonmentEmail(targetEmail, "Harsh Bhardwaj");
console.log("✓ Cart Abandonment Email Sent Successfully!");

console.log(`Sending Twitter Referral Skip Email to ${targetEmail}...`);
await sendTwitterReferralEmail(targetEmail, "Harsh Bhardwaj");
console.log("✓ Twitter Referral Email Sent Successfully!");

console.log("🎉 All 3 funnel test emails sent successfully to Gmail SMTP!");
process.exit(0);
