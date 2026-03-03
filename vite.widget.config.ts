import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

/**
 * Builds a native embeddable widget (no iframe) as a single CDN-friendly script.
 * Output is written to: /static/widget/
 *
 * Usage on an external site:
 *   <script src="https://YOUR_DOMAIN/widget/schedule-widget.js" defer></script>
 *   <div data-schedule data-event="YOUR_EVENT_SLUG" data-base-url="https://YOUR_DOMAIN" data-lang="ar"></div>
 */
export default defineConfig({
	resolve: {
		alias: {
			$lib: path.resolve(__dirname, 'src/lib')
		}
	},
	plugins: [svelte()],
	build: {
		emptyOutDir: false,
		outDir: path.resolve(__dirname, 'static/widget'),
		lib: {
			entry: path.resolve(__dirname, 'src/widget/entry.ts'),
			name: 'ScheduleEmbed',
			formats: ['iife'],
			fileName: () => 'schedule-widget.js'
		},
		rollupOptions: {
			output: {
				inlineDynamicImports: true
			}
		}
	}
});
