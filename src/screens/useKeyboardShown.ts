import React from 'react';
import { Keyboard, Platform } from 'react-native';

export type KeyboardState = { shown: boolean; duration: number };

const DEFAULT_DURATION = 250;

/**
 * Whether the on-screen keyboard is up, with the duration of its animation
 * so the dock can move in step with it.
 *
 * Web has no keyboard events, so there a focused text field inside
 * `container` (the app's viewport) counts: that's when a phone browser
 * shows its keyboard.
 */
export function useKeyboardShown(enabled: boolean, container: React.RefObject<unknown>): KeyboardState {
  const [state, setState] = React.useState<KeyboardState>({ shown: false, duration: DEFAULT_DURATION });

  React.useEffect(() => {
    if (!enabled) {
      setState((s) => (s.shown ? { ...s, shown: false } : s));
      return;
    }
    if (Platform.OS === 'web') {
      if (typeof document === 'undefined') return;
      const check = () => {
        const el = document.activeElement as HTMLElement | null;
        const root = container.current as HTMLElement | null;
        const editable =
          !!el &&
          (el.tagName === 'TEXTAREA' ||
            el.isContentEditable ||
            (el.tagName === 'INPUT' &&
              !/^(button|checkbox|radio|range|color|file|submit|reset|image|hidden)$/i.test(
                (el as HTMLInputElement).type,
              )));
        const shown = editable && !!root?.contains?.(el);
        setState((s) => {
          if (s.shown === shown) return s;
          // A tap that moves focus off a field (e.g. its Send button) blurs
          // on pointer down; bringing the dock back then would shift the
          // app before the click lands. Wait for the pointer to come up.
          if (!shown && pointerDown) return s;
          return { shown, duration: 200 };
        });
      };
      let pointerDown = false;
      const onPointerDown = () => {
        pointerDown = true;
      };
      const onPointerUp = () => {
        pointerDown = false;
      };
      // focusout fires before focus lands on the next field. Chromium skips
      // focus events while its window isn't focused, so taps and keys check
      // again once focus has settled.
      const later = () => setTimeout(check, 0);
      const events = ['focusin', 'focusout', 'pointerup', 'keydown'] as const;
      for (const ev of events) document.addEventListener(ev, later, true);
      document.addEventListener('pointerdown', onPointerDown, true);
      document.addEventListener('pointerup', onPointerUp, true);
      document.addEventListener('pointercancel', onPointerUp, true);
      return () => {
        for (const ev of events) document.removeEventListener(ev, later, true);
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('pointerup', onPointerUp, true);
        document.removeEventListener('pointercancel', onPointerUp, true);
      };
    }
    // iOS announces the keyboard before it moves, Android only after.
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) =>
      setState({ shown: true, duration: e.duration || DEFAULT_DURATION }),
    );
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', (e) =>
      setState({ shown: false, duration: e.duration || DEFAULT_DURATION }),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [enabled, container]);

  return state;
}
