import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/+esm';

// Load from window.ENV (set in config.js) or localStorage
let supabaseUrl = window.ENV?.SUPABASE_URL || localStorage.getItem('ENV_SUPABASE_URL') || '';
let supabaseAnonKey = window.ENV?.SUPABASE_ANON_KEY || localStorage.getItem('ENV_SUPABASE_ANON_KEY') || '';

const hasRealCredentials = !!(supabaseUrl && supabaseAnonKey);

if (!hasRealCredentials) {
  if (!window.location.pathname.includes('setup.html')) {
    console.warn('⚠️ Missing Supabase credentials. Redirecting to setup...');
    window.location.href = 'setup.html';
  }
  supabaseUrl = supabaseUrl || 'https://placeholder.supabase.co';
  supabaseAnonKey = supabaseAnonKey || 'placeholder-key';
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export { hasRealCredentials };

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getCurrentProfile() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data } = await supabase
    .from('profiles')
    .select('*, companies(name, kvk, plan_status)')
    .eq('id', user.id)
    .single();

  return data;
}

export async function signUp(email, password, companyName, kvk, billingAddress) {
  const { data: { user }, error: signupError } = await supabase.auth.signUp({
    email,
    password,
  });

  if (signupError) throw signupError;
  if (!user) throw new Error('Signup failed');

  const { data: company, error: companyError } = await supabase
    .from('companies')
    .insert([{
      name: companyName,
      kvk,
      billing_address: billingAddress,
      owner_user_id: user.id,
    }])
    .select()
    .single();

  if (companyError) throw companyError;

  const { error: profileError } = await supabase
    .from('profiles')
    .insert([{
      id: user.id,
      email,
      full_name: companyName,
      role: 'owner',
      company_id: company.id,
    }]);

  if (profileError) throw profileError;

  return { user, company };
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) throw error;
  return data.user;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCompanyDrivers(companyId) {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('company_id', companyId)
    .eq('role', 'driver');

  return data || [];
}

export async function createInvite(companyId, email) {
  const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('invites')
    .insert([{
      company_id: companyId,
      email,
      token,
      expires_at: expiresAt,
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function acceptInvite(token, password, fullName) {
  const { data: invite, error: inviteError } = await supabase
    .from('invites')
    .select('*')
    .eq('token', token)
    .single();

  if (inviteError) throw inviteError;
  if (!invite) throw new Error('Invalid invite token');
  if (new Date(invite.expires_at) < new Date()) throw new Error('Invite expired');

  const { data: { user }, error: signupError } = await supabase.auth.signUp({
    email: invite.email,
    password,
  });

  if (signupError) throw signupError;
  if (!user) throw new Error('Signup failed');

  const { error: profileError } = await supabase
    .from('profiles')
    .insert([{
      id: user.id,
      email: invite.email,
      full_name: fullName,
      role: 'driver',
      company_id: invite.company_id,
    }]);

  if (profileError) throw profileError;

  const { error: updateError } = await supabase
    .from('invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', invite.id);

  if (updateError) throw updateError;

  return user;
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}
