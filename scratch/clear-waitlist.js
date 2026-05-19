import pg from "pg";
import fs from "fs";
import path from "path";

// Load .env variables into process.env
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, "utf8");
    envConfig.split("\n").forEach((line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = (match[2] || "").trim();
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value;
      }
    });
  }
} catch (err) {
  console.error("Error loading .env:", err);
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function clearWaitlist() {
  console.log("Connecting to Neon PostgreSQL database...");
  try {
    // Delete all records in the Waitlist table
    const result = await pool.query('DELETE FROM "Waitlist" RETURNING *;');
    console.log(`\n🎉 Success! Successfully cleared the "Waitlist" table.`);
    console.log(`Deleted ${result.rowCount} test entry/entries.`);
  } catch (error) {
    console.error("Error truncating Waitlist table:", error);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

clearWaitlist();
