# 🚀 START HIER - Route Optimizer SaaS Systeem

**Alles is klaar. Dit zijn je stappen (15 minuten totaal):**

---

## 📋 KORTE SAMENVATTING

Je hebt nu een volledig **SaaS systeem** met:
- ✅ User authentication (login/signup)
- ✅ Multi-tenant (bedrijf + meerdere chauffeurs)
- ✅ Admin panel (je kan alles monitoren)
- ✅ Billing model ready (€29/maand per bedrijf)
- ✅ Driver invitation system
- ✅ GitHub Pages deployment (live!)

---

## 🎯 VOLG DEZE STAPPEN:

### **STAP 1: Supabase Database Setup (3 min)**

➡️ Open: https://sxgqerkyjjhtvxygqzqc.supabase.co

1. **Log in** met je Supabase account
2. **SQL Editor** klikken (links in menu)
3. **+ New Query** klikken
4. **Alle SQL code hieronder kopieëren:**

```sql
-- Companies table
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

-- Profiles table (users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role VARCHAR(20) DEFAULT 'owner',
  company_id BIGINT REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Invites table
CREATE TABLE IF NOT EXISTS public.invites (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable security
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own company" ON public.companies
  FOR SELECT USING (owner_user_id = auth.uid());

CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "Unauthenticated users can view invites by token" ON public.invites
  FOR SELECT USING (true);
```

5. **Run** klikken (groen ✓ moet verschijnen)

---

### **STAP 2: Haal je Credentials (1 min)**

Nog in Supabase:

1. **Settings → API** (linkerkant menu)
2. **Project URL kopieëren:**
   ```
   https://sxgqerkyjjhtvxygqzqc.supabase.co
   ```
3. **Anon Public Key kopieëren** (zeer lange string, begint met `eyJ...`)
   - ⚠️ **Niet** "Service Role Key" pakken!

Plak deze ergens voor stap 3.

---

### **STAP 3: Test op GitHub Pages (3 min)**

1. **Open:** https://brentjansen7.github.io/routeplanner-post/
2. Je ziet: **Setup form** (twee input velden)
3. **Plak credentials:**
   - URL: `https://sxgqerkyjjhtvxygqzqc.supabase.co`
   - Anon Key: (je gekopieerde key)
4. **Klik: "✓ Save & Go to Login"**
5. ✓ Je ziet nu: **Login pagina**

---

### **STAP 4: Maak Account aan (3 min)**

Op login pagina:

1. **Klik: "Maak account aan →"**
2. **Vul formulier in:**
   - Bedrijfsnaam: `Test Company`
   - KvK: `12345678` (8 nummers)
   - Factuuradressen: Jouw adres
   - Email: `brent.jansen2009@gmail.com`
   - Wachtwoord: sterke wachtwoord
3. **Klik: "Registreren"**
4. ✓ Terug naar **Login pagina**

---

### **STAP 5: Login (1 min)**

1. **Email:** `brent.jansen2009@gmail.com`
2. **Wachtwoord:** (je wachtwoord van stap 4)
3. **Klik: "Inloggen"**
4. ✓ Je ziet: **Route Optimizer** Homepage! 🎉

---

### **STAP 6: Check Admin Panel (1 min)**

1. **URL:** https://brentjansen7.github.io/routeplanner-post/admin.html
2. Je ziet: **Tabel met je bedrijf**
3. Kolommen: Bedrijf | KvK | Status | Eigenaar | Chauffeurs | Trial einde
4. Status moet zijn: **"trial"** (14 dagen gratis)

---

### **STAP 7: Try Driver Invite (Optional, 2 min)**

1. **URL:** https://brentjansen7.github.io/routeplanner-post/team.html
2. Form: "Email van chauffeur"
3. Vul in: `test@example.com`
4. Klik: "Uitnodiging versturen"
5. Copy invite link → (zou naar een chauffeur gaan)

---

## 📁 GEGEVEN BESTANDEN (ALF KLAAR):

| Bestand | Doel |
|---------|------|
| `auth.js` | ✅ Auth module - logins/signups |
| `setup.html` | ✅ Credential form |
| `login.html` | ✅ Login pagina |
| `signup.html` | ✅ Signup pagina |
| `invite.html` | ✅ Driver acceptatie |
| `team.html` | ✅ Owner dashboard |
| `admin.html` | ✅ Jouw admin panel |
| `index.html` | ✅ Route Optimizer (auth-protected) |
| `QUICK_START.md` | 📖 Deze file (korte instructies) |
| `VERIFY_SETUP.html` | ✅ Checklist om progress te volgen |
| `setup-db.js` | 📖 Database setup helper |
| `config.example.js` | 📖 Config template |

---

## ✅ CHECKLIST

Print dit af en vink af:

- [ ] SQL script in Supabase gerunned
- [ ] Credentials gekopieerd (URL + Anon Key)
- [ ] GitHub Pages setup pagina bezocht
- [ ] Credentials ingevuld in setup form
- [ ] Account aangemaakt (signup)
- [ ] Succesvol ingelogd
- [ ] Route Optimizer homepage zichtbaar
- [ ] Admin panel werkt en toont bedrijf
- [ ] Logout knop werkt

**Alles groen? Je hebt een werkend SaaS systeem!** 🚀

---

## ❌ HELP - IETS WERKT NIET?

### Setup pagina verschijnt niet
- Refresh: **F5**
- Cache wissen: **Ctrl+Shift+Del**
- Private window proberen

### Login werkt niet
- Zeker dat SQL script gerund is?
- Zeker dat je dezelfde email gebruikt? (stap 4 vs stap 5)

### Admin panel: "No access"
- Alleen `brent.jansen2009@gmail.com` mag daar in
- Aanpassingen in: `admin.html` regel 118

### Credentials fout
- Zeker dat het **Anon Public Key** is? (niet Service Role)
- Zeker dat URL met `https://` begint?
- Zeker dat Key 50+ karakters lang is?

---

## 🎯 VOLGENDE STAPPEN (later)

1. **Pricing aanpassen?** → `admin.html` updaten
2. **Drivers echte emails sturen?** → Email template maken
3. **Cold emails via CEO?** → `/ceo` skill gebruiken
4. **Billing integreren?** → Stripe/Mollie setup
5. **Notion CRM?** → `project_ceo.md` checken

---

## 📞 SUPPORT

Alle instructies en extra info:
- `QUICK_START.md` ← Je bent hier
- `VERIFY_SETUP.html` ← Interactieve checklist
- `SETUP_INSTRUCTIONS.md` ← Uitgebreide gids

🎉 **Good luck!**
