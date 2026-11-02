/**
 * Creation securisee du premier administrateur.
 *
 * Usage:
 *   npm run create-admin -- admin@sos-sang.local
 *   ADMIN_INITIAL_PASSWORD='...' npm run create-admin -- admin@sos-sang.local
 *
 * Sans ADMIN_INITIAL_PASSWORD, un mot de passe aleatoire est genere et affiche
 * UNE SEULE FOIS. Aucun identifiant n'est ecrit dans le depot.
 */
import path from 'node:path';
import { createServicePool, generatePassword, hashPassword, passwordIssues } from '@sos/shared';

// Mode embarque (PGlite): une seule session PostgreSQL derriere plusieurs
// connexions. Sans effet genant sur un PostgreSQL classique (script mono-processus).
process.env.SINGLE_SESSION_DB = process.env.SINGLE_SESSION_DB ?? 'true';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    // eslint-disable-next-line no-console
    console.error('Usage: npm run create-admin -- <email>');
    process.exit(1);
  }

  const connectionString =
    process.env.DATABASE_URL ?? `postgres://postgres:postgres@127.0.0.1:5433/postgres`;

  const pool = await createServicePool({
    connectionString,
    schema: process.env.AUTH_DB_SCHEMA ?? 'auth',
    migrationsDir: path.resolve(__dirname, '..', 'services', 'auth-service', 'migrations'),
  });

  const password = process.env.ADMIN_INITIAL_PASSWORD ?? generatePassword(24);
  const issues = passwordIssues(password);
  if (issues.length) {
    // eslint-disable-next-line no-console
    console.error('Mot de passe refuse:', issues.join(', '));
    await pool.end();
    process.exit(1);
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
    if (existing.rowCount) {
      await pool.query(
        `UPDATE users SET role = 'ADMIN', status = 'ACTIVE', password_hash = $2, deleted_at = NULL,
           must_change_password = true, updated_at = now() WHERE lower(email) = lower($1)`,
        [email, await hashPassword(password)],
      );
      // eslint-disable-next-line no-console
      console.log(`Compte existant promu administrateur: ${email}`);
    } else {
      await pool.query(
        `INSERT INTO users(email, password_hash, role, full_name, status, must_change_password)
         VALUES ($1,$2,'ADMIN','Administrateur SOS Sang','ACTIVE', true)`,
        [email, await hashPassword(password)],
      );
      // eslint-disable-next-line no-console
      console.log(`Administrateur cree: ${email}`);
    }
    await pool.query(
      `INSERT INTO audit_log(actor_role, action, target_type, metadata)
       VALUES ('SYSTEM','ADMIN_BOOTSTRAPPED','user',$1)`,
      [JSON.stringify({ email, source: process.env.ADMIN_INITIAL_PASSWORD ? 'env' : 'cli-generated' })],
    );

    if (!process.env.ADMIN_INITIAL_PASSWORD) {
      // eslint-disable-next-line no-console
      console.log(`Mot de passe genere (affiche une seule fois): ${password}`);
      console.log('Changez-le a la premiere connexion.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('create-admin:', err);
  process.exit(1);
});
