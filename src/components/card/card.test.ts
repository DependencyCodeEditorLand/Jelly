import { expect, test } from "vitest";

import { mount, settle } from "../../testing/index.js";

import "./index.js";

import type { JellyCard } from "./index.js";

test("upgrades and renders its slotted content in a surface", async () => {
	const host = mount("<jelly-card><h3>Title</h3></jelly-card>");

	const el = host.querySelector("jelly-card") as JellyCard;

	await settle(3);

	expect(el.shadowRoot!.querySelector(".card")).toBeTruthy();

	expect(el.querySelector("h3")?.textContent).toBe("Title");

	host.remove();
});

test("squish cards become keyboard-activatable buttons", async () => {
	const host = mount("<jelly-card squish>Tap</jelly-card>");

	const el = host.querySelector("jelly-card") as JellyCard;

	await settle(3);

	const card = el.shadowRoot!.querySelector(".card") as HTMLElement;

	expect(card.getAttribute("role")).toBe("button");

	expect(card.getAttribute("tabindex")).toBe("0");

	let clicked = 0;

	el.addEventListener("click", () => {
		clicked += 1;
	});

	card.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);

	card.dispatchEvent(
		new KeyboardEvent("keyup", { key: "Enter", bubbles: true }),
	);

	expect(clicked).toBe(1);

	host.remove();
});

test("a flat card paints itself in CSS and allocates no canvas", async () => {
	const host = mount(
		'<jelly-card style="--jelly-radius: 0; --jelly-fill: rgb(1, 2, 3)">Flat</jelly-card>',
	);

	const el = host.querySelector("jelly-card") as JellyCard;

	await settle(4);

	const canvas = el.shadowRoot!.querySelector("canvas") as HTMLCanvasElement;

	expect(el.flat).toBe(true);

	expect(el.hasAttribute("data-jelly-flat")).toBe(true);

	expect(el.body).toBeNull();

	// The backing store is released, not merely hidden.
	expect(canvas.width).toBe(0);

	expect(canvas.height).toBe(0);

	expect(getComputedStyle(el).backgroundColor).toBe("rgb(1, 2, 3)");

	// With no body there is nothing to wobble, so hovering starts no loop.
	el.dispatchEvent(
		new PointerEvent("pointerenter", { clientX: 4, clientY: 4 }),
	);

	expect(el._hoverRafId).toBe(0);

	host.remove();
});

test("a rounded card keeps its canvas", async () => {
	const host = mount(
		'<jelly-card style="--jelly-radius: 12px">Round</jelly-card>',
	);

	const el = host.querySelector("jelly-card") as JellyCard;

	await settle(4);

	const canvas = el.shadowRoot!.querySelector("canvas") as HTMLCanvasElement;

	expect(el.flat).toBe(false);

	expect(el.hasAttribute("data-jelly-flat")).toBe(false);

	expect(el.body).toBeTruthy();

	expect(canvas.width).toBeGreaterThan(0);

	expect(canvas.height).toBeGreaterThan(0);

	host.remove();
});

test("a card past the texture limits falls back to CSS", async () => {
	const host = mount(
		'<jelly-card style="--jelly-radius: 12px; display: block; height: 9000px">Tall</jelly-card>',
	);

	const el = host.querySelector("jelly-card") as JellyCard;

	await settle(4);

	const canvas = el.shadowRoot!.querySelector("canvas") as HTMLCanvasElement;

	expect(el.flat).toBe(true);

	expect(el.body).toBeNull();

	expect(canvas.height).toBe(0);

	host.remove();
});

test("the hover loop refuses a host past the hover area budget", async () => {
	// Inside the texture limits, so this one really does have a canvas - but
	// past HOVER_AREA_BUDGET, which is a repaint budget, not a viewport test:
	// a tall card on a short window is still a control and must hover.
	const host = mount(
		'<jelly-card style="--jelly-radius: 12px; display: block; width: 2600px; height: 1800px">Huge</jelly-card>',
	);

	const el = host.querySelector("jelly-card") as JellyCard;

	await settle(4);

	expect(el.body).toBeTruthy();

	expect(el.cssW * el.cssH).toBeGreaterThan(4_000_000);

	el.dispatchEvent(
		new PointerEvent("pointerenter", { clientX: 10, clientY: 10 }),
	);

	expect(el._hoverRafId).toBe(0);

	host.remove();
});

test("a tall card on a short viewport still hovers", async () => {
	// Taller than the window, well inside the repaint budget: the pointer can
	// see it, so it must respond. This is the half of "hover does not register
	// every time" that the old `offsetHeight > window.innerHeight` rule caused.
	const host = mount(
		'<jelly-card style="--jelly-radius: 12px; display: block; width: 200px; height: 1200px">Tall</jelly-card>',
	);

	const el = host.querySelector("jelly-card") as JellyCard;

	await settle(4);

	expect(el.offsetHeight).toBeGreaterThan(window.innerHeight);

	el.dispatchEvent(
		new PointerEvent("pointerenter", { clientX: 10, clientY: 10 }),
	);

	expect(el._hoverRafId).not.toBe(0);

	el.dispatchEvent(new PointerEvent("pointerleave"));

	host.remove();
});

test("a parked control un-parks on the next pointerenter", async () => {
	// A control that measured 0x0 at connect (here: hidden) parks itself. The
	// park must not outlive the measurement: the pointer is proof of a box.
	const host = mount(
		'<jelly-card style="--jelly-radius: 12px; width: 200px; height: 120px; display: none">Hidden</jelly-card>',
	);

	const el = host.querySelector("jelly-card") as JellyCard;

	await settle(4);

	expect(el.parked).toBe(true);

	// Revealed without giving the ResizeObserver a frame to fire: the pointer
	// alone has to rebuild the membrane.
	el.style.display = "block";

	el.dispatchEvent(
		new PointerEvent("pointerenter", { clientX: 10, clientY: 10 }),
	);

	expect(el.parked).toBe(false);

	expect(el.body).toBeTruthy();

	expect(el._hoverRafId).not.toBe(0);

	host.remove();
});

test("the hover loop still runs on a control-sized card", async () => {
	const host = mount(
		'<jelly-card style="--jelly-radius: 12px; display: block; width: 200px; height: 120px">Small</jelly-card>',
	);

	const el = host.querySelector("jelly-card") as JellyCard;

	await settle(4);

	el.dispatchEvent(
		new PointerEvent("pointerenter", { clientX: 10, clientY: 10 }),
	);

	expect(el._hoverRafId).not.toBe(0);

	// The loop keeps itself alive while the pointer is over the surface: the
	// membrane is driven, so it is not at rest.
	await settle(5);

	expect(el._hoverRafId).not.toBe(0);

	expect(el.body!.state.hoverForce).toBeGreaterThan(0);

	el.dispatchEvent(new PointerEvent("pointerleave"));

	expect(el._hoverRafId).toBe(0);

	host.remove();
});

test("the hover loop parks once the pointer is outside the membrane", async () => {
	const host = mount(
		'<jelly-card style="--jelly-radius: 12px; display: block; width: 200px; height: 120px">Small</jelly-card>',
	);

	const el = host.querySelector("jelly-card") as JellyCard;

	await settle(4);

	// pointerenter, but nowhere near the shape: the gaussian influence is nil,
	// the membrane settles, and the loop must stop instead of rescheduling.
	el.dispatchEvent(
		new PointerEvent("pointerenter", { clientX: 5000, clientY: 5000 }),
	);

	// Long enough for the card's entry pop to settle as well: the loop parks
	// once the membrane is genuinely at rest, not before.
	await settle(150);

	expect(el._hoverRafId).toBe(0);

	expect(el.body!.state.hoverForce).toBe(0);

	host.remove();
});
