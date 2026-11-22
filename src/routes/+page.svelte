<script>
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { formatSqft } from '$lib/format.js';
	import 'leaflet/dist/leaflet.css';
	import './styles.css';

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
