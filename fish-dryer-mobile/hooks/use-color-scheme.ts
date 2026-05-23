import { useColorScheme as useRNColorScheme } from 'react-native';

/** Normalizes RN `ColorSchemeName` (includes `unspecified`) to a concrete theme key. */
export function useColorScheme(): 'light' | 'dark' {
  return useRNColorScheme() === 'dark' ? 'dark' : 'light';
}
