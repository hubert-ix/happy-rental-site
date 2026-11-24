<script>
	import { onMount, onDestroy, tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { Bed, Bath, Ruler, ExternalLink, MapPin, Check, X, Minus, CircleQuestionMark, Pencil, Trash2, Plus, MapPinned, Map as MapIcon } from '@lucide/svelte';
	import { formatSqft } from '$lib/format.js';
	import ListingForm from '$lib/components/ListingForm.svelte';
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
	let userMoved = false; // once you pan/zoom (or jump to a listing), the map stops re-framing the area
	const markersById = new Map(); // listing id -> Leaflet marker, for "Go to map"

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
		if (e.key === 'Escape') {
			selectedId = null;
			editingScoreId = null;
			editingId = null;
			confirmDeleteId = null;
			adding = false;
		}
	}

	// "Add listing" form
	let adding = $state(false);
	let addMessage = $state(null);

	async function handleAdded({ id, isNew } = {}) {
		adding = false;
		addMessage = isNew ? null : 'That listing was already in your list, so it was updated with what you entered.';
		if (!id) return;
		// Show the new card; it may be filtered out of the current view (e.g. Matches)
		if (!document.getElementById(`l${id}`)) await goto('?view=all', { noScroll: true });
		await tick();
		selectListing(id);
	}

	// Note that just auto-saved, for a brief "Saved" confirmation
	let savedNoteId = $state(null);
	const afterNote = (id) => async ({ result, update }) => {
		await update({ reset: false });
		if (result.type !== 'success') return;
		savedNoteId = id;
		setTimeout(() => savedNoteId === id && (savedNoteId = null), 1800);
	};
	// Save the note when the field loses focus, if it changed
	function saveNoteOnBlur(e, l) {
		if (e.currentTarget.value.trim() !== (l.notes ?? '').trim()) e.currentTarget.form.requestSubmit();
	}

	// Listing waiting for its delete to be confirmed
	let confirmDeleteId = $state(null);

	// Listing whose title and price are being edited
	let editingId = $state(null);
	const isLocked = (l, field) => (l.locked_fields || []).includes(field);

	// Score you set by hand wins over the computed one
	let editingScoreId = $state(null);
	const scoreOf = (l) => l.score_override ?? l.score;
	const isManual = (l) => l.score_override !== null && l.score_override !== undefined;

	function focusAndSelect(node) {
		node.focus();
		node.select();
	}

	// Close the editor once the save/reset has gone through and the page data has refreshed
	const afterScoreSave = () => async ({ update }) => {
		await update();
		editingScoreId = null;
	};

	const TIER_COLOURS = { high: '#2f9e74', mid: '#cdb52a', low: '#e0739a' };
	const TAG_ICONS = { good: Check, bad: X, meh: Minus, unknown: CircleQuestionMark };

	const money = (n) => (n ? '$' + Number(n).toLocaleString('en-CA') : '—');
	const ago = (iso) => {
		if (!iso) return 'never';
		const h = Math.round((Date.now() - new Date(iso).getTime()) / 36e5);
		return h < 1 ? 'just now' : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
	};
	// A listing that fails a hard filter never gets a green badge, whatever its feature score
	// (a score you set yourself is always shown as you set it)
	const sourcesLabel = (l) => l.sources.map((s) => (s === 'manual' ? 'added by you' : s)).join(', ');
	const tier = (l) =>
		isManual(l) || l.passes_filters ? scoreTier(scoreOf(l), data.criteria.notifyMinScore) : 'low';
	const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

	function drawMarkers() {
		if (!map || !L) return;
		markerLayer.clearLayers();
		markersById.clear();
		for (const l of data.listings) {
			if (l.lat == null) continue;
			const sqft = formatSqft(l.sqft_min, l.sqft_max);
			const marker = L.circleMarker([l.lat, l.lng], {
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
						`<br><span class="tip-hint">Score ${scoreOf(l)}${isManual(l) ? ' (yours)' : ''} · click to view</span>`,
					{ direction: 'top', offset: [0, -8], className: 'listing-tip' }
				)
				.on('mouseover', () => (hoveredId = l.id))
				.on('mouseout', () => (hoveredId = null))
				.on('click', () => selectListing(l.id))
				.addTo(markerLayer);
			markersById.set(l.id, marker);
		}
	}

		// "Go to map": scroll up to the map, centre it on the listing (same zoom) and show its details
	function showOnMap(l) {
		const marker = markersById.get(l.id);
		if (!map || !marker) return;
		userMoved = true;
		mapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
		map.panTo([l.lat, l.lng], { animate: true, duration: 0.6 });
		marker.openTooltip();
		hoveredId = l.id;
		setTimeout(() => hoveredId === l.id && (hoveredId = null), 2500);
	}

	// "Show on Google Maps": search by address (Toronto added unless it's already there), or by coordinates
	function googleMapsUrl(l) {
		const query = l.address
			? /toronto|north york|ontario/i.test(l.address)
				? l.address
				: `${l.address}, Toronto, ON`
			: `${l.lat},${l.lng}`;
		return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
	}

	onMount(async () => {
		L = (await import('leaflet')).default;
		map = L.map(mapEl, { scrollWheelZoom: false, zoomSnap: 0.25 });

		// Area outline and markers first, so they show even if the base map fails to load
		const area = L.geoJSON(data.area, {
			interactive: false, // decoration only: never block hovers/clicks on the markers
			style: { color: '#2f2a3a', weight: 2, dashArray: '6 6', fillColor: '#b9adf0', fillOpacity: 0.18 }
		}).addTo(map);
		const fitArea = () => map.fitBounds(area.getBounds(), { padding: [16, 16] });
		fitArea();

		// Leaflet measures its box once, at creation. If the layout shifts afterwards (web fonts
		// loading, the page settling), tiles only fill part of the map. Re-measure on every size
		// change, and keep the area framed until the user pans or zooms themselves.
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
			// The base map goes in Leaflet's tile pane, underneath the area outline and markers
			maplibreGL({ style: 'https://tiles.openfreemap.org/styles/liberty' }).addTo(map);
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
		<div class="masthead-top">
			<h1>Happy Rental</h1>
			<button type="button" class="add-btn" onclick={() => ((adding = !adding), (addMessage = null))}>
				<Plus size={16} />Add listing
			</button>
		</div>
		<p class="meta">
			<strong>{data.matchCount} active match{data.matchCount === 1 ? '' : 'es'}</strong>
			· {money(data.criteria.minPrice)}–{money(data.criteria.maxPrice)} · {data.criteria.minBedrooms}+ bed · last email processed {ago(data.lastRun)}
		</p>
		<div class="toolbar">
			<nav class="tabs" aria-label="Filter listings">
				{#each data.views as v}
					<a href="?view={v}" class:active={v === data.view} aria-current={v === data.view ? 'page' : undefined}>{v}</a>
				{/each}
			</nav>
		</div>
	</header>

	<div class="map" bind:this={mapEl}></div>

	{#if addMessage}<p class="add-message" role="status">{addMessage}</p>{/if}

	{#if adding}
		<div class="card form-card">
			<ListingForm heading="Add a listing" submitLabel="Add listing" onCancel={() => (adding = false)} onDone={handleAdded} />
		</div>
	{/if}

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
				{#if editingId === l.id}
					<ListingForm listing={l} heading="Edit listing" submitLabel="Save changes" onCancel={() => (editingId = null)} onDone={() => (editingId = null)} />
				{:else}
					<div class="card-top">
						<div class="card-main">
							<h2>
								{#if l.url}
									<a href={l.url} target="_blank" rel="noopener">{l.address ?? 'Listing'}</a>
								{:else}
									{l.address ?? 'Listing'}
								{/if}
								<span class="title-icons">
									{#if l.lat != null && l.lng != null}
										<button type="button" class="title-icon" title="Show on the map above" aria-label="Show {l.address ?? 'listing'} on the map" onclick={() => showOnMap(l)}>
											<MapPinned size={17} />
										</button>
									{/if}
									{#if l.address || l.lat != null}
										<a class="title-icon" href={googleMapsUrl(l)} target="_blank" rel="noopener" title="Open in Google Maps" aria-label="Open {l.address ?? 'listing'} in Google Maps">
											<MapIcon size={17} />
										</a>
									{/if}
								</span>
								{#if (l.locked_fields || []).length && l.sources.some((s) => s !== 'manual')}
									<span class="edited" title="You edited this listing; new emails won't overwrite your changes">edited</span>
								{/if}
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
										<a href={l.url} target="_blank" rel="noopener"><ExternalLink size={14} />{sourcesLabel(l)}</a>
									{:else}
										{sourcesLabel(l)}
									{/if}
									· {ago(l.first_seen)}
								</span>
							</div>
						</div>

						{#if editingScoreId === l.id}
							<form method="POST" action="?/score" use:enhance={afterScoreSave} class="score-edit">
								<input type="hidden" name="id" value={l.id} />
								<input
									name="score"
									type="number"
									min="0"
									max="999"
									step="1"
									value={scoreOf(l)}
									aria-label="Your score for {l.address ?? 'this listing'}"
									use:focusAndSelect
								/>
								<div class="score-edit-actions">
									<button type="submit">Save</button>
									{#if isManual(l)}
										<button type="submit" name="reset" value="1" class="reset" title="Back to the computed score ({l.score})">
											Reset
										</button>
									{/if}
									<button type="button" class="cancel" onclick={() => (editingScoreId = null)}>Cancel</button>
								</div>
							</form>
						{:else}
							<button
								type="button"
								class="score tier-{tier(l)}"
								title={isManual(l) ? `Your score (computed: ${l.score}). Click to change` : 'Match score. Click to set your own'}
								onclick={() => (editingScoreId = l.id)}
							>
								<span class="score-value">{scoreOf(l)}</span>
								<span class="score-label">{isManual(l) ? 'yours' : 'score'}</span>
							</button>
						{/if}
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
							<!-- Saves as soon as you pick a status -->
							<select
								name="status"
								aria-label="Status"
								data-status={l.status}
								onchange={(e) => e.currentTarget.form.requestSubmit()}
							>
								{#each data.statuses as s}
									<option value={s} selected={l.status === s}>{s[0].toUpperCase() + s.slice(1)}</option>
								{/each}
							</select>
						</form>

						<form method="POST" action="?/note" use:enhance={() => afterNote(l.id)} class="note">
							<input type="hidden" name="id" value={l.id} />
							<!-- Saves when you click away (or press Enter) -->
							<input
								name="notes"
								aria-label="Notes"
								placeholder="Notes (asked about garage, viewing Tue…)"
								value={l.notes ?? ''}
								onblur={(e) => saveNoteOnBlur(e, l)}
							/>
							{#if savedNoteId === l.id}<span class="saved" role="status">Saved</span>{/if}
						</form>

						{#if confirmDeleteId === l.id}
							<form method="POST" action="?/delete" use:enhance class="confirm-delete">
								<input type="hidden" name="id" value={l.id} />
								<span>Delete?</span>
								<button type="submit" class="danger">Delete</button>
								<button type="button" class="cancel" onclick={() => (confirmDeleteId = null)}>Cancel</button>
							</form>
						{:else}
							<div class="icon-buttons">
								<button
									type="button"
									class="icon-btn"
									title="Edit listing"
									aria-label="Edit listing"
									onclick={() => (editingId = l.id)}
								>
									<Pencil size={16} />
								</button>
								<button
									type="button"
									class="icon-btn danger"
									title="Delete listing"
									aria-label="Delete listing"
									onclick={() => (confirmDeleteId = l.id)}
								>
									<Trash2 size={16} />
								</button>
							</div>
						{/if}
					</div>
				{/if}
			</article>
		{/each}
	</section>
</main>
