// Google Mobile Ads has no web SDK. Metro picks this file over adsInit.ts
// for web builds, so the native-only module is never even resolved into the
// web bundle (a runtime Platform.OS check alone isn't enough — the plain
// static import in adsInit.ts fails to bundle for web regardless of whether
// it's ever called).
export function initAds() {}
