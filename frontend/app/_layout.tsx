import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { useFonts } from "expo-font";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

// Load Playfair Display locally so release builds ship with the brand
// serif baked in (no runtime CDN fetch, works offline / behind firewalls).
export default function RootLayout() {
  const [iconsLoaded, iconsError] = useIconFonts();
  const [brandLoaded, brandError] = useFonts({
    PlayfairDisplay: require("../assets/fonts/PlayfairDisplay-Medium.ttf"),
    PlayfairDisplayBold: require("../assets/fonts/PlayfairDisplay-SemiBold.ttf"),
  });

  useEffect(() => {
    if ((iconsLoaded || iconsError) && (brandLoaded || brandError)) {
      SplashScreen.hideAsync();
    }
  }, [iconsLoaded, iconsError, brandLoaded, brandError]);

  if (!iconsLoaded && !iconsError) return null;
  return <Stack screenOptions={{ headerShown: false }} />;
}
