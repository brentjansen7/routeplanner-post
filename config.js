// Auto-generated config from .env.local values
// If empty, prompt user to configure

window.ENV = {
  SUPABASE_URL: 'https://sxgqerkyjjhtvxygqzqc.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4Z3Flcmt5ampodHZ4eWdxenFjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzEwNDAsImV4cCI6MjA5Mjc0NzA0MH0.8uRPO5G7q0MuShpBDMuJULu-muIxUqfNSxglJd1JHsM'
};

// If anon key is empty, prompt to add it 
if (!window.ENV.SUPABASE_ANON_KEY) {
  const key = prompt('Paste your Supabase ANON_PUBLIC_KEY:');
  if (key) {
    window.ENV.SUPABASE_ANON_KEY = key;
    alert('✓ Key saved to localStorage for this session');
  }
}
