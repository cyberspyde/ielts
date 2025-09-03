import { db, logger } from '../config/database-no-redis';

async function ensureHeadingBankColumn(): Promise<void> {
  try {
    logger.info('Adding exam_sections.heading_bank if missing...');
    await db.query(`
      ALTER TABLE exam_sections
      ADD COLUMN IF NOT EXISTS heading_bank JSONB
    `);

    const check = await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'exam_sections' AND column_name = 'heading_bank'`
    );

    if (check.rowCount && check.rowCount > 0) {
      logger.info('Column heading_bank is present on exam_sections');
    } else {
      throw new Error('Column heading_bank not present after ALTER TABLE');
    }
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  ensureHeadingBankColumn().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

export {}; 



