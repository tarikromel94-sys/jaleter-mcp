import React from 'react';
import { View, Text, Pressable } from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { C } from '@/src/jaleterTheme';
import { s } from '@/src/utils/appShared';

/* ---------------- Bottom Nav ---------------- */
const navItems = [
  { id: 'home', label: 'Home', icon: 'home-outline' as const },
  { id: 'budget', label: 'Budget', icon: 'menu-outline' as const },
  { id: 'reports', label: 'Reports', icon: 'stats-chart-outline' as const },
  { id: 'transactions', label: 'Activity', icon: 'receipt-outline' as const },
  { id: 'networth', label: 'Wealth', icon: 'wallet-outline' as const },
  { id: 'legacy', label: 'Legacy', icon: 'trophy-outline' as const },
];
export const BottomNav = ({ active, setActive, isDark }: any) => (
  <View style={[s.bottomNav, isDark && { backgroundColor: '#151411ed', borderTopColor: '#2c2924' }]}>
    {navItems.map(({ id, label, icon }) => {
      const isActive = active === id;
      const activeColor = isDark ? '#e7c58e' : C.ink2;
      const inactiveColor = isDark ? '#827c74' : '#918b83';
      return (
        <Pressable key={id} onPress={() => setActive(id)} style={s.navBtn} testID={`nav-${id}`}>
          {isActive && <View style={[s.navIndicator, isDark && { backgroundColor: '#dfb46e' }]} />}
          <Ionicons name={icon} size={19} color={isActive ? activeColor : inactiveColor} />
          <Text style={[s.navLabel, { color: isActive ? activeColor : inactiveColor }]}>{label}</Text>
        </Pressable>
      );
    })}
  </View>
);
