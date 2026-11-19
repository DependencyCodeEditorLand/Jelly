/*
 * JellyElement - the base class for every canvas-backed Jelly UI component
 *
 * Handles the parts every jelly component shares: a shadow-DOM <canvas>
 * sized to the host (plus padding so the wobble can overflow), device-
 * pixel-ratio and resize handling, converting pointer coordinates into
 * shape-local space, theme-change repaints and painting a JellyBody as a
 * flat solid fill. Subclasses provide the interactive markup, the shape,
 * the fill color and event wiring.
 */

import { JellyBody } from "../core/index.js";

import { engine } from "../core/index.js";

import { traceSmoothPath } from "../core/index.js";

import type { JellyComponent } from "../core/index.js";

import type { JellyConfig } from "../core/index.js";

import type { SurfacePoint } from "../core/index.js";

import { canonicalizeSize } from "../utilities/index.js";

import { prefersReducedMotion } from "../utilities/index.js";

import { triggerHaptic } from "../utilities/index.js";

// Noise channels for the hover frame loop (same Staccato pattern)
import { jellyNoise, jellyQuantize } from "../utilities/noise.js";

import { ensureThemeTokens } from "../theme/index.js";

import { notifyThemeChange } from "../theme/index.js";

import { FOCUS_RING } from "../theme/index.js";

import { PALETTE } from "../theme/index.js";

import baseStyles from "../styles/base.css?inline";

import type { RGBA } from "./types.js";

import type { Shape } from "./types.js";

import type { Ring } from "./types.js";

import type { Border } from "./types.js";

import type { PaintOptions } from "./types.js";

import type { WirePressOptions } from "./types.js";

// Re-export the shape / paint / wiring types so consumers import them from here
export type {
	RGBA,
	Shape,
	Ring,
	Border,
	PaintOptions,
	WirePressOptions,
} from "./types.js";

export class JellyElement extends HTMLElement implements JellyComponent {
	// Padding around the shape so the wobble can overflow without clipping
	static PAD = 48;

	/*
	 * The largest canvas this library will allocate, in device pixels. Past
	 * either limit the compositor cannot hold the texture (Chrome refuses a
	 * canvas past 16,384 px on an edge and every GPU has a texture budget),
	 * so the element paints itself as CSS instead - see `applyShape`.
	 */
	static MAX_CANVAS_EDGE = 8192;

	static MAX_CANVAS_AREA = 16_777_216;

	/*
	 * The largest surface the hover loop will keep repainting, in CSS pixels.
	 * The texture limits above decide whether a canvas can exist at all; this
	 * is the animation budget on top of that. A host past it can still be
	 * pressed and painted, but a pointer resting on it would ask for a
	 * full-surface repaint every frame, which no compositor can hold at
	 * 60fps - the pointer would get a slideshow, not a wobble.
	 *
	 * This replaces a `offsetHeight > window.innerHeight` refusal. That rule
	 * measured the window, not the surface: a tall card on a short window was
	 * a control the pointer could see and could never hover, which is one
	 * half of the "it does not register every time" report.
	 */
	static HOVER_AREA_BUDGET = 4_000_000;

	// Source of the per-element hover noise seeds (see `hoverSeed`)
	static hoverSeedCounter = 0;

	body: JellyBody | null = null;

	built = false;

	/*
	 * True while this element paints its surface with CSS instead of a
	 * canvas: a flat rect has nothing for the physics to draw, and a box past
	 * MAX_CANVAS_* cannot be held as a texture. Either way no backing store
	 * exists and no frame loop runs.
	 */
	flat = false;

	/*
	 * True while this element is out of the shared loop because it has no box
	 * to paint: `display: none`, a collapsed parent, or a control the wiring
	 * has not revealed yet. A parked element costs the engine nothing - it is
	 * not stepped, it cannot throw a frame against a canvas with no size, and
	 * `requestFrame()` is a no-op for it - and the ResizeObserver wakes it the
	 * moment its box comes back.
	 */
	parked = false;

	dpr = 1;

	cssW = 0;

	cssH = 0;

	// Per-instance physics overrides; subclasses may assign before build
	config: Partial<JellyConfig> | undefined = undefined;

	// Populated in build()
	canvas!: HTMLCanvasElement;

	ctx!: CanvasRenderingContext2D;

	resizeObserver: ResizeObserver | null = null;

	attributeObserver: MutationObserver | null = null;

	focusVisible = false;

	frameDt = 0;

	colorEasing = false;

	eased: Record<string, RGBA | undefined> = {};

	probe?: HTMLSpanElement;

	hostFocusTarget?: HTMLElement | null;

	hostFocusHandler?: (event: FocusEvent) => void;

	pressPointerId: number | null = null;

	keyboardActive = false;

	/*
	 * Stable per-element noise seed for the hover channels. A counter, not
	 * the element's index in the document: `indexOf` at build time is -1 for
	 * every element that is not in the document yet, so controls built
	 * before insertion all shared one seed and pulsed in lockstep.
	 */
	hoverSeed = ++JellyElement.hoverSeedCounter;

	// The disabled predicate and wiring flag `wireHover` installs, so the
	// shared scroll repair can resume a hover without re-deriving them.
	_hoverWired = false;

	_hoverDisabled: () => boolean = () => this.hasAttribute("disabled");

	/*
	 * Base-class listeners are bound as fields so subclasses keep handleEvent to
	 * themselves. A theme (or direction) change can move the jelly box without
	 * resizing the host - the ResizeObserver won't fire - so reposition the
	 * canvas and let the subclass re-seat any direction-dependent geometry
	 * before repainting.
	 */
	onThemeChange = (): void => {
		if (this.built) {
			this.applyShape();

			this.onShape();
		}

		this.requestFrame();
	};

	// An in-page reduced-motion preview can change independently of the OS
	// media query. Wake parked components so continuous indicators stop or
	// resume immediately and every canvas repaints in its new motion mode.
	onMotionChange = (): void => this.requestFrame();

	onWindowResize = (): void => this.applyShape();

	constructor() {
		super();

		this.attachShadow({ mode: "open", delegatesFocus: true });
	}

	/* ---- Subclass hooks ---------------------------------------------- */

	// Extra CSS (string) for the shadow root
	styles(): string {
		return "";
	}

	// Interactive markup that sits above the canvas
	content(): string {
		return "<slot></slot>";
	}

	// Given the measured host size, return the jelly shape to build
	shape(width: number, height: number): Shape {
		return { width, height, radius: Math.min(width, height) / 2 };
	}

	/*
	 * Whether a plain rect (radius 0) may be painted as CSS instead of a
	 * canvas. A rect with a solid fill is exactly what CSS already draws, so
	 * the canvas would add nothing but a texture and a frame loop. Components
	 * whose surface *is* the rectangle opt in; controls that keep a press
	 * dent or a wobble at radius 0 leave it false.
	 */
	flatSurfaceAllowed(): boolean {
		return false;
	}

	// Resolve the current fill color (the canvas reads the computed token)
	fill(): string {
		const custom = getComputedStyle(this)
			.getPropertyValue("--jelly-fill")
			.trim();

		return custom || PALETTE["background-accent"];
	}

	// Called once after the shadow DOM and canvas exist. Wire events here.
	onBuilt(): void {}

	// Called whenever the shape (re)builds
	onShape(): void {}

	// One animation step. Return true to keep animating.
	frame(dt: number): boolean {
		return this.defaultFrame(dt);
	}

	/* ---- Lifecycle --------------------------------------------------- */

	// Lifecycle method: Called automatically when the element is appended to the DOM
	connectedCallback(): void {
		ensureThemeTokens();

		canonicalizeSize(this);

		if (!this.built) {
			this.build();
		}

		this.observeResize();

		// Many components style themselves entirely from host attributes the
		// subclass doesn't observe (variant → --jelly-fill via CSS, inline
		// --jelly-* overrides, state classes). Repaint the canvas on any host
		// attribute change so a dynamically set variant / token takes effect
		// immediately instead of waiting for the next interaction.
		if (!this.attributeObserver) {
			this.attributeObserver = new MutationObserver(() =>
				this.requestFrame(),
			);

			this.attributeObserver.observe(this, { attributes: true });
		}

		// Theme flips change the computed fill; zoom changes the device pixel
		// ratio without firing the ResizeObserver - both need a repaint
		window.addEventListener("jelly-theme-change", this.onThemeChange);

		window.addEventListener("jelly-motion-change", this.onMotionChange);

		window.addEventListener("resize", this.onWindowResize, {
			passive: true,
		});

		this.requestFrame();
	}

	// Lifecycle method: Called automatically when the element leaves the DOM
	disconnectedCallback(): void {
		// Stop the hover chain before dropping out of the loop: a pending hover
		// frame calls requestFrame(), which would put a detached element straight
		// back into `active` and keep stepping it for the rest of the session.
		this.stopHoverLoop();

		engine.drop(this);

		window.removeEventListener("jelly-theme-change", this.onThemeChange);

		window.removeEventListener("jelly-motion-change", this.onMotionChange);

		window.removeEventListener("resize", this.onWindowResize);

		if (this.resizeObserver) {
			this.resizeObserver.disconnect();

			this.resizeObserver = null;
		}

		if (this.attributeObserver) {
			this.attributeObserver.disconnect();

			this.attributeObserver = null;
		}
	}

	// True when the user prefers reduced motion (checked live, not cached)
	get reducedMotion(): boolean {
		return prefersReducedMotion();
	}

	// Render the shadow DOM once and let the subclass wire itself up
	build(): void {
		this.shadowRoot!.innerHTML =
			`<style>${baseStyles}${this.styles()}</style>` +
			`<canvas class="jelly-canvas" part="jelly" aria-hidden="true"></canvas>` +
			`<div class="jelly-content">${this.content()}</div>`;

		this.canvas =
			this.shadowRoot!.querySelector<HTMLCanvasElement>(".jelly-canvas")!;

		this.ctx = this.canvas.getContext("2d")!;

		this.built = true;

		this.onBuilt();
	}

	// Rebuild the shape whenever the host's layout size changes
	observeResize(): void {
		if (this.resizeObserver) {
			return;
		}

		this.resizeObserver = new ResizeObserver(() => this.applyShape());

		this.resizeObserver.observe(this);

		/*
		 * A `data-jelly-box` control can collapse inside a host that keeps its
		 * own size (a checkbox whose inner control is hidden under a visible
		 * label). Watching only the host would then strand a visible element in
		 * `parked`: the box measured zero, the host never resized, so no
		 * measurement was ever coming to release it. Observe the box as well, so
		 * a park is always undone by the next measurement of what was actually
		 * measured.
		 */
		const boxEl = this.shadowRoot?.querySelector("[data-jelly-box]");

		if (boxEl) {
			this.resizeObserver.observe(boxEl);
		}

		this.applyShape();
	}

	/*
	 * The region the jelly shape occupies, in host-local pixels. Defaults to
	 * the whole host; a component can mark an inner element with
	 * `data-jelly-box` to render the jelly over just that sub-region
	 * (e.g. a checkbox next to its label).
	 */
	jellyBox(): {
		width: number;

		height: number;

		offsetX: number;

		offsetY: number;

		screenX: number;

		screenY: number;
	} {
		const hostRect = this.getBoundingClientRect();

		// Divide out any ancestor CSS transform (e.g. a dialog's open-scale pop,
		// which scales x and y by DIFFERENT amounts) per-axis, so the canvas is
		// sized in the element's own layout units. Otherwise a jelly built
		// mid-animation bakes in at the wrong size / aspect ratio and never
		// corrects. (For an untransformed element sx / sy ≈ 1, so this is a no-op.)
		const sx = this.offsetWidth > 0 ? hostRect.width / this.offsetWidth : 1;

		const sy =
			this.offsetHeight > 0 ? hostRect.height / this.offsetHeight : 1;

		const invX = sx > 0.001 ? 1 / sx : 1;

		const invY = sy > 0.001 ? 1 / sy : 1;

		const boxEl = this.shadowRoot!.querySelector("[data-jelly-box]");

		const b = boxEl ? boxEl.getBoundingClientRect() : hostRect;

		return {
			width: b.width * invX,

			height: b.height * invY,

			offsetX: (b.left + b.width / 2 - hostRect.left) * invX,

			offsetY: (b.top + b.height / 2 - hostRect.top) * invY,

			// Screen coords stay in screen space for pointer → local mapping
			screenX: b.left + b.width / 2,

			screenY: b.top + b.height / 2,
		};
	}

	/*
	 * Take this element out of the shared loop without disconnecting it. Used
	 * when the host has no box (see `applyShape`): a hidden control is not a
	 * control the engine should be stepping, and `hidden` is not a DOM removal,
	 * so `disconnectedCallback` never runs to drop it.
	 *
	 * A park is only ever a consequence of a *measured* zero box - it is never
	 * set from an attribute, a timer or a guess. That matters because a park is
	 * invisible: the element keeps its canvas, its body and its place in the
	 * layout, so a park that outlives its measurement is a visible control the
	 * engine refuses to touch. Three things undo it: the next ResizeObserver
	 * measurement (the box is observed alongside the host), the next press, and
	 * the next pointer (`ensureMembrane`).
	 *
	 * The physics body is kept - it is still the right body for this element -
	 * so coming back is a resize and a repaint, not a rebuild.
	 */
	park(): void {
		this.parked = true;

		// Before stopHoverLoop: its settling requestFrame() must not re-add us.
		this.stopHoverLoop();

		engine.drop(this);
	}

	/*
	 * The pointer is a measurement. A park is only ever the result of a zero
	 * box, so a pointer standing on this element proves the box came back -
	 * and for a park caused by an inner `data-jelly-box` collapsing, the host
	 * ResizeObserver may never fire again. Rebuild here, synchronously, on the
	 * same event, instead of waiting for a measurement that may not come.
	 *
	 * This is the same rebuild the press path performs; the pointer and the
	 * press are both evidence that the control is on screen and reachable.
	 *
	 * Returns true when a membrane exists and the element is not parked.
	 */
	ensureMembrane(): boolean {
		// A CSS-painted surface has no texture to deform: nothing to rebuild.
		if (this.flat) {
			return false;
		}

		if (this.parked || !this.body) {
			if (!this.built) {
				return false;
			}

			this.applyShape();
		}

		return !this.parked && this.body !== null && !this.flat;
	}

	// Size the canvas for the current shape and (re)build the physics body
	applyShape(): void {
		if (!this.built) {
			return;
		}

		const box = this.jellyBox();

		if (box.width < 1 || box.height < 1) {
			// No box, nothing to paint. Leave the shared loop and stop the hover
			// chain: a control hidden under the pointer (the copy cycle does
			// exactly that) would otherwise stay in `active` with a 0x0 host,
			// stepping a body whose canvas has no size, and keep the engine - and
			// itself - awake for the rest of the session.
			this.park();

			return;
		}

		// Coming back from a park: the canvas kept its size and its pixels, but
		// the element left the loop, so it has to be handed back even when
		// nothing about the texture changed.
		const returning = this.parked;

		this.parked = false;

		const shape = this.shape(box.width, box.height);

		const pad = (this.constructor as typeof JellyElement).PAD;

		const cssW = shape.width + pad * 2;

		const cssH = shape.height + pad * 2;

		const dpr = Math.min(window.devicePixelRatio || 1, 3);

		const pxW = Math.round(cssW * dpr);

		const pxH = Math.round(cssH * dpr);

		/*
		 * Two reasons to paint this surface with CSS instead of allocating a
		 * canvas: a flat rect (radius 0, the whole site's rule - the identity
		 * is flat) has nothing for the physics to draw, and a box past the
		 * texture limits cannot be held by the compositor at all. Either way
		 * the canvas would only ever paint a rectangle, so skip the backing
		 * store and the frame loop that maintains it.
		 */
		const flat = shape.radius <= 0 && this.flatSurfaceAllowed();

		const oversized =
			pxW > JellyElement.MAX_CANVAS_EDGE ||
			pxH > JellyElement.MAX_CANVAS_EDGE ||
			pxW * pxH > JellyElement.MAX_CANVAS_AREA;

		if (flat || oversized) {
			this.useCssSurface(cssW, cssH);

			return;
		}

		// The box came back inside the limits (a flat token was re-rounded, a
		// window shrank): restore the canvas before sizing it below.
		if (this.flat) {
			this.useCanvasSurface();
		}

		// Repositioning the canvas is cheap and never clears it - always do it
		this.canvas.style.left = `${box.offsetX}px`;

		this.canvas.style.top = `${box.offsetY}px`;

		// But *resizing* the canvas clears it (a visible flicker) and rebuilds
		// the membrane. Only do that when the pixel size actually changes - a
		// sub-pixel reflow (e.g. a tab's active label going bold) must not trigger it.
		if (
			this.body &&
			this.canvas.width === pxW &&
			this.canvas.height === pxH
		) {
			// Same texture. A returning element still needs the loop back: it
			// kept its canvas through the park but not its place in `active`.
			if (returning) {
				this.requestFrame();
			}

			return;
		}

		this.dpr = dpr;

		this.cssW = cssW;

		this.cssH = cssH;

		this.canvas.style.width = `${cssW}px`;

		this.canvas.style.height = `${cssH}px`;

		this.canvas.width = pxW;

		this.canvas.height = pxH;

		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

		if (!this.body) {
			this.body = new JellyBody({
				width: shape.width,
				height: shape.height,
				radius: shape.radius,
				config: this.config,
			});
		} else {
			this.body.resize(shape.width, shape.height, shape.radius);
		}

		this.onShape();

		// Resizing the canvas above cleared it. Repaint synchronously so a fast
		// size transition (the ResizeObserver fires every frame) never flashes a
		// blank frame between the resize and the engine's next tick, then wake the
		// engine to let the physics settle.
		try {
			this.frame(0);
		} catch (error) {
			console.error("Jelly UI paint error", error);
		}

		this.requestFrame();
	}

	/*
	 * Paint the surface as CSS: publish the fill and the hairline the canvas
	 * used to draw, release the backing store, and drop the physics body so
	 * nothing can schedule a repaint of a texture that no longer exists.
	 */
	useCssSurface(cssW: number, cssH: number): void {
		const first = !this.flat;

		this.flat = true;

		// Park the hover loop before the body it feeds is gone.
		this.stopHoverLoop();

		this.body = null;

		this.cssW = cssW;

		this.cssH = cssH;

		this.dpr = 1;

		// Zeroing the bitmap is what actually frees the texture; hiding it
		// keeps a 0x0 canvas from participating in layout or paint.
		if (this.canvas.width !== 0 || this.canvas.height !== 0) {
			this.canvas.width = 0;

			this.canvas.height = 0;
		}

		this.canvas.hidden = true;

		if (first) {
			this.setAttribute("data-jelly-flat", "");

			this.onShape();
		}

		this.syncFlatSurface();
	}

	// Leave the CSS fast path and hand the surface back to the canvas
	useCanvasSurface(): void {
		this.flat = false;

		this.canvas.hidden = false;

		this.removeAttribute("data-jelly-flat");

		this.style.removeProperty("--jelly-flat-fill");

		this.style.removeProperty("--jelly-flat-border");
	}

	/*
	 * Publish the flat surface's paint. The fill is a token expression, so it
	 * is handed to CSS unresolved and re-resolved by the browser; the
	 * hairline is the border the canvas would have stroked. Guarded against
	 * rewriting an identical value: every write mutates the host's style
	 * attribute, which the element's own MutationObserver wakes a frame for.
	 */
	syncFlatSurface(): void {
		const fill = this.fill();

		const border = this.surfaceBorder();

		const hairline = border
			? `${border.width}px solid ${border.color}`
			: "0";

		if (this.style.getPropertyValue("--jelly-flat-fill") !== fill) {
			this.style.setProperty("--jelly-flat-fill", fill);
		}

		if (this.style.getPropertyValue("--jelly-flat-border") !== hairline) {
			this.style.setProperty("--jelly-flat-border", hairline);
		}
	}

	/*
	 * Rebuild the membrane in place after a shape attribute change (e.g. a
	 * radius swap) that doesn't resize the box - applyShape would early-return
	 * since the canvas pixel size is unchanged, so reshape the body directly.
	 */
	reshapeMembrane(): void {
		if (!this.built || !this.body) {
			return;
		}

		const box = this.jellyBox();

		if (box.width < 1 || box.height < 1) {
			return;
		}

		const next = this.shape(box.width, box.height);

		this.body.resize(next.width, next.height, next.radius);

		this.requestFrame();
	}

	/* ---- Rendering --------------------------------------------------- */

	// Wipe the canvas for the next paint
	clearCanvas(): void {
		this.ctx.clearRect(0, 0, this.cssW, this.cssH);
	}

	/*
	 * Paint one body centered in the canvas (with optional pixel offset).
	 * Flat solid fill - no gradients or shading.
	 */
	paintBody(body: JellyBody, options: PaintOptions = {}): void {
		const {
			fill = this.fill(),

			cx = 0,

			cy = 0,

			alpha = 1,

			ctx = this.ctx,

			cssW = this.cssW,

			cssH = this.cssH,

			ring = null,

			scaleX = 1,

			scaleY = 1,

			border = null,

			// Optional per-point post-projection deform (x, y, z) → (x, y, z).
			// Used for effects the physics shouldn't carry, e.g. tapering a
			// slider thumb's tail.
			warp = null,

			// Crossfade the fill toward its target instead of snapping (so variant /
			// state changes ease). Components that paint more than one body per frame
			// pass a distinct easeKey per body so their colours don't share a track.
			ease = true,

			easeKey = "body",
		} = options;

		// Ease the surface colour; ring / border stay exact (structural)
		const surface = ease
			? this.easeColor(easeKey, fill, this.frameDt || 0)
			: fill;

		const centerX = cssW / 2 + cx;

		const centerY = cssH / 2 + cy;

		const project: (point: SurfacePoint) => SurfacePoint = warp
			? (point) => warp(body.projectPoint(point))
			: (point) => body.projectPoint(point);

		ctx.save();

		ctx.globalAlpha = alpha;

		ctx.translate(centerX, centerY);

		ctx.rotate(body.state.rotateZ);

		if (scaleX !== 1 || scaleY !== 1) {
			ctx.scale(scaleX, scaleY);
		}

		// Focus ring: the same deformed surface pushed outward, so it jiggles too
		if (ring) {
			const ringPoints = body
				.getSurfacePoints(ring.gap + ring.width / 2)
				.map(project);

			traceSmoothPath(ctx, ringPoints, undefined, body.radius <= 0);

			ctx.lineWidth = ring.width;

			ctx.strokeStyle = ring.color;

			ctx.lineJoin = body.radius <= 0 ? "miter" : "round";

			ctx.stroke();
		}

		const points = body.getSurfacePoints().map(project);

		traceSmoothPath(ctx, points, undefined, body.radius <= 0);

		ctx.fillStyle = surface;

		ctx.fill();

		if (border) {
			traceSmoothPath(ctx, points, undefined, body.radius <= 0);

			ctx.lineWidth = border.width;

			ctx.strokeStyle = border.color;

			ctx.lineJoin = "round";

			ctx.stroke();
		}

		ctx.restore();
	}

	// The standard frame: advance physics, repaint, sleep when at rest
	defaultFrame(dt: number): boolean {
		const body = this.body;

		if (!body) {
			// A CSS-painted surface still tracks theme and attribute changes;
			// it just has no texture to repaint.
			if (this.flat) {
				this.syncFlatSurface();
			}

			return false;
		}

		body.update(dt);

		this.clearCanvas();

		this.paintBody(body, {
			ring: this.focusRing(),
			border: this.surfaceBorder(),
		});

		return !body.isResting();
	}

	// Border descriptor painted on the jelly surface, else null
	surfaceBorder(): Border | null {
		return null;
	}

	/* ---- Focus ring -------------------------------------------------- */

	// Ring descriptor when keyboard-focused, else null. Override as needed.
	// Width and gap resolve from --jelly-ring-width / --jelly-ring-gap so the
	// ring geometry is themeable, not only its color.
	focusRing(): Ring | null {
		if (!this.focusVisible) {
			return null;
		}

		const styles = getComputedStyle(this);

		const width =
			parseFloat(styles.getPropertyValue("--jelly-ring-width")) ||
			FOCUS_RING.width;

		const gap = parseFloat(styles.getPropertyValue("--jelly-ring-gap"));

		return {
			color: this.ringColor(),

			width,

			gap: Number.isFinite(gap) ? gap : FOCUS_RING.gap,
		};
	}

	// The focus ring color, softly blended toward transparent - it tracks the
	// component's own --jelly-ring (usually its fill hue) so the ring reads as
	// part of the control rather than a generic blue outline.
	ringColor(): string {
		const [r, g, b, a] = this.rgbaTuple(
			`var(--jelly-ring, var(--jelly-color-border-focus, ${PALETTE["border-focus"]}))`,
		);

		/* Canvas strokeStyle support for CSS Color 4's color(srgb … / .5)
       serialization is inconsistent. Emit legacy rgba() so the alpha cannot
       be rejected while CSS-rendered rings keep using color-mix(). */
		return this.colorString([r, g, b, a * FOCUS_RING.alpha], {
			forceAlpha: true,
		});
	}

	/*
	 * Ease a fill color toward its target so a variant / state change crossfades
	 * rather than snapping. Keyed so a component painting several bodies a frame
	 * eases each on its own track. Frame-rate independent; settles in ~0.3s and
	 * jumps straight to the target under reduced motion or on the first paint.
	 * Raises `colorEasing` (read by the engine) so the frame keeps running.
	 */
	easeColor(key: string, expr: string, dt: number): string {
		const target = this.rgbaTuple(expr);

		const current = this.eased[key];

		// First paint or reduced motion → adopt the target immediately
		if (!current || this.reducedMotion) {
			this.eased[key] = target;

			return this.colorString(target);
		}

		const settled =
			Math.abs(target[0] - current[0]) <= 0.4 &&
			Math.abs(target[1] - current[1]) <= 0.4 &&
			Math.abs(target[2] - current[2]) <= 0.4 &&
			Math.abs(target[3] - current[3]) <= 0.002;

		if (settled) {
			this.eased[key] = target;

			return this.colorString(target);
		}

		// Still crossfading: keep the frame alive (the engine reads this) and only
		// advance when time actually elapsed - the first frame after a park can
		// arrive with dt = 0, which must hold the colour, not snap it.
		this.colorEasing = true;

		if (dt > 0) {
			const k = 1 - Math.exp(-dt * 10);

			for (let i = 0; i < 4; i++) {
				current[i] += (target[i] - current[i]) * k;
			}
		}

		return this.colorString(current);
	}

	// Resolve a color expression to an [r, g, b, a] tuple. RGB channels use
	// 0-255; alpha uses 0-1. Keeping alpha here prevents short hex colors such
	// as #fff0 from becoming opaque as they pass through canvas animation.
	rgbaTuple(expr: string): RGBA {
		const resolved = this.resolveColor(String(expr));

		const match = resolved.match(/[\d.]+/g);

		if (!match) {
			return [0, 0, 0, 1];
		}

		const triple = match.slice(0, 3).map(Number);

		const alpha = Math.max(0, Math.min(1, Number(match[3] ?? 1)));

		const rgb = resolved.startsWith("color(")
			? triple.map((channel) => Math.round(channel * 255))
			: triple;

		return [rgb[0], rgb[1], rgb[2], alpha];
	}

	// Backward-compatible RGB-only view for calculations that do not need alpha
	rgbTriple(expr: string): number[] {
		return this.rgbaTuple(expr).slice(0, 3);
	}

	// Serialize a tuple to a canvas-safe legacy color. Keep opaque colors as
	// rgb() for compactness; rgba() is required whenever transparency matters.
	colorString(
		[r, g, b, a = 1]: number[],

		{ forceAlpha = false }: { forceAlpha?: boolean } = {},
	): string {
		const red = Math.round(r);

		const green = Math.round(g);

		const blue = Math.round(b);

		const alpha = Math.max(0, Math.min(1, a));

		if (!forceAlpha && alpha >= 0.9995) {
			return `rgb(${red}, ${green}, ${blue})`;
		}

		return `rgba(${red}, ${green}, ${blue}, ${Number(alpha.toFixed(4))})`;
	}

	// Blend two live CSS color expressions. Shared by controls that animate
	// between semantic off/on colors, including their alpha channels.
	mixColor(from: string, to: string, amount: number): string {
		const start = this.rgbaTuple(from);

		const end = this.rgbaTuple(to);

		const t = Math.max(0, Math.min(1, amount));

		const mixed = start.map(
			(channel, index) => channel + (end[index] - channel) * t,
		);

		return this.colorString(mixed);
	}

	// Resolve a CSS color expression (var(), color-mix(), …) to a concrete sRGB
	// color. The token values are oklch(), and getComputedStyle preserves oklch()
	// in modern browsers - so we wrap the expression in color-mix(in srgb, …) to
	// force the computed value into sRGB (color(srgb …) / rgb()). rgbaTuple reads
	// the channels numerically and would misread a raw oklch triple as RGB.
	resolveColor(expr: string): string {
		if (!this.probe) {
			this.probe = document.createElement("span");

			this.probe.setAttribute("aria-hidden", "true");

			this.probe.style.cssText =
				"position:absolute;width:0;height:0;visibility:hidden;pointer-events:none";

			this.shadowRoot!.appendChild(this.probe);
		}

		this.probe.style.color = `color-mix(in srgb, ${expr} 100%, transparent)`;

		return getComputedStyle(this.probe).color;
	}

	// Track keyboard-focus (:focus-visible) on an inner control for the ring
	trackFocus(el: HTMLElement): void {
		el.addEventListener("focus", () => {
			this.focusVisible =
				el.matches(":focus-visible") || this.matches(":focus-visible");

			this.requestFrame();
		});

		el.addEventListener("blur", () => {
			this.focusVisible = false;

			this.requestFrame();
		});
	}

	// Route host.focus() into an inner shadow control
	useHostFocusTarget(el: HTMLElement | null): void {
		if (!el) {
			return;
		}

		this.hostFocusTarget = el;

		this.syncHostFocusTarget();

		if (!this.hostFocusHandler) {
			this.hostFocusHandler = (event: FocusEvent): void => {
				/* Focus events crossing a shadow boundary are retargeted to the host.
           If an inner control already owns focus, leave it there; otherwise a
           second tabbable control (for example a chip's remove button) gets
           bounced back to the primary control. */
				if (
					event.target !== this ||
					!this.hostFocusTarget ||
					this.shadowRoot?.activeElement
				) {
					return;
				}

				this.hostFocusTarget.focus({ preventScroll: true });
			};

			this.addEventListener("focus", this.hostFocusHandler);
		}
	}

	// Keep the inner focus target's tab order in sync with disabled state
	syncHostFocusTarget(): void {
		if (!this.hostFocusTarget) {
			return;
		}

		this.hostFocusTarget.tabIndex = this.hasAttribute("disabled") ? -1 : 0;

		this.removeAttribute("tabindex");
	}

	/* ---- Interaction helpers ----------------------------------------- */

	// Ask the shared engine for animation frames until the body rests
	requestFrame(): void {
		// A parked element has no box to paint: waking it would put a component
		// with a 0x0 host back into the loop, which is the state parking exists
		// to prevent. The ResizeObserver un-parks and asks again.
		if (this.parked) {
			return;
		}

		engine.wake(this);
	}

	// Convert client coords into the body's local (shape-centered) frame
	toLocal(
		clientX: number,

		clientY: number,

		body: JellyBody | null = this.body,
	): { x: number; y: number } {
		const box = this.jellyBox();

		// Divide out ancestor CSS scale the same way jellyBox does, so a press
		// inside a transformed ancestor (a dialog mid-pop) still lands where the
		// finger is instead of drifting toward the center
		const hostRect = this.getBoundingClientRect();

		const sx = this.offsetWidth > 0 ? hostRect.width / this.offsetWidth : 1;

		const sy =
			this.offsetHeight > 0 ? hostRect.height / this.offsetHeight : 1;

		const dx = (clientX - box.screenX) / (sx > 0.001 ? sx : 1);

		const dy = (clientY - box.screenY) / (sy > 0.001 ? sy : 1);

		const a = -(body ? body.state.rotateZ : 0);

		const cos = Math.cos(a);

		const sin = Math.sin(a);

		return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
	}

	// Press the jelly at a screen coordinate
	pressAt(clientX: number, clientY: number, strength = 1.12): void {
		if (this.reducedMotion) {
			return;
		}

		// A press is evidence of a box too: rebuild a membrane that a zero-box
		// measurement dropped, so the dent lands on the same event instead of
		// waiting for the next ResizeObserver tick.
		if (!this.ensureMembrane()) {
			return;
		}

		const local = this.toLocal(clientX, clientY);

		this.body!.pressAtLocal(local.x, local.y, strength);

		this.requestFrame();
	}

	// Drag the held press to a new screen coordinate
	moveAt(clientX: number, clientY: number): void {
		if (this.reducedMotion || !this.body) {
			return;
		}

		const local = this.toLocal(clientX, clientY);

		this.body.moveToLocal(local.x, local.y);

		this.requestFrame();
	}

	// Release the held press and let the body settle
	releaseBody(): void {
		if (!this.body) {
			return;
		}

		this.body.release();

		this.requestFrame();
	}

	// Sustained center squish (keyboard press-and-hold)
	centerPulse(strength = 1): void {
		if (this.reducedMotion || !this.body) {
			return;
		}

		this.body.centerPulse(strength);

		this.requestFrame();
	}

	// One-shot center squish that settles on its own (focus, toggle, grab)
	centerPop(strength = 1): void {
		if (this.reducedMotion || !this.body) {
			return;
		}

		this.body.centerPop(strength);

		this.requestFrame();
	}

	/*
	 * Wire the standard press feel onto an inner control: pointer presses
	 * dent the jelly under the finger and follow it, Enter / Space squish
	 * from the center and everything releases cleanly - including pointer
	 * capture loss and blur mid-press. Handles one pointer at a time; extra
	 * touches are ignored rather than fighting over the membrane.
	 */
	wirePress(
		element: HTMLElement,

		{
			keyboard = true,
			disabled = () => this.hasAttribute("disabled"),
		}: WirePressOptions = {},
	): void {
		this.pressPointerId = null;

		element.addEventListener("pointerdown", (event) => {
			if (disabled() || this.pressPointerId !== null) {
				return;
			}

			this.pressPointerId = event.pointerId;

			try {
				element.setPointerCapture(event.pointerId);
			} catch {
				// Capture can fail if the pointer is already gone; the press still works
			}

			this.pressAt(event.clientX, event.clientY);

			triggerHaptic();
		});

		element.addEventListener("pointermove", (event) => {
			if (event.pointerId === this.pressPointerId) {
				this.moveAt(event.clientX, event.clientY);
			}
		});

		const endPress = (event: PointerEvent): void => {
			if (event.pointerId !== this.pressPointerId) {
				return;
			}

			this.pressPointerId = null;

			this.releaseBody();
		};

		element.addEventListener("pointerup", endPress);

		element.addEventListener("pointercancel", endPress);

		element.addEventListener("lostpointercapture", endPress);

		if (!keyboard) {
			return;
		}

		element.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") {
				return;
			}

			if (this.keyboardActive || event.repeat || disabled()) {
				return;
			}

			this.keyboardActive = true;

			// pressAt() uses 1.12 by default; match that strength so keyboard and a
			// pointer pressed at the exact center share the same deformation.
			this.centerPulse(1.12);

			triggerHaptic();
		});

		element.addEventListener("keyup", (event) => {
			if (event.key !== "Enter" && event.key !== " ") {
				return;
			}

			this.keyboardActive = false;

			this.releaseBody();
		});

		element.addEventListener("blur", () => {
			this.keyboardActive = false;

			this.pressPointerId = null;

			this.releaseBody();
		});
	}

	/* ---- Hover (continuous noise-driven membrane force, independent) ---- */

	// Hover frame-loop state - completely independent of press/click so a
	// click adds its own force on top instead of overriding the hover;
	// when the click releases, the hover energy is still there.
	_hoverRafId = 0;

	_hoverPointerX = 0;

	_hoverPointerY = 0;

	_hoverElIndex = 0;

	/**
	 * Start the per-frame hover loop. Called on pointerenter, and again from
	 * pointermove / the scroll repair when a chain has retired itself.
	 * `elIndex` gives each element a unique noise seed so they don't
	 * pulse in lockstep.
	 */
	startHoverLoop(elIndex: number = this.hoverSeed): void {
		/*
		 * The two cases that are genuinely impossible to animate: a chain is
		 * already running (a second one would double the force on the same
		 * membrane), or the reader asked for stillness. Reduced motion is read
		 * live here rather than at wiring time, so flipping the preference on
		 * after the page loaded does not leave an element permanently deaf.
		 */
		if (this._hoverRafId !== 0 || this.reducedMotion) return;

		/*
		 * A parked element - or one whose body was released - cannot be hovered
		 * until it is rebuilt. The old guard simply returned here, which made
		 * every later pointerenter a no-op for any control that had once
		 * measured 0x0 (first paint, hydration, a font swap, a collapsed
		 * parent): nothing un-parked it, because the only documented wake was
		 * the ResizeObserver, and the pointer is not the ResizeObserver.
		 *
		 * The pointer *is* proof of a box - a control can only be entered if it
		 * is on screen - so this is the right moment to rebuild. It is the same
		 * rebuild the press path runs, and it happens on this event, not on a
		 * later frame.
		 */
		if (!this.ensureMembrane()) return;

		/*
		 * A surface past the hover budget cannot be repainted at 60fps. The
		 * budget is the painted area, not the window: see HOVER_AREA_BUDGET.
		 */
		if (this.cssW * this.cssH > JellyElement.HOVER_AREA_BUDGET) return;

		this._hoverElIndex = elIndex;

		/*
		 * The first response is immediate: write the force and wake the engine
		 * now, on the same event, so the bulge is in the next paint. The old
		 * order waited for the hover chain's own frame before the engine was
		 * ever woken - two frames between the pointer arriving and the surface
		 * moving, which is the difference between "jelly" and "delayed".
		 */
		this._applyHoverForce(performance.now());

		this.requestFrame();

		this._hoverRafId = requestAnimationFrame(this._hoverFrame);
	}

	/**
	 * Stop the hover loop and let residual energy dissipate naturally.
	 */
	stopHoverLoop(): void {
		if (this._hoverRafId !== 0) {
			cancelAnimationFrame(this._hoverRafId);

			this._hoverRafId = 0;
		}

		/*
		 * Don't zero hoverForce instantly - let the membrane settle through
		 * its natural damping, which reads as a smooth exhale. Dropping the
		 * force is what *starts* that settle; the body's own springs finish it.
		 *
		 * This runs even when the chain had already retired itself, so leaving
		 * the control can never leave a force behind to freeze the membrane
		 * mid-deformation.
		 */
		if (this.body && this.body.state.hoverForce !== 0) {
			this.body.state.hoverForce = 0;

			this.requestFrame();
		}
	}

	/**
	 * Wire the pointer's half of the membrane onto this host. One helper for
	 * every surface that wobbles, so the response cannot differ between a
	 * button and a card:
	 *
	 * - `pointerenter` starts the loop and un-parks a control that a zero-box
	 *   measurement had dropped (see `startHoverLoop`);
	 * - `pointermove` keeps the pointer position fresh and restarts a loop that
	 *   retired itself - a surface that appears under a resting pointer, or one
	 *   whose loop parked at the edge, is picked up by the next movement
	 *   instead of needing a click on the parent;
	 * - `pointerleave` / `pointercancel` settle the membrane instead of
	 *   freezing it;
	 * - touch never starts a hover. A tap is a press, and the press dent is
	 *   what a finger should get; a noise loop started by a tap leaves the
	 *   surface vibrating after the finger is gone.
	 *
	 * No build-time reduced-motion branch: the preference is checked live in
	 * startHoverLoop.
	 */
	wireHover({
		disabled = (): boolean => this.hasAttribute("disabled"),
	}: { disabled?: () => boolean } = {}): void {
		this._hoverWired = true;

		this._hoverDisabled = disabled;

		this.addEventListener("pointerenter", (event: PointerEvent) => {
			if (event.pointerType === "touch" || disabled()) {
				return;
			}

			this.updateHoverPointer(event.clientX, event.clientY);

			this.startHoverLoop();
		});

		this.addEventListener("pointermove", (event: PointerEvent) => {
			if (event.pointerType === "touch") {
				return;
			}

			this.updateHoverPointer(event.clientX, event.clientY);

			// Still on the control, but no chain is running: restart it. This
			// is the dead zone repair - the pointer never left, so no
			// pointerenter is coming. Gated on the membrane's own box so a
			// pointer travelling over a switch's label (outside its track)
			// does not wake the engine once per move for a bulge it cannot
			// feel.
			if (this._hoverRafId === 0 && !disabled() && this._hoverInside()) {
				this.startHoverLoop();
			}
		});

		this.addEventListener("pointerleave", () => this.stopHoverLoop());

		this.addEventListener("pointercancel", () => this.stopHoverLoop());
	}

	/**
	 * Restart the hover chain for a pointer that is already on the control but
	 * never moved: a scroll can bring a surface under a resting cursor, and
	 * neither pointerenter nor pointermove fires for that. Called by the shared
	 * scroll repair below; a no-op unless `wireHover` wired this element.
	 */
	resumeHover(): void {
		if (
			!this._hoverWired ||
			this._hoverDisabled() ||
			this._hoverRafId !== 0
		) {
			return;
		}

		this.startHoverLoop();
	}

	/** Update the pointer position for the hover membrane force. */
	updateHoverPointer(clientX: number, clientY: number): void {
		this._hoverPointerX = clientX;

		this._hoverPointerY = clientY;
	}

	/**
	 * Write one frame of hover force into the membrane. Samples multi-channel
	 * simplex noise (matching the website's Staccato Phase/Color/Morph pattern)
	 * and applies the result through JellyState.hoverForce, which updateMembrane
	 * reads independently of the press/click hold state.
	 */
	_applyHoverForce(now: number): void {
		const body = this.body;

		if (!body) {
			return;
		}

		// Update pointer-local position for the membrane influence
		const local = this.toLocal(this._hoverPointerX, this._hoverPointerY);

		body.state.pointerLocalX = local.x;

		body.state.pointerLocalY = local.y;

		// ── Multi-channel noise (Staccato pattern) ──
		const i = this._hoverElIndex;

		// Faster than Staccato's 0.0001 - hover needs visible variation
		// within a second, not ~8 seconds.  0.0005 gives ~2s cycles.
		const s = 0.0005;

		// Force channel: drives the membrane bulge amplitude (6 levels)
		const rawForce = jellyNoise(now * s, i * 101);

		const force = jellyQuantize(rawForce, 6);

		// Map from quantized [-1, 1] → [0.75, 1.0] - always pronounced
		const fMapped = 0.75 + ((force + 1) / 2) * 0.25;

		// Morph channel: spreads or tightens the bulge (5 levels)
		const rawMorph = jellyNoise(now * s * 0.25, i * 307);

		const morph = jellyQuantize(rawMorph, 5);

		const morphM = 0.8 + ((morph + 1) / 2) * 0.4; // [0.8, 1.2]

		// Combine channels into hoverForce.
		// updateMembrane multiplies by insideLocalHoldBulgeForce * 24.
		body.state.hoverForce = fMapped * morphM;
	}

	/**
	 * True while the pointer is over the measured jelly box. One pixel of
	 * grace on every edge: a pointer that enters exactly on the hairline is
	 * inside the control, and the old test compared against the physics body's
	 * size with no margin - so an edge entry could park the loop on its very
	 * first frame, which is the "it only registers sometimes" report.
	 */
	_hoverInside(): boolean {
		const local = this.toLocal(this._hoverPointerX, this._hoverPointerY);

		const box = this.jellyBox();

		return (
			Math.abs(local.x) <= box.width / 2 + 1 &&
			Math.abs(local.y) <= box.height / 2 + 1
		);
	}

	/**
	 * One frame of the hover loop.
	 */
	_hoverFrame = (): void => {
		if (!this._hoverRafId) return;

		/*
		 * No body, or a host with no box: stop for good rather than merely
		 * returning. `_hoverRafId` doubles as "a chain is running", and
		 * startHoverLoop refuses to start a second one while it is non-zero -
		 * so leaving it set here would retire this element's hover for the rest
		 * of the session, which is exactly the "the button no longer has its
		 * hover" half of the copy-button report. The next pointermove restarts
		 * it, and startHoverLoop rebuilds the membrane it is missing.
		 */
		if (this.parked || !this.body) {
			this._hoverRafId = 0;

			return;
		}

		this._applyHoverForce(performance.now());

		this.requestFrame();

		/*
		 * Park when the membrane is at rest, the rule `defaultFrame` already
		 * applies. This loop used to reschedule unconditionally, so a pointer
		 * merely resting on a surface kept its whole texture repainting at
		 * 60fps for as long as it stayed there.
		 *
		 * Only park when the pointer is outside the shape. Inside it, the
		 * force just written will move the membrane on the engine's next
		 * frame - the body is momentarily "at rest" only because the physics
		 * has not stepped since the force was set, and parking here would
		 * kill the wobble after a single frame. Outside it the gaussian
		 * influence is nil and the body really has settled.
		 *
		 * The force is dropped before parking: leaving it set would keep the
		 * engine's own frame alive against a constant bulge, which is the
		 * same spin under a different owner.
		 */
		if (!this._hoverInside() && this.body.isResting()) {
			this.body.state.hoverForce = 0;

			this._hoverRafId = 0;

			return;
		}

		this._hoverRafId = requestAnimationFrame(this._hoverFrame);
	};
}

/*
 * Flipping the document's reading direction reflows every control the same
 * way a theme flip recolors them: internal boxes move without the host
 * resizing. Watch dir on <html> and <body> and reuse the theme-change
 * signal so live canvases reposition and repaint themselves.
 */
if (typeof document !== "undefined" && typeof MutationObserver === "function") {
	const directionObserver = new MutationObserver(() => notifyThemeChange());

	directionObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["dir"],
	});

	if (document.body) {
		directionObserver.observe(document.body, {
			attributes: true,
			attributeFilter: ["dir"],
		});
	}
}

/*
 * A scroll moves a control under a pointer that never moves: no pointerenter
 * and no pointermove fires, so a surface scrolled into place under a resting
 * cursor stayed dead until the mouse was jiggled. One shared pair of listeners
 * repairs that for every wired element - never one pair per element - by
 * remembering where the pointer is and hit-testing once per scroll.
 */
if (
	typeof document !== "undefined" &&
	typeof document.elementFromPoint === "function"
) {
	let pointerX = 0;

	let pointerY = 0;

	let pointerLive = false;

	window.addEventListener(
		"pointermove",
		(event: PointerEvent) => {
			pointerLive = event.pointerType !== "touch";

			pointerX = event.clientX;

			pointerY = event.clientY;
		},
		{ passive: true, capture: true },
	);

	// A finger is not a hover: the last touch ends the pointer's hover rights
	// until a real pointer moves again.
	window.addEventListener(
		"pointerdown",
		(event: PointerEvent) => {
			if (event.pointerType === "touch") {
				pointerLive = false;
			}
		},
		{ passive: true, capture: true },
	);

	window.addEventListener(
		"scroll",
		() => {
			if (!pointerLive) {
				return;
			}

			let node = document.elementFromPoint(
				pointerX,
				pointerY,
			) as Element | null;

			while (node) {
				if (node instanceof JellyElement) {
					node.resumeHover();

					return;
				}

				const root = node.getRootNode();

				node =
					node.parentElement ??
					(root instanceof ShadowRoot ? root.host : null);
			}
		},
		{ passive: true, capture: true },
	);
}
