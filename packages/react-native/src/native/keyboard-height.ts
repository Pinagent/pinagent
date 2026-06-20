// SPDX-License-Identifier: Apache-2.0

/**
 * Soft-keyboard height hook for the RN widget's modal sheets.
 *
 * Both the composer (Pinagent.tsx) and the stream sheet (StreamSheet.tsx)
 * present in their own `Modal`, and both need to lift their pinned input above
 * the soft keyboard. `KeyboardAvoidingView` is unreliable inside a `Modal` —
 * the modal presents in its own window, so the view's measured origin is wrong
 * and the computed inset never lifts the sheet. Driving a `paddingBottom` inset
 * off the live keyboard frame is the robust cross-platform path, so the logic
 * lives here once and both sheets share it.
 *
 * iOS fires the `*Will*` events (in sync with the slide animation); Android
 * only fires `*Did*`.
 */
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/** Live soft-keyboard height in px (0 when hidden). */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
