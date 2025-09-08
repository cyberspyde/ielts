import { query, logger } from '../config/database-no-redis';
import bcrypt from 'bcryptjs';

async function run() {
  const args = process.argv.slice(2);
  let password = 'admin123';
  for (let i=0;i<args.length;i++) {
    if (args[i] === '--password' && args[i+1]) { password = args[i+1]; }
  }
  const hash = await bcrypt.hash(password, 10);
  const email = 'admin@bestcenter.com';
  const res = await query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (res.rows.length === 0) {
    await query(`INSERT INTO users (email, password_hash, first_name, last_name, role, status, email_verified) VALUES ($1,$2,'System','Administrator','super_admin','active',true)`, [email, hash]);
    logger.info('Admin created', { email });
  } else {
    await query(`UPDATE users SET password_hash=$1, updated_at = CURRENT_TIMESTAMP WHERE email=$2`, [hash, email]);
    logger.info('Admin password reset', { email });
  }
  console.log(`Admin password set to: ${password}`);
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
