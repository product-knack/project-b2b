import React from 'react';
import { Animated, Dimensions, LayoutChangeEvent, PanResponder, ScrollView } from 'react-native';
import * as Haptics from 'expo-haptics';

/* Drag-to-reorder for rows living inside a Page ScrollView, built on core
   PanResponder (no reanimated / draggable-flatlist dependency, so it runs in
   Expo Go and the existing local APK builds unchanged).

   Mechanics: a grip handle claims the touch, the page scroll is frozen, the
   held row follows the finger (Animated translateY), and neighbours are
   live-swapped through the caller's existing move-one-step function whenever
   the row crosses ~55% of a neighbour's height. Near the screen edges the
   page auto-scrolls so long lists can be crossed in one drag; any scrolling
   (ours or momentum) is folded back into the drag offset via the observed
   scroll position, keeping the row glued to the finger.

   All gesture state lives in refs: mid-drag re-renders (every swap re-renders
   the screen) replace the PanResponder's callbacks, and only ref-based state
   survives that. PanResponders are also cached per row — a fresh instance
   attached mid-gesture never saw the grant and would compute garbage dy.

   The returned API object is referentially stable except when `dragging`
   changes, so memoised row components (React.memo) skip re-renders while
   the user types elsewhere on the page. */
export function useDragReorder(opts: {
  scrollRef: React.RefObject<ScrollView | null>;
  scrollOffsetRef: React.MutableRefObject<number>; // Page writes the live offset here
  setScrollEnabled: (v: boolean) => void;
}) {
  const [dragging, setDragging] = React.useState<{ list: string; index: number } | null>(null);
  const dragY = React.useRef(new Animated.Value(0)).current;
  const heights = React.useRef(new Map<string, number>()).current; // `${list}:${i}` -> px
  const lists = React.useRef(new Map<string, { count: number; gap: number; onMove: (from: number, to: number) => void }>()).current;
  const responders = React.useRef(new Map<string, any>()).current;
  const cur = React.useRef<{ list: string; index: number; count: number; gap: number } | null>(null);
  const adj = React.useRef(0);        // accumulated correction from swaps + page scroll
  const lastDy = React.useRef(0);     // raw gesture dy
  const lastMoveY = React.useRef(0);  // finger Y in window coords (for edge zones)
  const seenOffset = React.useRef(0); // scroll offset already folded into adj
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const moveFn = React.useRef<(from: number, to: number) => void>(() => {});
  const armed = React.useRef(false); // true once the touch has moved enough to count as a drag
  // Latest opts, read through a ref so the once-created responders never go stale.
  const optsRef = React.useRef(opts); optsRef.current = opts;
  const kOf = (list: string, i: number) => `${list}:${i}`;

  /* Called during render so grant-time reads are never stale. */
  const setList = React.useCallback((list: string, cfg: { count: number; gap: number; onMove: (from: number, to: number) => void }) => { lists.set(list, cfg); }, []);

  const trySwap = () => {
    const c = cur.current;
    if (!c) return;
    const so = optsRef.current.scrollOffsetRef.current;
    if (so !== seenOffset.current) { adj.current += so - seenOffset.current; seenOffset.current = so; }
    let dy = lastDy.current + adj.current;
    let guard = 0; // a fast fling can cross several rows in one event
    while (guard++ < 16) {
      if (dy > 0 && c.index < c.count - 1) {
        const step = (heights.get(kOf(c.list, c.index + 1)) ?? 0) + c.gap;
        if (step > c.gap && dy > step * 0.55) {
          moveFn.current(c.index, c.index + 1);
          const hMe = heights.get(kOf(c.list, c.index)) ?? 0;
          heights.set(kOf(c.list, c.index), heights.get(kOf(c.list, c.index + 1)) ?? 0);
          heights.set(kOf(c.list, c.index + 1), hMe);
          adj.current -= step; c.index += 1;
          setDragging({ list: c.list, index: c.index });
          Haptics.selectionAsync().catch(() => {});
          dy = lastDy.current + adj.current;
          continue;
        }
      }
      if (dy < 0 && c.index > 0) {
        const step = (heights.get(kOf(c.list, c.index - 1)) ?? 0) + c.gap;
        if (step > c.gap && -dy > step * 0.55) {
          moveFn.current(c.index, c.index - 1);
          const hMe = heights.get(kOf(c.list, c.index)) ?? 0;
          heights.set(kOf(c.list, c.index), heights.get(kOf(c.list, c.index - 1)) ?? 0);
          heights.set(kOf(c.list, c.index - 1), hMe);
          adj.current += step; c.index -= 1;
          setDragging({ list: c.list, index: c.index });
          Haptics.selectionAsync().catch(() => {});
          dy = lastDy.current + adj.current;
          continue;
        }
      }
      break;
    }
    dragY.setValue(lastDy.current + adj.current);
  };

  const tick = () => {
    if (!cur.current || !armed.current) return;
    const winH = Dimensions.get('window').height;
    const y = lastMoveY.current;
    // dead zones sized for the app header (top) and the sticky footer bar (bottom)
    let delta = 0;
    if (y < 150) delta = -Math.min(16, (150 - y) / 4);
    else if (y > winH - 190) delta = Math.min(16, (y - (winH - 190)) / 4);
    if (delta !== 0) {
      optsRef.current.scrollRef.current?.scrollTo({ y: Math.max(0, optsRef.current.scrollOffsetRef.current + delta), animated: false });
    }
    trySwap(); // folds whatever scrolling actually happened into the offset
  };

  const end = () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (!cur.current) return;
    cur.current = null;
    optsRef.current.setScrollEnabled(true);
    if (!armed.current) return; // touch never moved: no lift happened, nothing to snap
    armed.current = false;
    // The row already lives in its final slot; snap the residual offset away.
    Animated.timing(dragY, { toValue: 0, duration: 130, useNativeDriver: false }).start(() => setDragging(null));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  // Unmount mid-drag (e.g. the screen is popped while the finger is down): stop the
  // auto-scroll interval and give the page its scroll back.
  React.useEffect(() => () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (cur.current) { cur.current = null; optsRef.current.setScrollEnabled(true); }
  }, []);

  /* Spread onto the grip View: {...drag.handle('list', i)} */
  const handle = React.useCallback((list: string, index: number) => {
    const key = kOf(list, index);
    if (!responders.has(key)) {
      responders.set(key, PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const cfg = lists.get(list);
          if (!cfg || cfg.count < 2) return;
          cur.current = { list, index, count: cfg.count, gap: cfg.gap };
          moveFn.current = cfg.onMove;
          adj.current = 0; lastDy.current = 0; armed.current = false;
          seenOffset.current = optsRef.current.scrollOffsetRef.current;
          dragY.setValue(0);
          // Lock the page scroll now (Android needs it before any move), but the
          // lift + haptic wait for real movement — a stray touch does nothing.
          optsRef.current.setScrollEnabled(false);
          if (timer.current) clearInterval(timer.current);
          timer.current = setInterval(tick, 32);
        },
        onPanResponderMove: (_e: any, g: any) => {
          if (!cur.current) return;
          if (!armed.current) {
            if (Math.abs(g.dy) < 4) return;
            armed.current = true;
            setDragging({ list: cur.current.list, index: cur.current.index });
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          }
          lastDy.current = g.dy; lastMoveY.current = g.moveY; trySwap();
        },
        onPanResponderRelease: end,
        onPanResponderTerminate: end,
      }));
    }
    return responders.get(key).panHandlers as Record<string, any>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rowLayout = React.useCallback((list: string, index: number) => (e: LayoutChangeEvent) => { heights.set(kOf(list, index), e.nativeEvent.layout.height); }, []);

  /* Style for the row WRAPPER (must be an Animated.View). */
  const rowStyle = React.useCallback((list: string, index: number): any =>
    dragging && dragging.list === list && dragging.index === index
      ? { transform: [{ translateY: dragY }, { scale: 1.02 }], zIndex: 50, elevation: 14, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } }
      : null, [dragging]);

  return React.useMemo(() => ({ dragging, setList, handle, rowLayout, rowStyle }), [dragging, setList, handle, rowLayout, rowStyle]);
}
