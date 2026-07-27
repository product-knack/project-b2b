import React from 'react';
import { Keyboard, Platform } from 'react-native';

/* Live keyboard height, 0 when hidden. Android's adjustResize is defeated by
   edge-to-edge, so bottom sheets must pad themselves by this to keep focused
   inputs visible. iOS uses the will- events for smoother sync. */
export function useKeyboardHeight(): number {
  const [kb, setKb] = React.useState(0);
  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e: any) => setKb(e.endCoordinates?.height ?? 0));
    const h = Keyboard.addListener(hideEvt, () => setKb(0));
    return () => { s.remove(); h.remove(); };
  }, []);
  return kb;
}
