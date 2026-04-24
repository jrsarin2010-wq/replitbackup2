#!/bin/bash
set -e
pnpm install --frozen-lockfile

pnpm --filter @workspace/db run push-force

# Task #4: Migrate existing tenants to have an owner professional
# Creates an active owner professional for tenants that have no active professional.
# If an inactive owner already exists, reactivates it instead of inserting a new one.
# Run from lib/db so that require('pg') resolves correctly.
cd lib/db
node -e "
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
async function main() {
  await client.connect();

  const { rows } = await client.query(\`
    SELECT t.id, t.name, t.cro,
           ds.clinic_name, ds.professional_name, ds.working_hours_start,
           ds.working_hours_end, ds.working_days, ds.lunch_start, ds.lunch_end,
           ds.slot_duration_minutes
    FROM tenants t
    LEFT JOIN dental_settings ds ON ds.tenant_id = t.id
    WHERE NOT EXISTS (
      SELECT 1 FROM dental_professionals dp
      WHERE dp.tenant_id = t.id AND dp.is_active = true
    )
  \`);

  let created = 0;
  let reactivated = 0;
  let skipped = 0;

  for (const tenant of rows) {
    const name = tenant.professional_name || tenant.clinic_name || tenant.name;

    const inactiveOwner = await client.query(
      'SELECT id FROM dental_professionals WHERE tenant_id = \$1 AND is_owner = true AND is_active = false LIMIT 1',
      [tenant.id]
    );
    if (inactiveOwner.rows.length > 0) {
      await client.query(
        'UPDATE dental_professionals SET is_active = true, updated_at = NOW() WHERE id = \$1',
        [inactiveOwner.rows[0].id]
      );
      console.log('Reactivated owner professional for tenant ' + tenant.id + ': ' + name);
      reactivated++;
      continue;
    }

    const existingOwner = await client.query(
      'SELECT id FROM dental_professionals WHERE tenant_id = \$1 AND is_owner = true AND is_active = true LIMIT 1',
      [tenant.id]
    );
    if (existingOwner.rows.length > 0) {
      skipped++;
      continue;
    }

    await client.query(\`
      INSERT INTO dental_professionals
        (tenant_id, name, cro, is_owner, working_days, working_hours_start, working_hours_end, lunch_start, lunch_end, slot_duration_minutes, is_active, created_at, updated_at)
      VALUES (\$1, \$2, \$3, true, \$4, \$5, \$6, \$7, \$8, \$9, true, NOW(), NOW())
    \`, [tenant.id, name, tenant.cro || '', tenant.working_days || '1,2,3,4,5', tenant.working_hours_start || '08:00', tenant.working_hours_end || '18:00', tenant.lunch_start || '12:00', tenant.lunch_end || '13:00', tenant.slot_duration_minutes || 30]);
    console.log('Created owner professional for tenant ' + tenant.id + ': ' + name);
    created++;
  }

  console.log('Migration complete. Scanned: ' + rows.length + ', Created: ' + created + ', Reactivated: ' + reactivated + ', Skipped: ' + skipped);
  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
"
cd -

# Task (audio quota): Ensure all tenants have a dental_audio_credits row so
# the monthly quota (20 min) is available even if they never purchased credits.
cd lib/db
node -e "
const { Client } = require('pg');
const client = new Client({ connectionString: process.env.DATABASE_URL });
async function main() {
  await client.connect();
  const result = await client.query(\`
    INSERT INTO dental_audio_credits (tenant_id, balance, monthly_chars_used, monthly_reset_date)
    SELECT t.id, 0, 0, NOW()
    FROM tenants t
    WHERE NOT EXISTS (
      SELECT 1 FROM dental_audio_credits dac WHERE dac.tenant_id = t.id
    )
    RETURNING tenant_id
  \`);
  console.log('Bootstrapped dental_audio_credits for ' + result.rows.length + ' tenant(s)');
  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
"
cd -
