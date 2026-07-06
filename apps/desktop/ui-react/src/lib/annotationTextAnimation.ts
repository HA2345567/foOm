import type { AnnotationRegion } from "@/components/video-editor/types";

export type TextAnimation = "none" | "fade-in" | "slide-up" | "slide-left" | "typewriter";

export interface TextAnimationState {
	opacity: number;
	translateX: number;
	translateY: number;
	scale: number;
	revealProgress: number;
}

export const TEXT_ANIMATION_OPTIONS: Array<{
	value: TextAnimation;
	translationKey: string;
}> = [
	{ value: "none", translationKey: "animation.none" },
	{ value: "fade-in", translationKey: "animation.fadeIn" },
	{ value: "slide-up", translationKey: "animation.slideUp" },
	{ value: "slide-left", translationKey: "animation.slideLeft" },
	{ value: "typewriter", translationKey: "animation.typewriter" },
];

export function normalizeTextAnimation(value: unknown): TextAnimation {
	const valid: TextAnimation[] = ["none", "fade-in", "slide-up", "slide-left", "typewriter"];
	return valid.includes(value as TextAnimation) ? (value as TextAnimation) : "none";
}

const ANIMATION_DURATION_MS = 500;

export function getTextAnimationState(
	annotation: AnnotationRegion,
	currentTimeMs: number,
): TextAnimationState {
	const animation = (annotation.style as { textAnimation?: TextAnimation }).textAnimation ?? "none";
	const elapsed = currentTimeMs - annotation.startMs;
	const progress = Math.min(1, Math.max(0, elapsed / ANIMATION_DURATION_MS));

	const defaultState: TextAnimationState = {
		opacity: 1,
		translateX: 0,
		translateY: 0,
		scale: 1,
		revealProgress: 1,
	};

	if (animation === "none" || elapsed >= ANIMATION_DURATION_MS) {
		return defaultState;
	}

	const ease = 1 - Math.pow(1 - progress, 3);

	switch (animation) {
		case "fade-in":
			return { ...defaultState, opacity: ease, revealProgress: 1 };
		case "slide-up":
			return { ...defaultState, opacity: ease, translateY: (1 - ease) * 20, revealProgress: 1 };
		case "slide-left":
			return { ...defaultState, opacity: ease, translateX: (1 - ease) * 20, revealProgress: 1 };
		case "typewriter":
			return { ...defaultState, revealProgress: ease };
		default:
			return defaultState;
	}
}
