import { createContext, useContext } from "react";

/** True while the user-view sidebar drawer is open — dropdowns should dismiss. */
export const ShellSidebarOpenContext = createContext(false);

export function useShellSidebarOpen(): boolean {
  return useContext(ShellSidebarOpenContext);
}
