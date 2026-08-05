/**
 * "Powered by jaleter.com" — persistent brand footer.
 *
 * Mounted at the bottom of screens that don't already carry the tab bar
 * (Login, Signup, Welcome, More).  Tapping the link opens the marketing
 * site in the platform's best browser (in-app on native, new tab on web).
 */
import React from 'react';
import { Text, Pressable, StyleSheet } from 'react-native';
import { openJaleter } from '@/src/jaleterLinks';

export function PoweredByJaleter({ light = false, testID = 'powered-by-jaleter' }: { light?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} onPress={() => openJaleter('home')} style={styles.wrap}>
      <Text style={[styles.dim, light && styles.dimLight]}>Powered by </Text>
      <Text style={[styles.link, light && styles.linkLight]}>jaleter.com</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
  },
  dim: { fontSize: 10, color: '#8a7f70', letterSpacing: 0.3 },
  dimLight: { color: '#b4ada3' },
  link: { fontSize: 10, color: '#b28a4c', fontWeight: '700', letterSpacing: 0.4 },
  linkLight: { color: '#e8c98f' },
});
