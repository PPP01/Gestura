class GestureRecognizer {
	// Stillness radius for the pause rule, in CSS px. Fixed on purpose: tied to
	// distanceThreshold it would grow to 25 px at that slider's maximum.
	static PAUSE_JITTER = 6;
	static REPEAT_DISTANCE_MAX = 600;
	static REPEAT_PAUSE_MAX = 2000;

	// The one place that maps settings to recognizer config; the content script
	// and the options page (for its recorders) both use it.
	static configFromSettings(s) {
		return {
			distanceThreshold: s.distanceThreshold,
			longGestureMultiplier: s.gestureTurnTolerance,
			repeatDistance: s.gestureRepeatDistance,
			repeatPause: s.gestureRepeatPause,
		};
	}

	#distanceThreshold;
	#longGestureMultiplier;
	#maxThreshold;
	#repeatDistance = 0;
	#repeatPause = 0;
	#source = 'pointer';
	#active = false;
	#startX = 0;
	#startY = 0;
	#startTimestamp = 0;
	#anchorX = 0;
	#anchorY = 0;
	#currentX = 0;
	#currentY = 0;
	#pattern = [];
	#points = [];
	#segmentLength = 0;
	#repeatProgress = 0;
	#rest = null;
	#pauseArmed = false;
	#lastTimestamp = null;

	constructor(config = {}) {
		this.#distanceThreshold = config.distanceThreshold || 20;
		this.#longGestureMultiplier = config.longGestureMultiplier ?? 0.10;
		this.#maxThreshold = config.maxThreshold ?? 120;
		this.#repeatDistance = GestureRecognizer.#limit(config.repeatDistance, GestureRecognizer.REPEAT_DISTANCE_MAX);
		this.#repeatPause = GestureRecognizer.#limit(config.repeatPause, GestureRecognizer.REPEAT_PAUSE_MAX);
		this.reset();
	}

	// Anything but a finite positive number - omitted, negative, a string from a
	// hand-edited import - means off.
	static #limit(value, max) {
		if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
		return Math.min(value, max);
	}

	updateConfig(config) {
		if (config.distanceThreshold) {
			this.#distanceThreshold = config.distanceThreshold;
		}
		if (config.longGestureMultiplier !== undefined) {
			this.#longGestureMultiplier = config.longGestureMultiplier;
		}
		if (config.repeatDistance !== undefined) {
			this.#repeatDistance = GestureRecognizer.#limit(config.repeatDistance, GestureRecognizer.REPEAT_DISTANCE_MAX);
		}
		if (config.repeatPause !== undefined) {
			this.#repeatPause = GestureRecognizer.#limit(config.repeatPause, GestureRecognizer.REPEAT_PAUSE_MAX);
		}
	}

	reset() {
		this.#active = false;
		this.#startX = 0;
		this.#startY = 0;
		this.#startTimestamp = 0;
		this.#anchorX = 0;
		this.#anchorY = 0;
		this.#currentX = 0;
		this.#currentY = 0;
		this.#pattern = [];
		this.#points = [];
		this.#segmentLength = 0;
		this.#repeatProgress = 0;
		this.#source = 'pointer';
		this.#rest = null;
		this.#pauseArmed = false;
		this.#lastTimestamp = null;
	}

	start(x, y, timestamp = 0, options = {}) {
		this.reset();
		this.#source = options?.source === 'drag' ? 'drag' : 'pointer';
		this.#acceptTimestamp(timestamp);
		this.#startX = x;
		this.#startY = y;
		this.#startTimestamp = timestamp;
		this.#anchorX = x;
		this.#anchorY = y;
		this.#currentX = x;
		this.#currentY = y;
		this.#points.push({ x, y, timestamp });
	}

	move(x, y, timestamp = null) {
		const ts = this.#acceptTimestamp(timestamp);
		this.#currentX = x;
		this.#currentY = y;
		this.#points.push({ x, y, timestamp });

		const result = {
			activated: false,
			directionChanged: false,
			direction: null,
			pattern: this.#pattern.join(''),
			preActivationTrail: [],
			totalDistance: 0,
		};

		const totalDeltaX = this.#currentX - this.#startX;
		const totalDeltaY = this.#currentY - this.#startY;
		const totalDistance = Math.sqrt(totalDeltaX * totalDeltaX + totalDeltaY * totalDeltaY);
		result.totalDistance = totalDistance;

		if (!this.#active && totalDistance > this.#distanceThreshold) {
			this.#active = true;
			result.activated = true;
			result.preActivationTrail = [...this.#points];

			if (this.#distanceThreshold >= 10) {
				let replayMultiplier = 0.7;
				if (this.#distanceThreshold < 15) replayMultiplier = 0.8;

				const replayThreshold = this.#distanceThreshold * replayMultiplier;

				this.#pattern = [];
				this.#anchorX = this.#startX;
				this.#anchorY = this.#startY;
				this.#segmentLength = 0;

				for (const p of this.#points) {
					const deltaX = p.x - this.#anchorX;
					const deltaY = p.y - this.#anchorY;
					const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

					if (dist > replayThreshold) {
						const direction = this.#getDirection(deltaX, deltaY);
						const lastDirection = this.#pattern[this.#pattern.length - 1];

						if (direction !== lastDirection) {
							this.#pattern.push(direction);
							this.#anchorX = p.x;
							this.#anchorY = p.y;
							this.#segmentLength = dist;
						} else {
							this.#segmentLength += dist;
							this.#anchorX = p.x;
							this.#anchorY = p.y;
						}
					}
				}
			}

			if (this.#pattern.length === 0) {
				const dir = this.#getDirection(totalDeltaX, totalDeltaY);
				this.#pattern.push(dir);
				this.#anchorX = this.#currentX;
				this.#anchorY = this.#currentY;
				this.#segmentLength = totalDistance;
			}

			result.pattern = this.#pattern.join('');
			result.direction = this.#pattern[this.#pattern.length - 1];
			result.directionChanged = true;

			// Rest tracking starts here, not in start(): slow movement before
			// activation must never count as a pause.
			this.#rest = { x: this.#currentX, y: this.#currentY, t: ts };

			// A single long move event from pointer-down has no later move to
			// cross repeatDistance on, so the replayed segment is checked here.
			this.#repeatProgress = this.#segmentLength;
			this.#checkLongStroke(result);
		}

		if (!this.#active) {
			return result;
		}

		if (!result.activated) {
			this.#trackRest(ts);
		}

		const deltaX = this.#currentX - this.#anchorX;
		const deltaY = this.#currentY - this.#anchorY;
		const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

		if (distance > this.#distanceThreshold) {
			const direction = this.#getDirection(deltaX, deltaY);
			const lastDirection = this.#pattern[this.#pattern.length - 1];

			if (this.#pauseArmed) {
				// Consumed whatever happens - also when the cap rejects the
				// repeat - so it never leaks into a later segment.
				this.#pauseArmed = false;
				if (direction === lastDirection) {
					this.#appendRepeat(result);
				} else {
					this.#pushDirection(direction, result);
				}
				this.#startSegment(distance);
			} else if (direction === lastDirection) {
				this.#segmentLength += distance;
				this.#repeatProgress += distance;
				this.#anchorX = this.#currentX;
				this.#anchorY = this.#currentY;
				this.#checkLongStroke(result);
			} else {
				const adaptiveThreshold = Math.min(
					this.#maxThreshold,
					this.#distanceThreshold + this.#segmentLength * this.#longGestureMultiplier
				);

				if (distance > adaptiveThreshold) {
					this.#pushDirection(direction, result);
					this.#startSegment(distance);
				}
			}
		}

		return result;
	}

	getPattern() {
		return this.#pattern.join('');
	}

	isActive() {
		return this.#active;
	}

	get startX() {
		return this.#startX;
	}

	get startY() {
		return this.#startY;
	}

	get currentX() {
		return this.#currentX;
	}

	get currentY() {
		return this.#currentY;
	}

	get startTimestamp() {
		return this.#startTimestamp;
	}

	// Never below twice the activation threshold, or every stroke would double
	// on its first step.
	#effectiveRepeatDistance() {
		return this.#repeatDistance ? Math.max(this.#repeatDistance, 2 * this.#distanceThreshold) : 0;
	}

	// Reports a new direction exactly like a turn, so HUD, suggestions and
	// recorder update - also for a repeat.
	#pushDirection(direction, result) {
		this.#pattern.push(direction);
		result.directionChanged = true;
		result.direction = direction;
		result.pattern = this.#pattern.join('');
	}

	// A new physical segment begins at the current point.
	#startSegment(distance) {
		this.#segmentLength = distance;
		this.#repeatProgress = distance;
		this.#anchorX = this.#currentX;
		this.#anchorY = this.#currentY;
	}

	// Appends the last direction once more - never a third time in a row.
	#appendRepeat(result) {
		const n = this.#pattern.length;
		const direction = this.#pattern[n - 1];
		if (n >= 2 && this.#pattern[n - 2] === direction) return false;
		this.#pushDirection(direction, result);
		return true;
	}

	// segmentLength is deliberately left alone: it is the physical stroke, and
	// the adaptive turn threshold depends on it.
	#checkLongStroke(result) {
		const limit = this.#effectiveRepeatDistance();
		if (limit && this.#repeatProgress >= limit && this.#appendRepeat(result)) {
			this.#repeatProgress -= limit;
		}
	}

	// Only a finite timestamp that does not run backwards can measure a pause.
	#acceptTimestamp(timestamp) {
		if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return null;
		if (this.#lastTimestamp !== null && timestamp < this.#lastTimestamp) return null;
		this.#lastTimestamp = timestamp;
		return timestamp;
	}

	#trackRest(ts) {
		if (!this.#repeatPause) return;
		const x = this.#currentX;
		const y = this.#currentY;
		const rest = this.#rest;
		if (!rest) {
			this.#rest = { x, y, t: ts };
			return;
		}
		const dx = x - rest.x;
		const dy = y - rest.y;
		const still = dx * dx + dy * dy <= GestureRecognizer.PAUSE_JITTER ** 2;
		if (still) {
			if (rest.t === null) rest.t = ts;
			else if (ts !== null && ts - rest.t >= this.#repeatPause) this.#armPause(rest);
			return;
		}
		// Mouse and pen send nothing while still, so for them the gap before the
		// move that leaves the radius is the pause. dragover keeps firing while
		// still and arrives sparsely while moving: there a gap proves nothing.
		if (this.#source === 'pointer' && ts !== null && rest.t !== null && ts - rest.t >= this.#repeatPause) {
			this.#armPause(rest);
		}
		// After arming, which reads the pre-pause rest point. In place: this runs
		// on every move while the pointer travels.
		rest.x = x;
		rest.y = y;
		rest.t = ts;
	}

	// Anchors at the point of rest, so the resumed movement counts toward the
	// next segment, and starts that segment from zero: after a full stop a turn
	// needs only distanceThreshold.
	#armPause(rest) {
		this.#pauseArmed = true;
		this.#anchorX = rest.x;
		this.#anchorY = rest.y;
		this.#segmentLength = 0;
		this.#repeatProgress = 0;
	}

	#getDirection(deltaX, deltaY) {
		const absDeltaX = Math.abs(deltaX);
		const absDeltaY = Math.abs(deltaY);

		if (absDeltaX > absDeltaY) {
			return deltaX > 0 ? '→' : '←';
		} else {
			return deltaY > 0 ? '↓' : '↑';
		}
	}
}

window.GestureRecognizer = GestureRecognizer;