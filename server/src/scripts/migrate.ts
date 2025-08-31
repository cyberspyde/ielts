import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'ielts_platform',
  user: process.env.DB_USER || 'ielts_user',
  password: process.env.DB_PASSWORD || 'ielts_password',
};

const db = new Pool(dbConfig);

// Migration tracking table
const createMigrationsTable = async (): Promise<void> => {
  const query = `
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );
  `;
  await db.query(query);
};

// Get executed migrations
const getExecutedMigrations = async (): Promise<string[]> => {
  const result = await db.query('SELECT filename FROM migrations ORDER BY id');
  return result.rows.map(row => row.filename);
};

// Mark migration as executed
const markMigrationExecuted = async (filename: string): Promise<void> => {
  await db.query('INSERT INTO migrations (filename) VALUES ($1)', [filename]);
};

// Get all migration files
const getMigrationFiles = (): string[] => {
  const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
  
  if (!fs.existsSync(migrationsDir)) {
    console.log('No migrations directory found');
    return [];
  }

  return fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.sql'))
    .sort();
};

// Execute a migration file
const executeMigration = async (filename: string): Promise<void> => {
  const migrationPath = path.join(__dirname, '..', '..', 'migrations', filename);
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
  
  console.log(`Executing migration: ${filename}`);
  
  try {
    await db.query(migrationSQL);
    await markMigrationExecuted(filename);
    console.log(`✓ Migration completed: ${filename}`);
  } catch (error) {
    console.error(`✗ Migration failed: ${filename}`);
    console.error(error);
    throw error;
  }
};

// Main migration function
const runMigrations = async (): Promise<void> => {
  try {
    console.log('Starting database migrations...');
    
    // Create migrations tracking table
    await createMigrationsTable();
    
    // Get all migration files and executed migrations
    const allMigrations = getMigrationFiles();
    const executedMigrations = await getExecutedMigrations();
    
    // Find pending migrations
    const pendingMigrations = allMigrations.filter(
      migration => !executedMigrations.includes(migration)
    );
    
    if (pendingMigrations.length === 0) {
      console.log('No pending migrations found');
      return;
    }
    
    console.log(`Found ${pendingMigrations.length} pending migrations`);
    
    // Execute pending migrations
    for (const migration of pendingMigrations) {
      await executeMigration(migration);
    }
    
    console.log('All migrations completed successfully');
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await db.end();
  }
};

// Run migrations if this script is executed directly
if (require.main === module) {
  runMigrations();
}

export { runMigrations };