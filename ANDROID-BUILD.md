# Astra AI Android build and updates

Astra AI is a lightweight Android WebView wrapper around the `site/` PWA. The Android app and PWA use the same Gemini API key entered by the user in Astra Settings. The key is not embedded in the APK or repository.

## GitHub Actions build

A push to `main` that changes `android/`, `site/` or the build workflow triggers an Android build. GitHub Actions builds `Astra-AI.apk`, stores it as the `Astra-AI-Android-APK` workflow artifact, and publishes the same APK as a GitHub Release asset (`Astra-AI.apk`). The APK version code increments with the workflow run number.

## In-app update button

The **Check updates** button has two jobs:

- The web app checks its service worker and installs updated PWA files.
- In the Android APK, the same button also checks the latest GitHub Release. When a newer APK is available, Astra offers to download it. Android then asks the user to approve installation. Android's installation confirmation cannot be bypassed by the app.

A native Android change is delivered through a new APK release. A website-only change can be delivered by the service worker without reinstalling the APK after the static website is redeployed to GitHub Pages.

## Important signing note

The workflow builds a debug-signed APK so the project can be built without a private signing-keystore secret. This is suitable for personal testing and sideloading, not a Play Store production release. Reliable in-place Android updates require every APK to use the same signing key; this workflow currently does not keep a private release keystore in GitHub Secrets. A Play Store release requires a private release keystore and a separate signing configuration.

## Gemini API key

Enter the key in Astra Settings on the device. Do not commit it to GitHub or bake it into the APK. A client-side app sends requests directly to Google's Gemini API, so users with access to the device/app can inspect their own key and network requests. Do not distribute a shared personal key to other users. Rotate any key previously pasted into a chat or repository.

## Manual build

Use Java 17, Android SDK Platform 35, Build Tools 35.0.1 and Gradle 8.9. From the `android/` directory run:

```bash
gradle --no-daemon :app:assembleDebug
```

The APK is created at `android/app/build/outputs/apk/debug/app-debug.apk`.
