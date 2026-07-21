import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { C, F, hexA } from '../theme';
import { Icon } from '../icons';

/* App-wide screen guard: a render error in any screen shows a readable card
   (with the real message) and a Retry, instead of a raw red "render error"
   crash. Resets automatically when the route changes. */
export class ScreenErrorBoundary extends React.Component<
  { resetKey: string; children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: any) {
    return { error: e?.message ? String(e.message) : 'Something went wrong' };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 12 }}>
          <View style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: hexA(C.red, 0.12), borderWidth: 1, borderColor: hexA(C.red, 0.35) }}>
            <Icon name="alert" size={24} color={C.red} strokeWidth={2} />
          </View>
          <Text style={{ fontFamily: F.serif, fontSize: 19, color: '#fff', textAlign: 'center' }}>This screen hit a snag</Text>
          <Text style={{ fontFamily: F.body, fontSize: 12.5, color: C.muted2, textAlign: 'center', lineHeight: 18 }}>
            The page couldn't finish rendering. You can retry, or go back and try again.
          </Text>
          <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.muted3, textAlign: 'center' }} numberOfLines={4}>{this.state.error}</Text>
          <Pressable onPress={() => this.setState({ error: null })} style={{ marginTop: 4, paddingVertical: 10, paddingHorizontal: 22, borderRadius: 999, backgroundColor: hexA(C.orange, 0.14), borderWidth: 1, borderColor: hexA(C.orange, 0.4) }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.orange }}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children as any;
  }
}
