import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
  StatusBar,
  Pressable,
  SafeAreaView,
  Image,
} from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import AdminProfile from './admin-profile';
import AdminUserManagement from './admin-user-management';
import AdminDryingMachines from './admin-drying-machines';
import AdminOverview from './admin-overview';

const { width } = Dimensions.get('window');
const BASE_URL = 'https://spinproof-brineless-marleen.ngrok-free.dev';

export default function AdminView() {
  const router = useRouter();

  const [user, setUser] = useState<any>(null);
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [activeScreen, setActiveScreen] = useState<
    'overview' | 'machines' | 'users' | 'profile'
  >('overview');

  const slideAnim = useState(new Animated.Value(-width))[0];

  useEffect(() => {
    const loadUser = async () => {
      const storedUser = await AsyncStorage.getItem('user');

      if (!storedUser) {
        router.replace('/authentication/login');
        return;
      }

      const parsed = JSON.parse(storedUser);

      if (parsed.role !== 'admin') {
        router.replace('/user-view/user-view');
        return;
      }

      setUser(parsed);
    };

    loadUser();
  }, []);

  const handleLogout = async () => {
    await AsyncStorage.removeItem('user');
    router.replace('/authentication/login');
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
        return <AdminOverview />;
      case 'machines':
        return <AdminDryingMachines />;
      case 'users':
        return <AdminUserManagement />;
      case 'profile':
        return <AdminProfile />;
      default:
        return null;
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* TOP BAR */}
      <View style={styles.topbar}>
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
                source={{ uri: `${BASE_URL}/storage/${user.profile_picture}` }}
                style={styles.profileImage}
              />
            ) : (
              <Text style={styles.profileText}>{initials}</Text>
            )}
          </View>
          <Text style={styles.username}>{user?.name || ''}</Text>
        </View>
      </View>

      {/* CONTENT */}
      <View style={styles.content}>{renderContent()}</View>

      {sidebarVisible && (
        <Pressable style={styles.overlay} onPress={toggleSidebar} />
      )}

      {/* SIDEBAR */}
      <Animated.View
        style={[styles.sidebar, { transform: [{ translateX: slideAnim }] }]}
      >
        {[
          { key: 'overview', label: 'Overview', icon: 'dashboard' },
          { key: 'machines', label: 'Drying Machines', icon: 'cogs' },
          { key: 'users', label: 'User Management', icon: 'users' },
          { key: 'profile', label: 'Profile', icon: 'user' },
        ].map(item => {
          const isActive = activeScreen === item.key;

          return (
            <TouchableOpacity
              key={item.key}
              style={[
                styles.menuItem,
                isActive && styles.activeItem,
              ]}
              onPress={() => {
                setActiveScreen(item.key as any);
                toggleSidebar();
              }}
            >
              <FontAwesome
                name={item.icon as any}
                size={18}
                color={isActive ? '#4fc3f7' : '#5f6b7a'}
              />
              <Text
                style={
                  isActive ? styles.menuTextActive : styles.menuText
                }
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}

        <View style={styles.divider} />

        <TouchableOpacity style={styles.menuItem} onPress={handleLogout}>
          <FontAwesome name="sign-out" size={18} color="#e74c3c" />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#EEEEEF' },

  topbar: {
    height: 80,
    backgroundColor: '#2c3e50',
    paddingHorizontal: 20,
    paddingTop: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
  },

  screenTitle: {
    fontSize: 22,
    fontWeight: '700',
  },

  sidebar: {
    position: 'absolute',
    left: 0,
    top: 80,
    width: width * 0.75,
    height: '100%',
    backgroundColor: 'white',
    paddingVertical: 20,
    paddingHorizontal: 10,
    elevation: 20,
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
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
});