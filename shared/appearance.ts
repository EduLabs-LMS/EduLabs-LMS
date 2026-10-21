/** Browser-local LMS appearance; separate from Website Studio themes. */
export const appearanceStorageKey = 'edulabs-lms-appearance';
export const appearanceModes = ['light', 'dark', 'system'] as const;
export type AppearanceMode = typeof appearanceModes[number];
export function isAppearanceMode(value: unknown): value is AppearanceMode {
 return appearanceModes.some(mode => mode === value);
}
/** Runs before next-themes' pre-paint script; stored values never enter code. */
export const appearanceBootstrap = `try{var k=${JSON.stringify(appearanceStorageKey)},v=localStorage.getItem(k);if(v!==null&&v!=='light'&&v!=='dark'&&v!=='system')localStorage.removeItem(k);}catch(e){}`;
