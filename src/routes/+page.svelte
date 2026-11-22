<script>
	import { onMount, onDestroy } from 'svelte';
	import { enhance } from '$app/forms';
	import { Bed, Bath, Ruler, ExternalLink, MapPin, Check, X, Minus, CircleQuestionMark } from '@lucide/svelte';
	import { formatSqft } from '$lib/format.js';
	import { noteToTag, scoreTier } from '$lib/tags.js';
	import 'leaflet/dist/leaflet.css';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import './styles.css';

	let { data } = $props();

	let mapEl;
	let map;
	let markerLayer;
	let L;
	let resizeObserver;

	// selectedId: card picked by clicking its map dot (stays until you click elsewhere or press Esc)
	// hoveredId: card whose map dot the mouse is over right now
	let selectedId = $state(null);
	let hoveredId = $state(null);

	function selectListing(id) {
		selectedId = id;
		document.getElementById(`l${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	function onDocumentClick(e) {
		// Clicks on map dots are handled by the marker itself (see drawMarkers)
		if (e.target.closest?.('.leaflet-interactive')) return;
		if (selectedId !== null && !e.target.closest?.(`#l${selectedId}`)) selectedId = null;
	}

	function onDocumentKeydown(e) {
		if (e.key === 'Escape') selectedId = null;
	}

	const TIER_COLOURS = { high: '#2f9e74', mid: '#cdb52a', low: '#e0739a' };
	const TAG_ICONS = { good: Check, bad: X, meh: Minus, unknown: CircleQuestionMark };

	const money = (n) => (n ? '$' + Number(n).toLocaleString('en-CA') : '—');
	const ago = (iso) => {
		if (!iso) return 'never';
		const h = Math.round((Date.now() - new Date(iso).getTime()) / 36e5);
		return h < 1 ? 'just now' : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
	};
	// A listing that fails a hard filter never gets a green badge, whatever its feature score
	const tier = (l) => (l.passes_filters ? scoreTier(l.score, data.criteria.notifyMinScore) : 'low');
	const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

	function drawMarkers() {
		if (!map || !L) return;
		markerLayer.clearLayers();
		for (const l of data.listings) {
			if (l.lat == null) continue;
			const sqft = formatSqft(l.sqft_min, l.sqft_max);
			L.circleMarker([l.lat, l.lng], {
				radius: 8,
				weight: 2,
				color: '#fff',
				fillColor: TIER_COLOURS[tier(l)],
				fillOpacity: l.passes_filters ? 0.95 : 0.6
			})
				// Details on hover; a click jumps to the card and keeps it highlighted
				.bindTooltip(
					`<strong>${esc(l.address ?? '')}</strong><br>${money(l.price)}/mo · ${esc(l.bedrooms_raw ?? l.bedrooms ?? '?')} bed` +
						(sqft ? ` · ${sqft}` : '') +
						`<br><span class="tip-hint">Score ${l.score} · click to view</span>`,
					{ direction: 'top', offset: [0, -8], className: 'listing-tip' }
				)
				.on('mouseover', () => (hoveredId = l.id))
				.on('mouseout', () => (hoveredId = null))
				.on('click', () => selectListing(l.id))
				.addTo(markerLayer);
		}
	}

	onMount(async () => {
		L = (await import('leaflet')).default;
		map = L.map(mapEl, { scrollWheelZoom: false, zoomSnap: 0.25 });

		// Area outline and markers first, so they show even if the base map fails to load
		const area = L.geoJSON(data.area, {
			style: { color: '#2f2a3a', weight: 2, dashArray: '6 6', fillColor: '#b9adf0', fillOpacity: 0.18 }
		}).addTo(map);
		const fitArea = () => map.fitBounds(area.getBounds(), { padding: [16, 16] });
		fitArea();

		// Leaflet measures its box once, at creation. If the layout shifts afterwards (web fonts
		// loading, the page settling), tiles only fill part of the map. Re-measure on every size
		// change, and keep the area framed until the user pans or zooms themselves.
		let userMoved = false;
		for (const ev of ['mousedown', 'touchstart', 'wheel']) mapEl.addEventListener(ev, () => (userMoved = true), { once: true, passive: true });
		resizeObserver = new ResizeObserver(() => {
			map.invalidateSize();
			if (!userMoved) fitArea();
		});
		resizeObserver.observe(mapEl);

		markerLayer = L.layerGroup().addTo(map);
		drawMarkers();

		// OpenFreeMap "liberty": a clean, Google-like vector style. Free, no key, no usage limits.
		try {
			const [{ setWorkerUrl }, { default: workerUrl }, { maplibreGL }] = await Promise.all([
				import('maplibre-gl'),
				// MapLibre renders in a web worker; point it at the file Vite actually serves
				import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
				import('@maplibre/maplibre-gl-leaflet')
			]);
			setWorkerUrl(workerUrl);
			// Map credits (OpenFreeMap, OpenMapTiles, OpenStreetMap) come from the style itself
			maplibreGL({ style: 'https://tiles.openfreemap.org/styles/liberty' }).addTo(map);
			const area = L.geoJSON(data.area, {
				interactive: false, // decoration only: never block hovers/clicks on the markers
				style: { color: '#2f2a3a', weight: 2, dashArray: '6 6', fillColor: '#b9adf0', fillOpacity: 0.18 }
			}).addTo(map);
		} catch (err) {
			// e.g. WebGL unavailable: fall back to standard OpenStreetMap tiles
			console.warn('Vector map unavailable, using OSM tiles:', err);
			L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
				maxZoom: 19,
				attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
			}).addTo(map);
		}
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
		map?.remove();
	});

	$effect(() => {
		data.listings; // redraw when the view changes
		drawMarkers();
	});
</script>

<svelte:document onclick={onDocumentClick} onkeydown={onDocumentKeydown} />

<main class="dashboard">
	<header class="masthead">
		<h1>Happy Rental</h1>
		<p class="meta">
			<strong>{data.matchCount} active match{data.matchCount === 1 ? '' : 'es'}</strong>
			· up to {money(data.criteria.maxPrice)} · {data.criteria.minBedrooms}+ bed · last email processed {ago(data.lastRun)}
		</p>
		<nav class="tabs" aria-label="Filter listings">
			{#each data.views as v}
				<a href="?view={v}" class:active={v === data.view} aria-current={v === data.view ? 'page' : undefined}>{v}</a>
			{/each}
		</nav>
	</header>

	<div class="map" bind:this={mapEl}></div>

	{#if !data.listings.length}
		<div class="empty">
			<span class="empty-icon" aria-hidden="true">📭</span>
			<p><strong>Nothing here yet.</strong></p>
			<p>New listings show up after the next alert email is processed.</p>
		</div>
	{/if}

	<section class="list">
		{#each data.listings as l (l.id)}
			{@const sqft = formatSqft(l.sqft_min, l.sqft_max)}
			<article id="l{l.id}" class="card" class:fail={!l.passes_filters} class:selected={selectedId === l.id} class:hovered={hoveredId === l.id}>
				<div class="card-top">
					<div class="card-main">
						<h2>
							{#if l.url}
								<a href={l.url} target="_blank" rel="noopener">{l.address ?? 'Listing'}</a>
							{:else}
								{l.address ?? 'Listing'}
							{/if}
							{#if l.unit}<span class="unit">{l.unit}</span>{/if}
						</h2>

						<div class="facts">
							<span class="price">
								{money(l.price)}<small>/mo</small>
								{#if l.previous_price && l.previous_price !== l.price}
									<s>{money(l.previous_price)}</s>
								{/if}
							</span>
							<span class="fact"><Bed size={16} />{l.bedrooms_raw ?? l.bedrooms ?? '?'} bed</span>
							<span class="fact"><Bath size={16} />{l.bathrooms ?? '?'} bath</span>
							{#if sqft}<span class="fact"><Ruler size={16} />{sqft}</span>{/if}
							<span class="fact subtle">
								{#if l.url}
									<a href={l.url} target="_blank" rel="noopener"><ExternalLink size={14} />{l.sources.join(', ')}</a>
								{:else}
									{l.sources.join(', ')}
								{/if}
								· {ago(l.first_seen)}
							</span>
						</div>
					</div>

					<div class="score tier-{tier(l)}" title="Match score">
						<span class="score-value">{l.score}</span>
						<span class="score-label">score</span>
					</div>
				</div>

				{#if l.summary}<p class="summary">{l.summary}</p>{/if}

				<ul class="tags">
					{#each l.score_notes as note}
						{@const tag = noteToTag(note)}
						{@const Icon = tag.isPlace ? MapPin : TAG_ICONS[tag.kind]}
						<li class="tag {tag.kind}"><Icon size={13} />{tag.label}</li>
					{/each}
				</ul>

				<div class="card-actions">
					<form method="POST" action="?/status" use:enhance class="status">
						<input type="hidden" name="id" value={l.id} />
						{#each data.statuses as s}
							<button name="status" value={s} class:current={l.status === s} aria-pressed={l.status === s}>{s}</button>
						{/each}
					</form>
					<form method="POST" action="?/note" use:enhance class="note">
						<input type="hidden" name="id" value={l.id} />
						<input name="notes" aria-label="Notes" placeholder="Notes (asked about garage, viewing Tue…)" value={l.notes ?? ''} />
						<button>Save</button>
					</form>
				</div>
			</article>
		{/each}
	</section>
</main>
