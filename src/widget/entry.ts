import { mount, unmount } from 'svelte';
import CloudMeetWidget from './CloudMeetWidget.svelte';

// Embed styling: we ship Tailwind output + small utilities used by the widget.
// Using `?inline` keeps the widget CDN-friendly as a single JS file (no separate CSS asset).
// Vite will run PostCSS/Tailwind over this import during the widget build.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import widgetCss from '../app.css?inline';

/**
 * CDN embed entry (no iframe).
 *
 * Best-practice embed is a plain DIV mount point with data-attributes:
 *
 *   <div
 *     data-schedule
 *     data-event="YOUR_EVENT_SLUG"
 *     data-base-url="https://book.yourdomain.com"
 *     data-lang="en"
 *   ></div>
 *   <script src="https://book.yourdomain.com/widget/schedule-widget.js" defer></script>
 *
 * Notes for SPA builders (Webstudio, etc.):
 * - This script is SAFE to include on multiple pages.
 * - It uses a MutationObserver so it can mount when your page navigates client-side.
 */

type Mounted = { target: Element; unmount: () => void };

const SELECTOR = '[data-schedule]';

// WeakMap prevents leaks, but can't be iterated. Keep a Set for bulk teardown.
const mounted = new WeakMap<Element, Mounted>();
const mountedSet = new Set<Element>();

function ensureStyles() {
	if (typeof document === 'undefined') return;
	const id = 'schedule-embed-styles';
	if (document.getElementById(id)) return;
	const style = document.createElement('style');
	style.id = id;
	style.textContent = String(widgetCss || '');
	document.head.appendChild(style);
}

function getAttr(el: Element, name: string): string {
	return (el.getAttribute(name) ?? '').trim();
}

function propsFrom(el: Element) {
	// Support both data-* and legacy non-data attrs
	const event = getAttr(el, 'data-event') || getAttr(el, 'event');
	const baseUrl =
		getAttr(el, 'data-base-url') ||
		getAttr(el, 'base-url') ||
		getAttr(el, 'data-baseUrl');

	const lang = getAttr(el, 'data-lang') || getAttr(el, 'lang') || 'en';
	return { event, baseUrl, lang };
}

export function mountOne(el: Element) {
	if (mounted.has(el)) return;

	ensureStyles();

	const props = propsFrom(el);
	// If event isn't set yet, don't mount.
	if (!props.event) return;

	const instance = mount(CloudMeetWidget, {
		target: el as HTMLElement,
		props
	});

	mounted.set(el, {
		target: el,
		unmount: () => unmount(instance)
	});
	mountedSet.add(el);
}

export function mountAll(root: ParentNode = document) {
	const nodes = Array.from(root.querySelectorAll(SELECTOR));
	for (const el of nodes) mountOne(el);
}

export function unmountAll() {
	for (const el of Array.from(mountedSet.values())) {
		const rec = mounted.get(el);
		if (!rec) continue;
		try {
			rec.unmount();
		} catch {
			// ignore
		}
		mounted.delete(el);
		mountedSet.delete(el);
	}
}

declare global {
	// eslint-disable-next-line no-var
	var ScheduleEmbed: undefined | {
		__initialized?: boolean;
		mountAll: typeof mountAll;
		mountOne: typeof mountOne;
		unmountAll: typeof unmountAll;
	};
}

// Auto-mount on load (singleton).
if (typeof document !== 'undefined') {
	const w = window as any;

	// If the script is evaluated more than once (e.g. by a page builder),
	// don't create duplicate observers/listeners.
	if (w.ScheduleEmbed?.__initialized) {
		// Still do a best-effort scan in case new nodes exist.
		try {
			w.ScheduleEmbed.mountAll(document);
		} catch {
			// ignore
		}
	} else {
		const run = () => mountAll(document);
		// Run immediately if possible; otherwise after DOM is ready.
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', run);
		} else {
			run();
		}

		// Re-scan if host page injects nodes later (SPA navigation, CMS, etc.).
		const mo = new MutationObserver((muts) => {
			for (const m of muts) {
				for (const n of Array.from(m.addedNodes)) {
					if (!(n instanceof Element)) continue;
					if (n.matches?.(SELECTOR)) mountOne(n);
					mountAll(n);
				}
			}
		});
		mo.observe(document.documentElement, { childList: true, subtree: true });

		// Expose a tiny public API for advanced hosts.
		w.ScheduleEmbed = { __initialized: true, mountAll, mountOne, unmountAll };
	}
}
