import { Alert, Platform } from 'react-native';

// react-native-web's Alert.alert is a no-op, so on web these fall back to the browser's own dialogs.

/** Yes/No question that also works on web. */
export function confirmAction(
  title: string,
  message: string,
  confirmText: string,
  cancelText: string,
  onConfirm: () => void,
  destructive = false,
): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelText, style: 'cancel' },
    { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}

/** Message that also shows on web. */
export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}
