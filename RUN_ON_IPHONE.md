# Odds — Trainer Hub (Expo app)

A React Native (Expo) rebuild of the **Trainer Hub** design, ready to test on a physical iPhone.

## Test it on your iPhone (Windows-friendly)

You don't need a Mac. You need the free **Expo Go** app.

1. On your iPhone, install **Expo Go** from the App Store.
2. On this PC, from the `odds-app` folder run:
   ```
   npx expo start --tunnel
   ```
   (Tunnel mode works even if the phone and PC are on different networks. On the
   same Wi‑Fi you can drop `--tunnel` for a faster LAN connection.)
3. A **QR code** prints in the terminal. Open the iPhone **Camera**, point it at the
   QR code, and tap the banner to open in Expo Go.
4. The app loads live with hot reload — edit any file and it refreshes on the phone.

## What's implemented

Every screen from the design, driven by an in-memory store that mirrors the prototype:

- **Auth:** Sign In with role dropdown (Trainer / CRM) — the choice switches the whole app.
- **Trainer:** Dashboard (quick actions, stats, collapsible roster, leaderboards),
  Sessions, Workout logger (stepper + set table), Assessments/QHP, Managers Overview,
  Managers Dashboard (expandable run-rate), Messenger, Profile, Events, My Clients, Client Detail.
- **CRM:** Dashboard, Sales Tracker + Detail, Client Journey + Roadmap, New Onboarding,
  Session Consumption, Communications, Calendar, Service Requests, Pending Approvals,
  Roster Management, QHP, Blood Reports, Escalations, Tasks, Tools, Assessment & Health details.
- **Overlays:** side drawer (role-aware nav), bottom tab bar, Acknowledge / Emergency Leave /
  Schedule bottom sheets, and CRM approve/reject/CTA/markers dialogs.

Navigate via the **hamburger** (top-left) drawer or the **bottom tab bar**. On Sign In,
pick **CRM** in the Role dropdown to see the CRM side of the app.

## Project structure

```
App.tsx                     font loading + ambient background + providers
src/theme.ts                colors, gradients, font families, hexA()
src/icons.tsx               all SVG icon paths (react-native-svg)
src/data.ts                 all mock data ported from the prototype
src/store.tsx               route/role/sheet/dialog state (React context)
src/Router.tsx              route -> screen map + chrome
src/components/             primitives, chrome (header/drawer/bottom nav), overlays
src/screens/                common.tsx, trainer.tsx, crm.tsx
```

## Notes

- Fonts: Playfair Display (headings), Hanken Grotesk (body), JetBrains Mono (labels).
- The device provides the real iOS frame, so the prototype's mock bezel was dropped.
- This is UI only — buttons update local state; there's no backend wired up.
