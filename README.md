# MittBo – prototyp

En fungerande första version av MittBo med webbyta för boende och förvaltare samt en React Native-app för boende, förvaltare och arbetare. Webb och app använder samma API och visar samma ärenden.

## Kom igång

Kräver Node.js 24 och pnpm. Kör i projektmappen:

```powershell
pnpm install
pnpm web
```

Öppna `http://localhost:3002`. Starta mobilappen i en annan terminal:

```powershell
pnpm mobile
```

För en fysisk telefon: kopiera `apps/mobile/.env.example` till `apps/mobile/.env` och ändra `EXPO_PUBLIC_API_URL` till datorns lokala IP-adress med port `3002`. Telefonen och datorn behöver vara på samma nätverk. Android-emulatorn använder `http://10.0.2.2:3002` och iOS-simulatorn `http://localhost:3002` om ingen miljövariabel anges. Starta om Expo efter en ändring i `.env`.

En installerbar Android-APK byggs med EAS-profilen `preview` i `apps/mobile/eas.json`. På appens inloggningssida kan du ändra **Serveradress för test** till datorns aktuella IP-adress, exempelvis `http://192.168.1.10:3002`. Starta webbservern med `pnpm web` innan du loggar in i appen. Adressen `10.0.2.2` fungerar bara i Android-emulatorn.

## Demokonton

Alla använder lösenordet `MittBo2026!`.

| Roll | E-post |
| --- | --- |
| Boende | `emma@demo.mittbo.se` |
| Förvaltare | `admin@demo.mittbo.se` |
| Arbetare | `arbetare@demo.mittbo.se` |

Det finns även en andra organisation med `lina@demo.mittbo.se` och `sara@demo.mittbo.se` för att prova dataseparering.

## Det som fungerar nu

- Inloggning, sessionshantering och rollbaserade API-behörigheter.
- Boende kan skapa ärenden med bild och följa händelser och meddelanden.
- Förvaltare kan tilldela arbetare, sätta prioritet och följa ärenden.
- Arbetare kan se sina uppdrag, planera besök, rapportera status, bifoga bild och skriva meddelanden.
- Interna anteckningar är dolda för boende. Organisationerna kan inte läsa varandras data.
- Boendeinformation visas i webb och mobil.

Prototypen lagrar data i `data/mittbo.json`, bilder i `data/uploads` och en lokal sessionsnyckel i `data/session.key`. Dessa filer skapas vid första inloggningen och ignoreras av Git. Detta är en lokal demobackend. Supabase, aviseringar och riktiga fastighetssystem är nästa steg inför pilot.

## Kontroll

```powershell
pnpm check
pnpm build
```

För ett isolerat API-test, starta en byggd webbserver på port 3001 med egen datamapp och kör `node scripts/smoke.mjs`. Testet skapar ett ärende och går igenom kund → förvaltare → arbetare → kund.
