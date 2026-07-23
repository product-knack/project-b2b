import React from 'react';
import { UIManager, View } from 'react-native';

/* ============ Session Replay shield ============
   Wraps a screen in Amplitude's AmpMaskView with mask="amp-block": the ENTIRE
   region is captured as a blank box — the actual pixels are never encoded and
   never leave the device. Used on every screen showing client medical/health
   data (see SENSITIVE_ROUTES in Router.tsx). Screen Viewed EVENTS still fire
   for shielded screens, so usage/DAU insight is unaffected — only the visual
   recording is blocked.

   Availability guard: in Expo Go the plugin's JS loads but the NATIVE view is
   not registered, so merely requiring it isn't enough — rendering it throws
   "View config not found for RCTAmpMaskView". We therefore check the native
   view manager exists BEFORE adopting the component; otherwise a plain View
   is used (no replay runs in Go anyway, so nothing needs shielding there). */
let AmpMaskView: any = null;
try {
  const um: any = UIManager;
  const hasView = (name: string) =>
    typeof um.hasViewManagerConfig === 'function' ? um.hasViewManagerConfig(name) : !!um.getViewManagerConfig?.(name);
  if (hasView('AmpMaskView') || hasView('RCTAmpMaskView')) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    AmpMaskView = require('@amplitude/plugin-session-replay-react-native').AmpMaskView;
  }
} catch { /* native module unavailable — fall through to plain View */ }

export function ReplayShield({ children }: { children: React.ReactNode }) {
  if (AmpMaskView) {
    return <AmpMaskView mask="amp-block" style={{ flex: 1 }}>{children}</AmpMaskView>;
  }
  return <View style={{ flex: 1 }}>{children}</View>;
}
