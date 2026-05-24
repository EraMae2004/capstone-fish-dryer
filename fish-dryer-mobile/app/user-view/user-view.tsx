//user-view.tsx

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  StatusBar,
  Pressable,
  Image,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';


import UserOverview from './user-overview';
import UserProfile from './user-profile';
import HardwareStatus from './hardware-status';
import UserHistory from './user-history';
import UserNotifications from './user-notifications';
import { API_BASE_URL } from '@/config/api';
import { countUnreadHardwareNotifications } from '@/lib/hardware-notifications-store';
import { getSelectedMachineId } from '@/lib/selected-machine';
import { ShellSidebarOpenContext } from '@/lib/shell-sidebar-context';

const { width } = Dimensions.get('window');
const TOPBAR_HEIGHT = 80;

export default function UserView() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topbarTotalHeight = TOPBAR_HEIGHT + insets.top;

  const [user, setUser] = useState<any>(null);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [activeScreen, setActiveScreen] = useState<
    'overview' | 'history' | 'notifications' | 'hardware' | 'profile'
  >('overview');
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  const slideAnim = useState(new Animated.Value(-width))[0];

  const refreshUnreadNotificationCount = useCallback(async () => {
    const machineId = await getSelectedMachineId();
    const count = await countUnreadHardwareNotifications(machineId);
    setUnreadNotificationCount(count);
    return count;
  }, []);

  useEffect(() => {
    const loadUser = async () => {
      const storedUser = await AsyncStorage.getItem('user');

      if (!storedUser) {
        router.replace('/authentication/login');
        return;
      }

      setUser(JSON.parse(storedUser));
    };

    loadUser();
  }, []);

  useEffect(() => {
    void refreshUnreadNotificationCount();
  }, [activeScreen, refreshUnreadNotificationCount]);

  const handleLogout = async () => {
    try {
      await AsyncStorage.removeItem('user');
      setUser(null);
      setSidebarVisible(false);
      router.replace('/authentication/login');
    } catch (error) {
      console.log('Logout error:', error);
    }
  };

  const initials =
    user?.name
      ?.split(' ')
      .map((word: string) => word[0])
      .join('')
      .substring(0, 2)
      .toUpperCase() || '';

  const toggleSidebar = () => {
    if (sidebarVisible) {
      Animated.timing(slideAnim, {
        toValue: -width,
        duration: 250,
        useNativeDriver: true,
      }).start(() => setSidebarVisible(false));
    } else {
      setSidebarVisible(true);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  };

  const renderContent = () => {
    switch (activeScreen) {
      case 'overview':
        return (
          <UserOverview
            unreadNotificationCount={unreadNotificationCount}
            onOpenNotifications={() => setActiveScreen('notifications')}
            onNotificationsChanged={refreshUnreadNotificationCount}
          />
        );
      case 'history':
        return <UserHistory />;
      case 'notifications':
        return (
          <UserNotifications
            onBack={() => setActiveScreen('overview')}
            onNotificationsChanged={refreshUnreadNotificationCount}
          />
        );
      case 'hardware':
        return <HardwareStatus />;
      case 'profile':
        return <UserProfile />;
      default:
        return null;
    }
  };

  const sidebarHighlight =
    activeScreen === 'notifications' ? 'overview' : activeScreen;

  const navItems = [
    { key: 'overview' as const, icon: 'dashboard' as const, label: 'Overview' },
    { key: 'history' as const, icon: 'history' as const, label: 'History' },
    { key: 'hardware' as const, icon: 'microchip' as const, label: 'Hardware Status' },
    { key: 'profile' as const, icon: 'user' as const, label: 'Profile' },
  ];

  return (

    
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <StatusBar barStyle="light-content" />

      {/* ================= TOP BAR ================= */}
      <View style={[styles.topbar, { height: topbarTotalHeight, paddingTop: insets.top + 20 }]}>
        <View style={styles.leftSection}>
          <TouchableOpacity onPress={toggleSidebar}>
            <FontAwesome name="bars" size={22} color="white" />
          </TouchableOpacity>
          <Text style={styles.systemName}>Fish Dryer</Text>
        </View>

        <View style={styles.userSection}>
          <View style={styles.profileCircle}>
            {user?.profile_picture ? (
              <Image
                source={{ uri: `${API_BASE_URL.replace('/api','')}/storage/${user.profile_picture}` }}
                style={styles.profileImage}
              />
            ) : (
              <Text style={styles.profileText}>{initials}</Text>
            )}
          </View>
          <Text style={styles.username}>{user?.name || ''}</Text>
        </View>
      </View>

      {/* ================= CONTENT ================= */}
      <ShellSidebarOpenContext.Provider value={sidebarVisible}>
        <View style={styles.content}>{renderContent()}</View>
      </ShellSidebarOpenContext.Provider>

      {/* ================= OVERLAY ================= */}
      {sidebarVisible && (
        <Pressable
          style={[styles.overlay, { top: topbarTotalHeight }]}
          onPress={toggleSidebar}
        />
      )}

      {/* ================= SIDEBAR ================= */}
      <Animated.View
        style={[
          styles.sidebar,
          { top: topbarTotalHeight, transform: [{ translateX: slideAnim }] },
        ]}
      >
        {navItems.map((item) => {
          const active = sidebarHighlight === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.menuItem, active && styles.activeItem]}
              onPress={() => {
                setActiveScreen(item.key);
                toggleSidebar();
              }}
            >
              <FontAwesome
                name={item.icon}
                size={18}
                color={active ? '#2c3e50' : '#5f6b7a'}
              />
              <Text style={active ? styles.menuTextActive : styles.menuText}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}

        <View style={styles.divider} />

        {/* LOGOUT */}
        <TouchableOpacity
          style={styles.menuItem}
          onPress={handleLogout}
        >
          <FontAwesome name="sign-out" size={18} color="#e74c3c" />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EEEEEF',
  },

  topbar: {
    backgroundColor: '#2c3e50',
    paddingHorizontal: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 40,
  },

  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },

  systemName: {
    color: 'white',
    fontSize: 24,
    fontWeight: '700',
  },

  userSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  profileCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#34495e',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },

  profileImage: {
    width: '100%',
    height: '100%',
    borderRadius: 21,
  },

  profileText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },

  username: {
    color: 'white',
    fontSize: 14,
  },

  content: {
    flex: 1,
    padding: 25,
    zIndex: 1,
  },

  sidebar: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    width: width * 0.75,
    backgroundColor: 'white',
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 10,
    elevation: 30,
    zIndex: 100,
  },

  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    paddingVertical: 15,
    paddingLeft: 20,
  },

  activeItem: {
    backgroundColor: '#d6e7f5',
    borderLeftWidth: 4,
    borderLeftColor: '#4fc3f7',
  },

  menuText: {
    fontSize: 16,
    color: '#5f6b7a',
  },

  menuTextActive: {
    fontSize: 16,
    color: '#2c3e50',
    fontWeight: '600',
  },

  logoutText: {
    fontSize: 16,
    color: '#e74c3c',
    marginLeft: 10,
  },

  divider: {
    height: 1,
    backgroundColor: '#e5e5e5',
    marginVertical: 10,
  },

  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    zIndex: 90,
    elevation: 25,
  },
});