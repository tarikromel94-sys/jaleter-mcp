import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect } from "react";
import { Alert, LogBox, Platform } from "react-native";
import { useFonts } from "expo-font";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

/* ------------------------------------------------------------------ */
/* Push Notifications — Emergent Managed (SuprSend relay).             */
/* Module-scope config MUST run before any component mounts so that    */
/* SuprSend's data-only FCM payloads render correctly in the           */
/* background / killed states.                                          */
/* ------------------------------------------------------------------ */
if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

if (Platform.OS === "android") {
  // Fire-and-forget: Android channels are idempotent by ID.
  Notifications.setNotificationChannelAsync("default", {
    name: "Default",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
  }).catch(() => {});
}

const PUSH_NUDGE_KEY = "pushNudgeAt";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function RootLayout() {
  const router = useRouter();
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

  useEffect(() => {
    if (Platform.OS === "web") return;

    const handleTap = (data: any) => {
      const url = data?.deeplink || data?.action_url;
      if (!url) return;
      if (typeof url === "string" && url.startsWith("http")) {
        Linking.openURL(url).catch(() => {});
      } else if (typeof url === "string") {
        try {
          router.push(url as any);
        } catch {
          // Ignore invalid deep links.
        }
      }
    };

    // Warm tap — user taps notification while the app is running.
    const tapSub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const data = response.notification.request.content.data || {};
        handleTap(data);
      },
    );

    // Cold-start tap — app was killed; user tapped the notification.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data || {};
      handleTap(data);
    });

    // Weekly nudge for users who denied permission and can't be re-prompted.
    (async () => {
      try {
        const { status, canAskAgain } = await Notifications.getPermissionsAsync();
        if (status !== "denied" || canAskAgain) return;
        const lastNudge = await AsyncStorage.getItem(PUSH_NUDGE_KEY);
        if (lastNudge && Date.now() - Number(lastNudge) <= ONE_WEEK_MS) return;
        Alert.alert(
          "Turn on notifications",
          "Get real-time budget alerts, over-budget warnings, and large-transaction notices from Jaleter.",
          [
            {
              text: "Later",
              style: "cancel",
              onPress: async () => {
                await AsyncStorage.setItem(PUSH_NUDGE_KEY, String(Date.now()));
              },
            },
            {
              text: "Open Settings",
              onPress: async () => {
                await AsyncStorage.setItem(PUSH_NUDGE_KEY, String(Date.now()));
                Linking.openSettings().catch(() => {});
              },
            },
          ],
        );
      } catch {
        // Silent — permission nudge is best-effort.
      }
    })();

    return () => {
      tapSub.remove();
    };
  }, [router]);

  if (!iconsLoaded && !iconsError) return null;
  return <Stack screenOptions={{ headerShown: false }} />;
}
