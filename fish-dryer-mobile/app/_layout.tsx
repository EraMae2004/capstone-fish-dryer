import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { LogBox } from 'react-native';
import 'react-native-reanimated';

LogBox.ignoreAllLogs();

import { useColorScheme } from '@/hooks/use-color-scheme';
import { startLanApiDiscovery } from '@/lib/lan-api-discovery';
import { flushSessionQueue } from '@/lib/offline-session-queue';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    void startLanApiDiscovery();
    void flushSessionQueue();
    const id = setInterval(() => {
      void flushSessionQueue();
    }, 8000);
    return () => clearInterval(id);
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>

      {/* 🔥 THIS REMOVES ALL AUTO HEADERS */}
      <Stack screenOptions={{ headerShown: false }}>

        <Stack.Screen name="(tabs)" />
        <Stack.Screen 
          name="modal" 
          options={{ presentation: 'modal' }} 
        />

      </Stack>

      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
