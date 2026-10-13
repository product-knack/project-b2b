/* One hook for every decorative loop: Reduce Motion (system setting) turns them all off. */
import React from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [reduce, setReduce] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((r) => { if (alive) setReduce(!!r); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (r) => setReduce(!!r));
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduce;
}
