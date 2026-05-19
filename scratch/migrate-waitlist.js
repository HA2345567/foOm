import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

// Load environment
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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration() {
  console.log("Connecting to PostgreSQL...");
  const client = await pool.connect();
  try {
    console.log("Adding column 'lastDripSent' to 'Waitlist' table if not exists...");
    await client.query('ALTER TABLE "Waitlist" ADD COLUMN IF NOT EXISTS "lastDripSent" INTEGER DEFAULT 1;');
    console.log("🎉 Successfully added 'lastDripSent' column!");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
