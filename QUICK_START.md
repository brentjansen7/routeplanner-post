# ⚡ Quick Start (5 minuten)

## STAP 1: Supabase Database Setup (2 min)

1. Open: https://sxgqerkyjjhtvxygqzqc.supabase.co
2. Log in met je Supabase account
3. Klik op **SQL Editor** (links in menu)
4. Klik **+ New Query**
5. **Plak de code hieronder:**

```sql
-- Create companies table
CREATE TABLE IF NOT EXISTS public.companies (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  kvk VARCHAR(8) NOT NULL UNIQUE,
  billing_address TEXT,
  plan_status VARCHAR(20) DEFAULT 'trial',
  trial_ends_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '14 days'),
  owner_user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role VARCHAR(20) DEFAULT 'owner',
  company_id BIGINT REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create invites table
CREATE TABLE IF NOT EXISTS public.invites (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS (Row Level Security)
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- RLS Policies for companies
CREATE POLICY "Users can view own company" ON public.companies
  FOR SELECT USING (owner_user_id = auth.uid());

-- RLS Policies for profiles
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (id = auth.uid());

-- RLS Policies for invites
CREATE POLICY "Unauthenticated users can view invites by token" ON public.invites
  FOR SELECT USING (true);
```

6. Klik **Run** (of Ctrl+Enter)
7. Wacht tot groen ✓ verschijnt

---

## STAP 2: Haal Credentials (1 min)

1. **Settings → API** (links in Supabase menu)
2. **Project URL kopieëren:** `https://sxgqerkyjjhtvxygqzqc.supabase.co`
3. **Anon Public Key kopieëren:** heel lang string, begint met `eyJ...`
4. **Service Role Key NIET gebruiken!** (alleen anon public)

---

## STAP 3: Test Setup Page (2 min)

1. Open: https://brentjansen7.github.io/routeplanner-post/
2. Je ziet: **Setup form**
3. Plak credentials:
   - URL: `https://sxgqerkyjjhtvxygqzqc.supabase.co`
   - Key: (je anon public key)
4. Klik: **✓ Save & Go to Login**
5. Je ziet nu: **Login scherm**

---

## STAP 4: Maak Account aan (Signup)

1. Klik: **"Maak account aan →"** (link op loginpagina)
2. Vul in:
   - **Bedrijfsnaam**: Test Company
   - **KvK**: 12345678 (8 nummers)
   - **Factuuradressen**: Jouw adres
   - **Email**: brent.jansen2009@gmail.com
   - **Wachtwoord**: iets sterks
3. Klik: **Registreren**
4. Automatisch terug naar **Login**

---

## STAP 5: Login & Test

1. Vul je email/password in
2. Klik: **Inloggen**
3. Je ziet nu: **Route Optimizer** homepage! ✓

---

## STAP 6: Admin Panel Testen

1. URL: https://brentjansen7.github.io/routeplanner-post/admin.html
2. Je ziet: Tabel met jouw bedrijf
3. Kolommen: Bedrijf | KvK | Status | Eigenaar | Chauffeurs | Trial eindt

---

## STAP 7: Driver Uitnodiging Testen (Bonus)

1. URL: https://brentjansen7.github.io/routeplanner-post/team.html
2. Form: "Email van chauffeur"
3. Vul in: test.driver@example.com
4. Klik: **Uitnodiging versturen**
5. Copy invite link
6. (Zou naar driver gaan, kunnen we later testen)

---

## ✅ Klaar!

Als alles groen is: **Je hebt een werkend SaaS systeem!**

## ❌ Problemen?

### Setup page verschijnt niet
- Refresh pagina (F5)
- Wis cache: Ctrl+Shift+Del → Cookies & cache
- Probeer andere browser

### Inloggen werkt niet
- Zeker dat database tabel gemaakt is? (Run SQL in stap 1)
- Zeker dat signup email gelijk is aan login email?

### Admin panel: "No access"
- Alleen brent.jansen2009@gmail.com mag daar in
- Aanpassen in: `admin.html` regel 118

---

## 📁 Wat Staat Op GitHub

- **main branch** → GitHub Pages deployment
- **Alle auth files** → klaar en tested
- **Setup werkt offline** → localStorage fallback

## 🚀 Volgende Stap

Wanneer je wilt uitbreiden:
- Marketing emails? → Notion CRM setup
- Cold emails? → `/ceo` skill
- Drivers toevoegen? → Team dashboard
