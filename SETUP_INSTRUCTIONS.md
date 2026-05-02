# 🚀 Route Optimizer Setup Instructions

## What's Fixed
✓ Auth system with Supabase integration
✓ Setup page for credential configuration  
✓ Login system with email/password
✓ Admin panel (you only) to monitor companies
✓ Driver invitation system
✓ Subscription model: €29/month per company, unlimited drivers

## How to Test

### Step 1: Get Your Supabase Credentials
1. Go to https://supabase.com
2. Sign in to your project: https://sxgqerkyjjhtvxygqzqc.supabase.co
3. Go to **Settings → API**
4. Copy the **Project URL** (https://sxgqerkyjjhtvxygqzqc.supabase.co)
5. Copy the **anon public key** (starts with eyJ...)

### Step 2: Visit Your GitHub Pages Site
1. Go to: https://brentjansen7.github.io/routeplanner-post/
2. You should see **Setup form** asking for Supabase credentials
3. Paste your URL and anon key
4. Click **Save & Go to Login**

### Step 3: Create Company Account (Sign Up)
1. You should be on **login.html**
2. Click **"Maak account aan"** (Create account)
3. Fill in:
   - **Bedrijfsnaam**: Test Company
   - **KvK**: 12345678 (8 digits)
   - **Factuuradressen**: Your address
   - **Email**: brent.jansen2009@gmail.com
   - **Wachtwoord**: Your password
4. Click **Registreren**
5. You should be redirected back to **login.html**

### Step 4: Login
1. Enter your email and password
2. Click **Inloggen**
3. You should be redirected to **index.html** (Route Optimizer)

### Step 5: Access Admin Panel
1. In your browser address bar, go to: `/admin.html`
2. You should see a table with your company listed
3. Shows: Company name, KvK, Plan status (trial), Owner email, Driver count, Trial end date

### Step 6: Invite a Driver (Optional)
1. In your browser, go to: `/team.html`
2. You should see your company profile
3. There's a form to invite drivers
4. Enter an email (e.g., test@example.com)
5. Click **Uitnodiging versturen**
6. An invite link is generated (save it)
7. Share the link with a driver, they can accept with a password

## Files Changed
- ✅ **auth.js** - Authentication module with Supabase
- ✅ **setup.html** - Credential configuration form
- ✅ **login.html** - Login form
- ✅ **signup.html** - Company registration form
- ✅ **invite.html** - Driver invitation acceptance
- ✅ **team.html** - Owner dashboard to manage drivers
- ✅ **admin.html** - Your admin panel (hardcoded for your email)
- ✅ **index.html** - Added auth check + logout button
- ✅ **config.js** - Local development (not in git)
- ✅ **config.example.js** - Template for users
- ✅ **.gitignore** - Added config.js (no secrets in git)

## Database Tables Required (in Supabase)
Run setup-db.js in your Supabase dashboard:
- **companies** - name, kvk, plan_status, trial_ends_at, owner_user_id
- **profiles** - id, email, full_name, role (owner/driver), company_id
- **invites** - company_id, email, token, expires_at, used_at

## Troubleshooting

### "I see nothing" / Blank page
- Clear browser cache (Ctrl+Shift+Del)
- Try incognito/private window
- Wait 5 min for GitHub Pages to update

### Setup form doesn't appear
- Check your browser console (F12 → Console)
- Verify you're on GitHub Pages: https://brentjansen7.github.io/routeplanner-post/
- Try `/setup.html` directly

### "Invalid credentials" when submitting setup
- Verify URL starts with `https://`
- Verify URL contains `supabase.co`
- Verify anon key is 50+ characters (it's very long)

### Login doesn't work
- Make sure database tables exist in Supabase
- Check you created your account via signup first

## GitHub Pages URL
https://brentjansen7.github.io/routeplanner-post/

## Deploy Changes
```bash
git push origin main
```
(GitHub Pages will update within 1-2 minutes)
