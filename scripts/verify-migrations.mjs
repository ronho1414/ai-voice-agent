import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

async function main() {
  const db = new PGlite();
  console.log("1. Starting clean PostgreSQL instance via PGlite...");

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth;
    create table auth.users(id uuid primary key, banned_until timestamptz, is_anonymous boolean default false);
    create table auth.sessions(id uuid, user_id uuid, not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as
      $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.jwt(), auth.uid() to authenticated;
  `);
  console.log("2. Base Supabase auth schema and system roles initialized.");

  const migrationsDir = path.join(root, "supabase", "migrations");
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  console.log("3. Found migration files to apply:", files);

  for (const file of files) {
    const raw = await readFile(path.join(migrationsDir, file), "utf8");
    const sql = raw.replace(/create extension if not exists pgcrypto;/i, "");
    const t0 = Date.now();
    await db.exec(sql);
    console.log(`   ✓ Applied ${file} (${Date.now() - t0}ms)`);
  }

  // Verify all tables and RLS
  const { rows: tables } = await db.query(
    "select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename"
  );
  console.log("4. Public tables verification:");
  for (const t of tables) {
    if (!t.rowsecurity) throw new Error(`Table ${t.tablename} does NOT have RLS enabled!`);
    console.log(`   - ${t.tablename} (RLS: ${t.rowsecurity})`);
  }

  // Verify appointment transition trigger
  const { rows: triggers } = await db.query(
    "select tgname from pg_trigger where tgrelid = 'public.appointments'::regclass and not tgisinternal"
  );
  console.log("5. Appointments triggers:", triggers.map((t) => t.tgname));
  if (!triggers.some((t) => t.tgname === "enforce_appointment_transition")) {
    throw new Error("Trigger enforce_appointment_transition is missing!");
  }

  // Verify state transitions on the fresh database
  console.log("6. Verifying appointment state transition trigger on clean DB:");
  const testOrgId = "a0000000-0000-4000-8000-000000000001";
  await db.exec(`
    insert into public.organizations(id, name, slug) values ('${testOrgId}', 'Test Salon', 'test-salon');
    insert into public.appointments(id, organization_id, customer_name, customer_phone, appointment_time, status)
      values ('b0000000-0000-4000-8000-000000000001', '${testOrgId}', 'Customer Test', '+85291234567', now(), 'pending');
  `);

  // pending -> confirmed
  await db.query("update public.appointments set status = 'confirmed' where id = 'b0000000-0000-4000-8000-000000000001'");
  console.log("   ✓ pending -> confirmed succeeded");

  // confirmed -> completed
  await db.query("update public.appointments set status = 'completed' where id = 'b0000000-0000-4000-8000-000000000001'");
  console.log("   ✓ confirmed -> completed succeeded");

  // completed -> confirmed (revert!)
  await db.query("update public.appointments set status = 'confirmed' where id = 'b0000000-0000-4000-8000-000000000001'");
  console.log("   ✓ completed -> confirmed (revert) succeeded");

  // delete
  await db.query("delete from public.appointments where id = 'b0000000-0000-4000-8000-000000000001'");
  console.log("   ✓ delete succeeded");

  // invalid transition check: pending cannot jump to completed directly
  await db.exec(`
    insert into public.appointments(id, organization_id, customer_name, customer_phone, appointment_time, status)
      values ('b0000000-0000-4000-8000-000000000002', '${testOrgId}', 'Customer 2', '+85291234567', now(), 'pending');
  `);
  let invalidCaught = false;
  try {
    await db.query("update public.appointments set status = 'completed' where id = 'b0000000-0000-4000-8000-000000000002'");
  } catch (err) {
    invalidCaught = true;
    console.log("   ✓ pending -> completed properly rejected by trigger:", err.message);
  }
  if (!invalidCaught) throw new Error("Trigger failed to reject invalid transition pending -> completed!");

  await db.close();
  console.log("7. All migrations verified successfully on clean PostgreSQL!");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
