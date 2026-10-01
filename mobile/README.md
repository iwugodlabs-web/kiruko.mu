# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Release builds & TestFlight (read before queuing a build)

Learned from three failed submissions — follow exactly:

1. **`git status` must be clean-ish first.** EAS rewrites `app.json` during version
   resolution, and stray local edits to `drizzle/` or `app.json` have broken
   builds before. Know what every dirty file is.
2. **Version must exceed the live train.** Check App Store Connect: if `x.y.z` is
   READY_FOR_SALE, the new binary must be `> x.y.z`, or Apple rejects it
   (ITMS-90062/90186/90478). Bump `expo.version` in `app.json`.
3. **Build number is owned manually.** `autoIncrement` does not reliably bump
   under `appVersionSource: local`, and reusing an uploaded
   (version, build) tuple makes Apple fast-reject the submission. Always set
   `ios.buildNumber` in `app.json` to max(uploaded) + 1 — verify with
   `eas build:list --platform ios`.
4. **Run the offline guardrails locally:** `node scripts/check-drizzle-manifest.js`
   (journal ↔ manifest ↔ SQL files must agree) and
   `npx expo export --platform ios` (catches bundler breakage before burning a
   30-min EAS build).
5. **Queue and submit:**
   ```bash
   eas build --platform ios --profile production --non-interactive --no-wait
   # after FINISHED:
   eas submit -p ios --profile production --latest --non-interactive
   ```
   Then Apple processing (~5–10 min) → TestFlight. A rejection email's
   ITMS codes dictate the fix — paste them back into the dev thread.

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
    npx expo start
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.


 "user_type": "private",
  "email": "test@example.com",
  "phone": "+1234567890",
  "password_hash": "hashed_password_123",