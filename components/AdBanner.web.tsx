// Google Mobile Ads has no web SDK. Metro picks this file over AdBanner.tsx
// for web builds, so the native-only react-native-google-mobile-ads import
// never reaches the web bundle (a runtime Platform.OS check in a shared file
// isn't enough — the bundler still fails resolving the native import at
// bundle time regardless of whether it's ever called).
export function AdBanner() {
  return null;
}
