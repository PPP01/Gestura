// Turns the wheel events of one scroll into steps: a notch of a mouse wheel is
// one step, a trackpad swipe is a few instead of dozens. The first event of a
// scroll always counts, so the menu reacts at once.
const NEW_SCROLL_GAP_MS = 1000;
const LINE_PX = 16.67;

export class WheelAccumulator {
	#threshold;
	#sum = 0;
	#lastTime = -Infinity;
	#lastDir = 0;

	constructor(threshold) {
		this.#threshold = threshold;
	}

	// deltaMode follows WheelEvent: 0 pixels, 1 lines, 2 pages.
	step(deltaY, deltaMode, timeStamp) {
		const dir = Math.sign(deltaY);
		const isNewScroll = timeStamp - this.#lastTime > NEW_SCROLL_GAP_MS
			|| (this.#lastDir !== 0 && dir !== this.#lastDir);
		this.#lastTime = timeStamp;
		this.#lastDir = dir;
		if (isNewScroll || deltaMode === 2) {
			this.#sum = 0;
			return true;
		}
		this.#sum += Math.abs(deltaMode === 1 ? deltaY * LINE_PX : deltaY);
		if (this.#sum < this.#threshold) return false;
		this.#sum = 0;
		return true;
	}

	reset() {
		this.#sum = 0;
		this.#lastTime = -Infinity;
		this.#lastDir = 0;
	}
}
