# iOS handoff: upgrade to Expo SDK 58, end to end (27 Oct 2026)

For the iOS Expo repo. Android (odds-app) moved from SDK 57 to 58 on 27 Oct 2026 (commit 75d7fe8, tag `pre-sdk58`
on the last 57 state). Why: the App Store Expo Go runs the newest SDK only, so an SDK 57 project shows "Project is
incompatible with this version of Expo Go" on an iPhone. Same trigger as the 54 → 57 move on 3 Sep 2026.

## 1. What the upgrade is
| | Before | After |
|---|---|---|
| expo | ^57.0.19 | ^58.0.0 (58.0.19 installed) |
| react-native | 0.86.3 | 0.88.0 |
| react | 19.2.3 | 19.3.0 |
| expo-modules-core | 57.x | 58.0.26 |
| every `expo-*` package | ~57.x | its 58 line (asset 58.0.18, audio 58.0.10, clipboard 58.0.4, document-picker 58.0.4, file-system 58.0.11, font 58.0.10, haptics 58.0.7, image-picker 58.0.10, linear-gradient 58.0.3, location 58.0.19, notifications 58.1.6, print 58.0.7, screen-capture 58.0.6, sharing 58.0.20, speech 58.0.3, sqlite 58.0.14, status-bar 58.0.4, task-manager 58.0.12, video 58.0.12) |
| react-native-gesture-handler | ~2.32.0 | ~3.3.0 (major) |
| react-native-webview | 13.16.1 | 14.0.1 (major) |
| @shopify/flash-list | 2.0.2 | 2.3.2 |
| react-native-safe-area-context | ~5.7.0 | ~5.10.1 |
| react-native-svg | 15.15.4 | 15.16.0 |
Node must be 22.13+, 24.3+ or 26+ (odd versions are not supported).

## 2. Steps, in order
1. Tag the current state: `git tag pre-sdk58`. Keep a copy of `package.json` and the lockfile.
2. Stop Metro. Run `npx expo install expo@^58.0.0`, then `npx expo install --fix`.
3. `npx expo-doctor`. Accept only warnings you already had (ours: the duplicate `@react-native-async-storage` under
   `@amplitude/analytics-react-native`, and the two Amplitude packages "untested on New Architecture").
4. `npx tsc --noEmit`, capture the real exit code (write to a file, then `echo $?`; a `| tail` hides failures).
5. Fix what section 3 lists. Run the rule tests (`node tests/rules/*.js`).
6. `npx expo export --platform ios --output-dir /tmp/exp58` as a bundling check (ours: one 9.8 MB `.hbc`, no errors).
7. `npx expo start` and open the project in the App Store Expo Go on the iPhone (Metro now serves `exposdk:58.0.0`).
8. Native project (only for a real build, not for Expo Go): with CNG, delete `ios/` and prebuild; without CNG, run
   `npx pod-install` and apply the native upgrade helper, and note that prebuild now generates **SceneDelegate.swift**
   (if `AppDelegate.swift` is customised, follow Expo's scene life cycle migration guide).

## 3. Code changes this app needed (all React Native 0.88's strict TypeScript API)
Nothing in feature logic changed. 33 sites, two mechanical patterns plus three small ones:

1. **Refs to native components** are typed with the instance type, not the component class:
   ```ts
   // before                                  // after
   useRef<ScrollView>(null)                  useRef<React.ComponentRef<typeof ScrollView>>(null)
   useRef<TextInput>(null)                   useRef<React.ComponentRef<typeof TextInput>>(null)
   useRef<View>(null)                        useRef<React.ComponentRef<typeof View>>(null)
   useRef<WebView>(null)                     useRef<React.ComponentRef<typeof WebView>>(null)
   useRef<FlatList<T>>(null)                 useRef<React.ComponentRef<typeof FlatList<T>>>(null)
   React.RefObject<ScrollView | null>        React.RefObject<React.ComponentRef<typeof ScrollView> | null>
   ```
   Also the `Page` wrapper in `screens/common.tsx`:
   `React.forwardRef<ScrollView, …>` → `React.forwardRef<React.ComponentRef<typeof ScrollView>, …>` and its
   `useImperativeHandle(ref, () => scrollRef.current as React.ComponentRef<typeof ScrollView>, [])`.
   The errors read "Property 'scrollTo' does not exist on type '((props: …) => ReactNode) & …'" and
   "Type 'RefObject<…>' is not assignable to type 'Ref<ScrollViewInstance>'".
2. **Event handlers must return void.** `onRequestClose={() => !busy && onClose()}` →
   `onRequestClose={() => { if (!busy) onClose(); }}` (error: "Type '() => false | void' is not assignable to type
   'DirectEventHandler<null>'"). Three sites on Android.
3. **List components take `undefined`, not `null`:** `ListHeaderComponent={cond ? <X /> : null}` →
   `… : undefined}` (same for `ListEmptyComponent`, `ListFooterComponent`). Three sites.
4. Not needed here, but in the changelog: deep imports from `react-native/Libraries/*` are type errors (opt-out
   `"react-native-legacy-deep-imports"` in tsconfig `customConditions`); `InteractionManager`, the `Touchable` root
   export, `NativeMethods`, Modal `animated`, StatusBar `backgroundColor` / `translucent` were removed;
   `ImageBackground` is deprecated. Grep for them before assuming.
5. Expo package notes that did not bite this app but must be checked in yours: `expo-file-system` `File.write()` is
   now async (`writeSync()` keeps the old behaviour; we only use `copy`), `File.md5` → `File.digest()`;
   `expo-sqlite` drops libSQL; `expo-notifications` shows foreground notifications by default unless
   `setNotificationHandler` says otherwise (we set it); `expo-location` geofencing on iOS no longer needs the
   `location` background mode (the ride tracker keeps its background mode for `startLocationUpdatesAsync`).

## 4. The two major-version libraries, what to watch on the device
- **react-native-gesture-handler 3:** the app only uses `PanGestureHandler` (drag reorder, the roster sheet) and
  `GestureHandlerRootView`; both still export and type-check. The v3 guide replaces the builder API with hooks
  (`usePanGesture`, `useCompetingGestures`, callbacks renamed `onStart` → `onActivate`, `onEnd` → `onDeactivate`) and
  prefixes old components with `Legacy`; only relevant if you touch gestures. Device check: drag-reorder exercises
  in the plan builder, swipe the roster sheets.
- **react-native-webview 14:** one breaking change, Android minimum API 24; no prop changes. Device check: the QHP
  navigation map, the Nucleus video embeds, the consultant Join page.
- expo-audio / expo-video / expo-speech moved minor versions: play a client summary (Sarvam voice), a shared coach
  note, a Nucleus video, and the navigation voice cues.

## 5. Verify
- `tsc` exit 0 (real exit code), rule suites green, `expo export --platform ios` clean.
- Expo Go on the iPhone opens the project; sign in; Today's Roster, a workout log, a map ride, a voice playback.
- Metro manifest: `curl -H "expo-platform: ios" http://localhost:8081/` shows `"sdkVersion": "58.0.0"`.
