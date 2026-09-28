# MittBo – prototyp

MittBo har en Next.js-webb för boende och förvaltare och en React Native/Expo-app för boende, förvaltare och arbetare. Båda använder samma Next.js API. Supabase sköter PostgreSQL, Auth och privat bildlagring; ingen runtime-data skrivs till serverns filsystem.

## Lokal start

Kräver Node.js 24 och pnpm 11. Kopiera `apps/web/.env.example` till `apps/web/.env.local` och fyll i ditt Supabase-projekts URL och anon-nyckel. `SUPABASE_SERVICE_ROLE_KEY` behövs **bara för seed-scriptet**, inte i webbappens runtime. Kör SQL-migrationen och seed enligt nedan, sedan:

```powershell
pnpm install
pnpm web
```

Öppna `http://localhost:3002`. Starta mobilappen med `pnpm mobile`. För fysisk telefon, kopiera `apps/mobile/.env.example` till `apps/mobile/.env` och ange antingen en nåbar lokal IP-adress med port 3002 eller MittBos Vercel-URL. Android-emulatorn använder `http://10.0.2.2:3002` och iOS-simulatorn `http://localhost:3002` i utvecklingsläge om variabeln saknas; en byggd APK använder `https://mittbo-web.vercel.app` som standard. `EXPO_PUBLIC_API_URL` ska peka på MittBos Next.js-webbserver, aldrig på Supabase-projektets URL. Bygg om appen efter ändring av `EXPO_PUBLIC_API_URL` i en installerad APK. Inloggningssidan har också ett serveradressfält för test.

## Supabase-installation och demodata

1. Skapa ett Supabase-projekt. Under **Project Settings → API Keys** hämtar du projektets URL, anon/publishable key och service-role/secret key. Lägg aldrig service-role-nyckeln i Expo eller `NEXT_PUBLIC_`-variabler. Aktivera **Authentication → Providers → Email**. Seed-scriptet bekräftar demokonton direkt och kräver inte SMTP.
2. Öppna **SQL Editor** i det nya projektet och kör `supabase/migrations/20260928000000_init.sql` och därefter `supabase/migrations/20260928000001_ticket_rls_fix.sql`, i den ordningen. De skapar tabeller, index, triggers, RLS och den **privata** bucketen `ticket-attachments` med 5 MB och JPEG/PNG/WebP som gränser. Du ska alltså inte skapa en publik bucket separat. Om den första migrationen redan är körd behöver du bara köra den andra; ingen ny seed behövs.
3. Kopiera `apps/web/.env.example` till `apps/web/.env.local` och fyll i URL, anon key och service-role key. Kör `pnpm seed` från repots rot. Seed-scriptet skapar eller uppdaterar fem Auth-konton och deras profiler, två organisationer, byggnader, enheter, ett ärende och anslag. Det är avsett enbart för testmiljöer och är idempotent för dessa demo-ID:n.

Demokonton: `emma@demo.mittbo.se` (boende), `admin@demo.mittbo.se` (förvaltare), `arbetare@demo.mittbo.se` (arbetare), `lina@demo.mittbo.se` (boende i andra organisationen), `sara@demo.mittbo.se` (förvaltare i andra organisationen). Standardlösenord: `MittBo2026!`. För ett annat demolösenord, sätt `MITTBO_DEMO_PASSWORD` vid seed; UI:s förifyllda lösenord behöver då ändras manuellt.

SQL-reglerna begränsar ärenden och bilder till rätt organisation och roll. Boende ser bara sin egen profil/enhet och sina ärenden, och kan inte läsa interna anteckningar. Förvaltare ser organisationens data. Arbetare ser sina tilldelade ärenden. Next.js API validerar samma regler och använder användarens Supabase-token i databasfrågorna. Service-role används enbart av seed-scriptet.

## Deploy to Vercel

1. Slutför Supabase-stegen ovan. Kontrollera att `ticket-attachments` är **Private** i Storage; migrationen skapar bucketen. Behåll demokontona endast i testprojekt.
2. Importera GitHub-repot i Vercel. Välj **Framework Preset: Next.js**, **Root Directory: `apps/web`**, **Install Command: `pnpm install`** (standard), **Build Command: `pnpm build`** (kör `next build` i `apps/web`), **Output Directory: `.next`** (standard) och **Node.js 24.x**. Repots rot innehåller `pnpm-workspace.yaml` och `pnpm-lock.yaml`; behåll dem i deploymenten så `@mittbo/shared` kan installeras som workspace-paket.
3. Lägg in `NEXT_PUBLIC_SUPABASE_URL` och `NEXT_PUBLIC_SUPABASE_ANON_KEY` i Vercel **Environment Variables** för Production och Preview. Appens runtime använder inte service-role key; lägg inte in den i Vercel om du inte senare lägger till en serverfunktion som uttryckligen behöver den. Variabler med `NEXT_PUBLIC_` är synliga i klientbunten.
4. Deploya och öppna Vercel-URL:en. Testa inloggning som Emma och admin, skapa/tilldela ett ärende och visa en bild.
5. Sätt `EXPO_PUBLIC_API_URL=https://<din-domän>.vercel.app` i `apps/mobile/.env` för lokal Expo eller i EAS-miljön `preview` innan en ny APK byggs. Från `apps/mobile`: `eas build --platform android --profile preview`. `EXPO_PUBLIC_`-värdet bakas in i appen och är **inte hemligt**. `apps/mobile/eas.json` innehåller ingen hårdkodad test-IP.

Bilder på upp till 5 MB skickas direkt från webb/mobil till Supabase Storage via en tidsbegränsad uppladdningslänk som API:t utfärdar efter behörighetskontroll. `POST /api/tickets/[id]/attachments` slutför uppladdningen och behåller dessutom stöd för äldre multipart-klienter med mindre bilder. `GET /api/attachments/[id]` kontrollerar åtkomst och omdirigerar till en kortlivad signerad URL. Det behövs eftersom [Vercel Functions har en gräns på 4,5 MB för begäran och svar](https://vercel.com/docs/functions/limitations).

För en annan befintlig Vercel-konfiguration: verifiera i build-loggen att installationen hittar `@mittbo/shared` och att `next build` körs i `apps/web`. Vercels monorepo-stöd och pnpm-workspace-hantering beskrivs i deras [monorepo-dokumentation](https://vercel.com/docs/monorepos).

## Miljövariabler

| Variabel | Används av | Syfte |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Webb, seed | Supabase projekt-URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Webb | Publik anon/publishable key; RLS skyddar data |
| `SUPABASE_SERVICE_ROLE_KEY` | Endast seed | Skapar Auth-användare och demodata; hemlig |
| `MITTBO_DEMO_PASSWORD` | Valfri seed | Ersätter demo-standardlösenordet |
| `EXPO_PUBLIC_API_URL` | Mobil | URL till Next.js API, till exempel Vercel-domänen |
| `MITTBO_TEST_URL`, `MITTBO_TEST_PASSWORD` | Valfritt test | URL och lösenord för live-smoke-test |

## Kontroll

```powershell
pnpm install
pnpm check
pnpm build
```

För ett **live-integrationstest** mot ett seedat Supabase-projekt, starta webbappen och kör `node scripts/smoke.mjs` (standard `http://localhost:3001`; sätt `MITTBO_TEST_URL` för annan URL). Testet skapar ett nytt ärende och en bild och kontrollerar roll- och organisationsgränser. Kör `pnpm test:rls` för direkta RLS-kontroller mot Supabase med kontona i seed. Kör testerna endast mot en testmiljö; smoke-testet lämnar testärendet kvar. `pnpm check` och `pnpm build` kräver inte Supabase-uppkoppling.

Den tidigare lokala lagringen i `data/mittbo.json`, `data/session.key` och `data/uploads` används inte längre. Gamla lokala filer migreras inte automatiskt. Om du behöver föra över riktiga data krävs en separat engångsimport med matchning av gamla användar-ID:n mot Supabase Auth-ID:n.
