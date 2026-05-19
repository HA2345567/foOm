import fs from 'fs';
import path from 'path';
import pg from 'pg';

const { Pool } = pg;

// Load environment variables
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

async function runDripTest() {
  console.log("Setting up mock waitlist entries in Neon Postgres...");
  
  // Clean first
  await pool.query('DELETE FROM "Waitlist" WHERE email = \'driptest@gmail.com\';');
  
  // Insert one mock user who signed up exactly 26 hours ago (Eligible for Welcome Email 2)
  const id = `wl_test_${Math.random().toString(36).substring(2, 10)}`;
  const email = "driptest@gmail.com";
  // Set createdAt date back by 26 hours
  const createdAt = new Date(Date.now() - (26 * 60 * 60 * 1000));
  
  await pool.query(
    'INSERT INTO "Waitlist" (id, email, "createdAt", "lastDripSent") VALUES ($1, $2, $3, $4);',
    [id, email, createdAt, 1]
  );
  console.log(`✓ Inserted mock user: ${email} signed up 26 hours ago (lastDripSent: 1)`);

  // Dynamically import our serverless cron handler
  const { default: dripHandler } = await import('../api/drip-waitlist.js');

  // Mock Request & Response
  const req = {
    headers: {},
  };

  const res = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      console.log(`\n--- Drip Cron Response Status: ${this.statusCode || 200} ---`);
      console.log(JSON.stringify(data, null, 2));
      
      // Verify and cleanup
      verifyAndCleanup().catch(console.error);
    }
  };

  console.log("\nInvoking /api/drip-waitlist serverless handler...");
  await dripHandler(req, res);
}

async function verifyAndCleanup() {
  // Query db state for the mock user
  const result = await pool.query('SELECT * FROM "Waitlist" WHERE email = \'driptest@gmail.com\';');
  const record = result.rows[0];
  
  console.log("\n--- Verification ---");
  if (record) {
    console.log(`Mock user lastDripSent stage is now: ${record.lastDripSent} (Expected: 2)`);
    if (record.lastDripSent === 2) {
      console.log("🎉 SUCCESS! State was correctly updated in Postgres to prevent double-sending!");
    } else {
      console.log("✗ ERROR! State update failed.");
    }
  } else {
    console.log("✗ ERROR! Mock user record not found.");
  }

  // Cleanup
  console.log("\nCleaning mock waitlist entries from database...");
  await pool.query('DELETE FROM "Waitlist" WHERE email = \'driptest@gmail.com\';');
  console.log("✓ Database is clean and pristine!");
  
  await pool.end();
  process.exit(0);
}

runDripTest().catch(async (err) => {
  console.error("Test execution failed:", err);
  await pool.end();
  process.exit(1);
});
