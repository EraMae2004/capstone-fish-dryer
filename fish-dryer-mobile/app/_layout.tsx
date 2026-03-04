import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

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