import { useState } from "react";
import { View, StyleSheet } from "react-native";
import { BannerAd, BannerAdSize } from "react-native-google-mobile-ads";
import { bannerAdUnitId } from "../lib/ads";
import { useColors } from "../lib/theme";

export function AdBanner() {
  const colors = useColors();
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    <View style={[styles.wrap, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
      <BannerAd
        unitId={bannerAdUnitId()}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    borderTopWidth: 1,
  },
});
