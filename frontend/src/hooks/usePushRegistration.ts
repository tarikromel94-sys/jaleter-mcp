/**
 * Push notification registration hook.
 *
 * Emergent Managed Push (SuprSend relay). We only fetch the NATIVE device
 * token (FCM/APNs) via getDevicePushTokenAsync and POST it to our backend
 * — the relay resolves recipients by user_id, so no client-side token DB.
 *
 * Web / Expo Go: no-op (push requires a dev-client / standalone build).
 */
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export function usePushRegistration(opts: {
  userId: string | null | undefined;
  token: string | null | undefined; // auth JWT
}) {
  const { userId, token } = opts;
  const lastRegisteredRef = useRef<string | null>(null);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!userId || !token) return;
    if (!Device.isDevice) return; // simulators can't get push tokens

    let cancelled = false;

    (async () => {
      try {
        // 1) Permission first (iOS prompt + Android 13+ POST_NOTIFICATIONS)
        const existing = await Notifications.getPermissionsAsync();
        let status = existing.status;
        if (status !== "granted" && existing.canAskAgain) {
          const req = await Notifications.requestPermissionsAsync();
          status = req.status;
        }
        if (status !== "granted" || cancelled) return;

        // 2) Native device token (NOT Expo push token)
        const tokenResp = await Notifications.getDevicePushTokenAsync();
        const deviceToken = tokenResp?.data;
        if (!deviceToken) return;

        // Dedupe: only POST if the token changed since last successful register.
        const dedupeKey = `${userId}::${deviceToken}`;
        if (lastRegisteredRef.current === dedupeKey) return;

        // 3) Relay via our backend
        const res = await fetch(`${BASE}/api/register-push`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            user_id: userId,
            platform: Platform.OS,
            device_token: deviceToken,
          }),
        });
        if (res.ok || res.status === 201) {
          lastRegisteredRef.current = dedupeKey;
        }
      } catch (e) {
        // Never surface — push registration is best-effort.
        console.warn("[push] registration failed:", (e as Error)?.message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, token]);
}
