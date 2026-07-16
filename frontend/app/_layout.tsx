import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { useFonts } from "expo-font";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

// Load Playfair Display from Google Fonts CDN for the Jaleter serif brand type.
const PLAYFAIR_500 = "https://fonts.gstatic.com/s/playfairdisplay/v40/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKd3vUDQ.ttf";
const PLAYFAIR_600 = "https://fonts.gstatic.com/s/playfairdisplay/v40/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKebukDQ.ttf";

export default function RootLayout() {
  const [iconsLoaded, iconsError] = useIconFonts();
  const [brandLoaded, brandError] = useFonts({
    PlayfairDisplay: PLAYFAIR_500,
    PlayfairDisplayBold: PLAYFAIR_600,
  });

  useEffect(() => {
    if ((iconsLoaded || iconsError) && (brandLoaded || brandError)) {
      SplashScreen.hideAsync();
    }
  }, [iconsLoaded, iconsError, brandLoaded, brandError]);

  if (!iconsLoaded && !iconsError) return null;
  return <Stack screenOptions={{ headerShown: false }} />;
}
