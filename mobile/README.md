# Synapse iOS (Expo)

This folder contains the native iOS app built with Expo (SDK 49).

## Run locally

From `mobile/`:

- `npm start` (then open in Expo Go)
- `npm run ios` (requires Xcode + simulator/device)

## Google OAuth setup

Set the client id via an env var:

- `EXPO_PUBLIC_GOOGLE_CLIENT_ID`

The app requests combined scopes (Google Tasks + Google Calendar) and stores the access token in secure storage.

## EAS / TestFlight (internal)

1. Install EAS CLI:
   - `npm i -g eas-cli`
2. Login:
   - `eas login`
3. Configure the project:
   - `eas build:configure`
4. Create an internal iOS build:
   - `eas build --platform ios --profile preview`

`eas.json` contains a placeholder for `EXPO_PUBLIC_GOOGLE_CLIENT_ID` (replace `REPLACE_ME` or set it in EAS Secrets).

