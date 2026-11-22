<script>
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { formatSqft } from '$lib/format.js';
	import 'leaflet/dist/leaflet.css';

	let { data } = $props();

	let mapEl;
	let map;
	let markerLayer;
	let L;

	const money = (n) => (n ? '$' + Number(n).toLocaleString('en-CA') : '—');
	const ago = (iso) => {
		if (!iso) return 'never';
		const h = Math.round((Date.now() - new Date(iso).getTime()) / 36e5);
		return h < 1 ? 'just now' : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
	};
	const noteClass = (n) => (n.startsWith('✓') ? 'good' : n.startsWith('✗') ? 'bad' : n.startsWith('~') ? 'meh' : 'unknown');

	function drawMarkers() {
		if (!map || !L) return;
		markerLayer.clearLayers();
		for (const l of data.listings) {
			if (l.lat == null) continue;
			L.circleMarker([l.lat, l.lng], {
				radius: 7,
				weight: 2,
				color: l.passes_filters ? '#0a7d3b' : '#999',
				fillOpacity: l.passes_filters ? 0.8 : 0.3
			})
				.bindPopup(
					`<b>${l.address ?? ''}</b><br>${money(l.price)} · ${l.bedrooms_raw ?? l.bedrooms ?? '?'} bed` +
						(formatSqft(l.sqft_min, l.sqft_max) ? ` · ${formatSqft(l.sqft_min, l.sqft_max)}` : '') +
						` · score ${l.score}<br><a href="#l${l.id}">details</a>`
				)
				.addTo(markerLayer);
		}
	}

	onMount(async () => {
		L = (await import('leaflet')).default;
		map = L.map(mapEl, { scrollWheelZoom: false }).setView([43.745, -79.39], 12);
		L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
			maxZoom: 18,
			attribution: '© OpenStreetMap contributors'
		}).addTo(map);
		L.geoJSON(data.area, { style: { color: '#2563eb', weight: 2, fillOpacity: 0.05 } }).addTo(map);
		markerLayer = L.layerGroup().addTo(map);
		drawMarkers();
	});

	$effect(() => {
		data.listings; // redraw when the view changes
		drawMarkers();
	});
</script>

<main>
	<header>
		<h1>Happy Rental</h1>
		<p class="meta">
			{data.matchCount} active matches · ≤ {money(data.criteria.maxPrice)} · {data.criteria.minBedrooms}+ bed · last email processed {ago(data.lastRun)}
		</p>
		<nav>
			{#each data.views as v}
				<a href="?view={v}" class:active={v === data.view}>{v}</a>
			{/each}
		</nav>
	</header>

	<div class="map" bind:this={mapEl}></div>

	{#if !data.listings.length}
		<p class="empty">Nothing here yet. Listings appear after the next ingest run.</p>
	{/if}

	<section class="list">
		{#each data.listings as l (l.id)}
			<article id="l{l.id}" class:fail={!l.passes_filters}>
				<div class="top">
					<div>
						<h2>
							{#if l.url}<a href={l.url} target="_blank" rel="noopener">{l.address ?? l.url}</a>{:else}{l.address}{/if}
							{#if l.unit}<span class="unit">{l.unit}</span>{/if}
						</h2>
						<div class="facts">
							<b>{money(l.price)}</b>
							{#if l.previous_price && l.previous_price !== l.price}
								<s>{money(l.previous_price)}</s>
							{/if}
							· {l.bedrooms_raw ?? l.bedrooms ?? '?'} bed · {l.bathrooms ?? '?'} bath
							{#if formatSqft(l.sqft_min, l.sqft_max)}· {formatSqft(l.sqft_min, l.sqft_max)}{/if}
							{#if l.property_type}· {l.property_type}{/if}
							· seen on {l.sources.join(', ')} · {ago(l.first_seen)}
						</div>
					</div>
					<div class="score" title="Score">{l.score}</div>
				</div>

				<ul class="notes">
					{#each l.score_notes as n}<li class={noteClass(n)}>{n}</li>{/each}
				</ul>
				{#if l.summary}<p class="summary">{l.summary}</p>{/if}

				<div class="actions">
					<form method="POST" action="?/status" use:enhance>
						<input type="hidden" name="id" value={l.id} />
						{#each data.statuses as s}
							<button name="status" value={s} class:current={l.status === s}>{s}</button>
						{/each}
					</form>
					<form method="POST" action="?/note" use:enhance class="noteform">
						<input type="hidden" name="id" value={l.id} />
						<input name="notes" placeholder="Notes (asked about garage, viewing Tue…)" value={l.notes ?? ''} />
						<button>Save</button>
					</form>
				</div>
			</article>
		{/each}
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		font-family: system-ui, -apple-system, Segoe UI, sans-serif;
		background: #f6f7f9;
		color: #1a1a1a;
	}
	main {
		max-width: 960px;
		margin: 0 auto;
		padding: 16px;
	}
	h1 {
		margin: 0;
	}
	.meta {
		color: #555;
		margin: 4px 0 12px;
	}
	nav {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	nav a {
		padding: 4px 10px;
		border-radius: 999px;
		background: #e5e7eb;
		color: #333;
		text-decoration: none;
		font-size: 14px;
	}
	nav a.active {
		background: #2563eb;
		color: white;
	}
	.map {
		height: 360px;
		border-radius: 10px;
		margin: 16px 0;
		z-index: 0;
	}
	.empty {
		color: #666;
	}
	article {
		background: white;
		border-radius: 10px;
		padding: 14px 16px;
		margin-bottom: 12px;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
	}
	article.fail {
		opacity: 0.65;
	}
	.top {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	h2 {
		font-size: 17px;
		margin: 0 0 4px;
	}
	h2 a {
		color: inherit;
	}
	.unit {
		font-size: 13px;
		background: #eef2ff;
		color: #3730a3;
		padding: 1px 6px;
		border-radius: 4px;
		margin-left: 6px;
		font-weight: 500;
	}
	.facts {
		font-size: 14px;
		color: #444;
	}
	.score {
		font-size: 22px;
		font-weight: 700;
		color: #0a7d3b;
		min-width: 40px;
		text-align: right;
	}
	.notes {
		list-style: none;
		padding: 0;
		margin: 10px 0 0;
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.notes li {
		font-size: 13px;
		padding: 2px 8px;
		border-radius: 4px;
	}
	.good {
		background: #dcfce7;
		color: #166534;
	}
	.bad {
		background: #fee2e2;
		color: #991b1b;
	}
	.meh {
		background: #fef9c3;
		color: #854d0e;
	}
	.unknown {
		background: #f3f4f6;
		color: #555;
	}
	.summary {
		font-size: 14px;
		color: #555;
		margin: 8px 0 0;
	}
	.actions {
		margin-top: 10px;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
		justify-content: space-between;
	}
	.actions button {
		font-size: 12px;
		padding: 3px 8px;
		border: 1px solid #d1d5db;
		background: white;
		border-radius: 4px;
		cursor: pointer;
	}
	.actions button.current {
		background: #1f2937;
		color: white;
		border-color: #1f2937;
	}
	.noteform {
		display: flex;
		gap: 4px;
		flex: 1;
		min-width: 240px;
	}
	.noteform input {
		flex: 1;
		font-size: 13px;
		padding: 3px 6px;
		border: 1px solid #d1d5db;
		border-radius: 4px;
	}
</style>
