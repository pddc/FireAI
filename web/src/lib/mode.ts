// Build-time mode flag. Kept separate from firebase.ts so importing it never pulls the Firebase SDK.
export const IS_CLOUD = import.meta.env.VITE_FIREAI_MODE === 'cloud'
