export const DEFAULT_CURSOR_THEME_ID = "default";

export interface CursorTheme {
	id: string;
	name: string;
	assets: {
		arrow?: { assetPath: string };
		pointer?: { assetPath: string };
	};
}

/** Additional cursor themes beyond the built-in default. */
export const CURSOR_THEMES: CursorTheme[] = [];
