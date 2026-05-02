import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ VITE_SUPABASE_URL of VITE_SUPABASE_ANON_KEY niet ingevuld in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const setupSQL = `
-- Companies table
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kvk TEXT UNIQUE NOT NULL,
  billing_address TEXT NOT NULL,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_status TEXT DEFAULT 'trial',
  trial_ends_at TIMESTAMP DEFAULT (NOW() + INTERVAL '14 days'),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT DEFAULT 'driver',
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users see their own company" ON companies
  FOR SELECT USING (
    auth.uid() = owner_user_id OR
    EXISTS (SELECT 1 FROM profiles p WHERE p.company_id = companies.id AND p.id = auth.uid()) OR
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

CREATE POLICY IF NOT EXISTS "Users see profiles in their company" ON profiles
  FOR SELECT USING (
    company_id IN (SELECT id FROM companies WHERE owner_user_id = auth.uid()) OR
    id = auth.uid() OR
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

CREATE POLICY IF NOT EXISTS "Owner sees invites of their company" ON invites
  FOR SELECT USING (
    company_id IN (SELECT id FROM companies WHERE owner_user_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );
`;

async function setup() {
  try {
    console.log('🔧 Database aan het opzetten...');
    const { error } = await supabase.rpc('exec', { sql: setupSQL }).catch(() =>
      // Fallback: probeer via SQL editor (werkt niet via JS client)
      ({ error: 'RPC not available - use Supabase SQL editor' })
    );

    if (error) {
      console.warn('⚠️  RPC methode niet beschikbaar. Ga naar Supabase → SQL Editor en copy-paste dit:');
      console.log('\n' + setupSQL);
      console.log('\n⚠️  Let op: je moet dit handmatig in Supabase SQL Editor runnen.');
    } else {
      console.log('✅ Database setup klaar!');
    }
  } catch (err) {
    console.warn('⚠️  RPC niet beschikbaar - voer dit handmatig uit in Supabase SQL Editor:');
    console.log('\n' + setupSQL);
  }
}

setup();
