import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';
// The ride location task must be defined at module scope before any start (21 Oct 2026).
import './src/lib/rideLocationTask';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
