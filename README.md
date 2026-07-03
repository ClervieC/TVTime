# TVTime

App de suivi de séries (remplaçant TVTime) : à voir / en cours / vues / arrêtées, alimentée par l'API [TVmaze](https://www.tvmaze.com/api) et un compte Supabase pour la sauvegarde.

## Stack
- Expo (React Native + Web) avec expo-router
- Supabase (auth + base de données Postgres)
- TVmaze API (recherche, planning, détails des séries)

## Mise en route

1. Crée les tables Supabase : ouvre le SQL editor de ton projet et exécute [supabase/schema.sql](supabase/schema.sql).
2. Les clés d'API sont dans `.env` (non versionné). Vérifie qu'elles sont correctes :
   - `EXPO_PUBLIC_SUPABASE_URL`
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - `EXPO_PUBLIC_TVMAZE_API_KEY`
3. Lance le projet :
   ```
   npm start        # menu Expo (web/android/ios)
   npm run web
   npm run android
   npm run ios
   ```

> Note environnement : si `expo start` échoue avec `unable to get local issuer certificate` (proxy d'entreprise), relance avec :
> `NODE_TLS_REJECT_UNAUTHORIZED=0 npx expo start` (dev local uniquement, à ne pas utiliser en CI/prod).

## Structure
- `app/(auth)` — écrans de connexion / inscription (Supabase Auth)
- `app/(tabs)` — Découvrir (planning du jour), Mes séries, Recherche, Profil
- `app/show/[id].tsx` — détail d'une série + changement de statut
- `lib/tvmaze.ts` — client de l'API TVmaze
- `lib/userShows.ts` — CRUD Supabase pour les séries suivies par l'utilisateur
- `lib/supabase.ts` — client Supabase
