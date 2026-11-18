/*
 * The shared animation engine: one requestAnimationFrame loop drives every
 * live component (anything with frame(dt) -> boolean), parking itself when they
 * all report done and waking on demand.
 *
 * THE INVARIANT: no single component may stop the shared loop. One control that
 * throws - or that cannot accept the per-frame bookkeeping - costs its own
 * animation and nothing else. That is enforced three ways: every per-component
 * statement runs inside a try, the tail that schedules the next frame runs in a
 * finally, and a wake that finds the loop marked running but silent restarts it.
 */

import { clamp } from "../utilities/index.js";

// The surface the engine drives - JellyElement satisfies this structurally
export interface JellyComponent {
	frame(dt: number): boolean;

	frameDt?: number;

	colorEasing?: boolean;
}

/*
 * How long the loop may be marked running without a frame actually arriving
 * before wake() treats it as wedged and starts a fresh chain. A frame is 16.7ms
 * at 60Hz, so 250ms is roughly fifteen missed frames: long enough that a busy
 * main thread never trips it, short enough that a real wedge is repaired by the
 * next interaction instead of by a reload.
 */
const STALL_MS = 250;

class JellyEngine {
	private active = new Set<JellyComponent>();

	private running = false;

	private lastTime = 0;

	// When the loop last actually ran - not when it was scheduled. This is the
	// watchdog's clock, and the only honest answer to "is a frame coming?".
	private lastFrameAt = 0;

	// The single pending frame. Kept so a restart can cancel the chain it
	// replaces instead of leaving two loops stepping the same Set.
	private frameId = 0;

	// Components whose frame has already failed, so a broken control is logged
	// once rather than once per frame.
	private failed = new WeakSet<JellyComponent>();

	constructor() {
		this.loop = this.loop.bind(this);
	}

	// Add a component to the loop and start it if it was parked
	wake(component: JellyComponent): void {
		this.active.add(component);

		if (this.running) {
			// Marked running and frames are arriving: the loop picks this
			// component up on its next tick.
			if (performance.now() - this.lastFrameAt <= STALL_MS) {
				return;
			}

			// Marked running, but nothing has run for a quarter second: the chain
			// was consumed and never rescheduled, or the tab was frozen mid-frame.
			// Trust the timestamp over the flag and start a fresh chain.
			this.running = false;
		}

		this.start();
	}

	// Remove a component from the loop (used on disconnect and on parking)
	drop(component: JellyComponent): void {
		this.active.delete(component);

		this.failed.delete(component);
	}

	// Begin a frame chain, replacing any frame still pending from a previous one
	private start(): void {
		if (this.frameId !== 0) {
			cancelAnimationFrame(this.frameId);
		}

		this.running = true;

		this.lastTime = performance.now();

		this.lastFrameAt = this.lastTime;

		this.frameId = requestAnimationFrame(this.loop);
	}

	// One shared animation frame: step every live component, park when idle.
	// The delta is capped so a background-tab pause never becomes one giant step.
	loop(now: number): void {
		// This frame is being consumed: nothing is pending until the tail below
		// schedules the next one.
		this.frameId = 0;

		const dt = clamp((now - this.lastTime) / 1000, 0, 0.033);

		this.lastTime = now;

		this.lastFrameAt = now;

		try {
			for (const component of this.active) {
				let keep = false;

				try {
					// Expose the frame delta to paintBody's colour easing and reset
					// the per-frame "still easing" flag the base class raises while a
					// fill is crossfading - so a component stays awake until its
					// colours settle. Inside the try on purpose: a component that
					// cannot accept these writes is a component that cannot be
					// animated, and must not take the loop down with it.
					component.frameDt = dt;

					component.colorEasing = false;

					keep = component.frame(dt);

					if (!keep && !component.colorEasing) {
						this.active.delete(component);
					}

					// It survived a frame, so a future failure is worth logging
					// again - the console stays honest about a component that
					// recovers and then breaks.
					this.failed.delete(component);
				} catch (error) {
					// Drop it rather than step it again: a control that cannot paint
					// must not keep the loop alive, or the console flooded, for the
					// rest of the session. Its owner re-wakes it on the next
					// interaction or resize - the same path every sleeping component
					// already takes.
					this.active.delete(component);

					if (!this.failed.has(component)) {
						this.failed.add(component);

						console.error("Jelly UI frame error", error);
					}
				}
			}
		} finally {
			// The tail runs no matter what happened above: `running` and a pending
			// frame always agree, so no thrown statement can leave the loop marked
			// alive with nothing on the clock.
			if (this.active.size > 0) {
				this.frameId = requestAnimationFrame(this.loop);
			} else {
				this.running = false;

				this.frameId = 0;
			}
		}
	}
}

export const engine = new JellyEngine();
