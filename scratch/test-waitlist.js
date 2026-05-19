import fs from 'fs';
import path from 'path';

// Manually parse .env file to load variables before doing anything else
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        // Remove quotes if present
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

// Dynamically import the handler so that env vars are set before Prisma client is imported
const { default: handler } = await import('../api/waitlist.js');

// Generate a dynamic email using Gmail '+' tagging so it bypasses unique constraints
const testEmail = `curiousharsh03+test${Date.now()}@gmail.com`;

// Mock Request & Response
const req = {
  method: 'POST',
  body: {
    email: testEmail // Replace with your actual email if you want to test receiving the email!
  }
};

const res = {
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(data) {
    console.log(`\n--- Response Status: ${this.statusCode || 200} ---`);
    console.log(JSON.stringify(data, null, 2));
    // Exit after logging
    process.exit(0);
  }
};

console.log(`Invoking waitlist handler with mock email: ${testEmail}...`);
handler(req, res).catch(err => {
  console.error("Handler error:", err);
  process.exit(1);
});
