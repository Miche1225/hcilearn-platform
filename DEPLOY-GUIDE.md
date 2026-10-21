# Pag-deploy ng HCILearn (Render + Supabase + Cloudinary) — LIBRE, hindi nawawala ang data

Na-convert na ang backend mula SQLite (local file) papuntang Postgres (hosted, hiwalay
sa server). Kahit matulog o mag-restart ang free web service mo sa Render, hindi
maaapektuhan ang mga user account, progress, at profile photos dahil naka-store na sila
sa Supabase at Cloudinary — hindi na sa disk ng server mismo.

## 1. Gumawa ng libreng Postgres database (Supabase)

1. Mag-sign up sa https://supabase.com (libre, pwedeng gamit GitHub account).
2. Gumawa ng bagong Project.
3. Pumunta sa **Project Settings > Database > Connection string** (pili ng "URI" /
   "Transaction pooler" mode).
4. Kopyahin ang connection string, palitan ang `[YOUR-PASSWORD]` ng password na
   ginamit mo sa paggawa ng project. Ito ang ilalagay mo sa `DATABASE_URL`.

## 2. Gumawa ng libreng Cloudinary account (para sa profile photos)

1. Mag-sign up sa https://cloudinary.com (libreng plan).
2. Sa Dashboard, makikita ang **Cloud name**, **API Key**, at **API Secret** — kopyahin
   ang tatlo.

## 3. I-deploy sa Render

1. I-push ang code na ito sa isang GitHub repo.
2. Sa https://render.com, gumawa ng bagong **Web Service**, ikonekta ang repo mo.
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
4. Sa **Environment** tab, idagdag ang mga sumusunod (huwag i-commit ang mga ito sa
   Git — dito lang sila ilalagay, sa dashboard ng Render):
   - `DATABASE_URL` = yung Supabase connection string mo
   - `JWT_SECRET` = mahabang random string (hindi bababa sa 32 characters)
   - `EMAIL_HASH_SECRET` = isa pang mahabang random string (32+ characters).
     **Huwag na itong palitan kapag may users na**, kundi hindi na sila
     makakapag-login gamit ang email nila.
   - `NODE_ENV` = `production`
   - `APP_URL` = ang Render URL mo (hal. `https://your-app.onrender.com`), para
     tama ang link sa "reset password" email
   - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` = mula
     sa Cloudinary dashboard
   - `BREVO_API_KEY` at `EMAIL_FROM` = para sa mga email (signup, login alert,
     forgot password). Kailangan ang Brevo sa **free** Render dahil naka-block
     doon ang Gmail SMTP. Kumuha ng libreng key sa https://brevo.com
     (SMTP & API > API Keys), at gumamit ng sender email na na-verify mo sa Brevo.

   Para gumawa ng random string para sa mga secret:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
5. I-deploy. Sa unang pag-start, awtomatikong gagawin ni `src/db.js` ang lahat ng
   tables sa Supabase (`CREATE TABLE IF NOT EXISTS...`) — hindi mo na kailangan
   manual mag-run ng SQL.

## 4. Gumawa ng instructor account (para sa Admin Dashboard)

Hiwalay ang instructor accounts sa student accounts (Instructor ID + password).
Sa sarili mong computer, habang naka-set sa `.env` ang `DATABASE_URL` ng
Supabase project mo:

```bash
npm run instructor -- add --id 122524 --name "Pangalan ng Instructor"
```

Itatanong nito ang password (hindi ito makikita habang tina-type). Pagkatapos,
mag-login sa `/login.html#admin` gamit ang Instructor ID at password.
Iba pang commands: `reset-password`, `rename`, `remove`, `list` (tingnan ang README).

> **Unang start:** awtomatikong ilalagay ng server sa database ang orihinal na
> course content (videos, lessons, case studies, study cards) mula sa
> `src/seed/content.json`. Pagkatapos noon, sa **Content** tab ng Admin
> Dashboard na ito ine-edit (draft muna, saka **Publish**).

## 5. I-test

- Buksan ang Render URL mo, mag-sign up ng test account, mag-unlock ng case study o
  video, i-upload ang isang profile photo.
- Subukan ang "Forgot password" para makita kung dumarating ang email at gumagana
  ang reset link.
- Hintayin ~15 minuto nang walang activity (para matulog ang free Render service),
  pagkatapos mag-request ulit (gagawa ito ng "cold start" na 30–50 segundo). Dapat
  naka-login ka pa rin at buo pa rin ang progress mo — dahil hindi na naka-depende
  ang datos sa disk ng Render.

## Mga bagay na dapat tandaan

- **Cold start:** Natutulog talaga ang free Render web service pagkalipas ng ~15 min
  na walang traffic — normal lang ito, first request lang matagal (30–50s), hindi
  ito ibig sabihin nawawala ang data.
- **Supabase free project pausing:** Nagpapa-pause ang mismong Supabase project
  (hindi 'buburahin') kapag mahigit isang linggo walang activity — isang click lang
  i-unpause sa dashboard, buo pa rin ang laman.
- Huwag i-commit ang `.env` file sa GitHub — doon lang sa Render/Supabase/Cloudinary
  dashboards ilalagay ang mga secrets.
