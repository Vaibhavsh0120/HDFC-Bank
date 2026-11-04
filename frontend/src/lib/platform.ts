import { Capacitor } from '@capacitor/core';

// Some embedded iOS containers report a zero safe-area inset even on notched phones.
// Retain a conservative portrait fallback in the native shell only.
if (Capacitor.getPlatform() === 'ios') document.documentElement.classList.add('native-ios');
