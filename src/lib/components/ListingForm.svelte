<script>
	// One form for both adding a listing and editing one, so the two always look the same.
	import { enhance } from '$app/forms';

	let {
		listing = null, // null when adding
		heading,
		submitLabel,
		onCancel,
		onDone // called with the action's result data after a successful save
	} = $props();

	const editing = $derived(!!listing);
	let error = $state(null);

	const TOGGLES = [
		['has_backyard', 'Backyard'],
		['has_garage', 'Garage'],
		['has_storage', 'Storage']
	];

	// Toggles: on = yes. When adding, off = not mentioned. When editing, a toggle you don't
	// touch leaves the field as it is; switching one off records a definite "no".
	// (snapshot of the listing when the form opens; the form is re-created each time)
	const initial = Object.fromEntries(TOGGLES.map(([name]) => [name, listing?.[name] === true]));
	let on = $state({ ...initial });
	const toggleValue = (name) => {
		if (!editing) return on[name] ? 'yes' : '';
		if (on[name] === initial[name]) return '';
		return on[name] ? 'yes' : 'no';
	};

	function focusAndSelect(node) {
		node.focus();
		node.select();
	}

	const submit = () => async ({ result, update }) => {
		if (result.type === 'failure') {
			error = result.data?.message ?? 'Could not save';
			return;
		}
		await update();
		error = null;
		onDone?.(result.data);
	};
</script>

<form method="POST" action={editing ? '?/edit' : '?/add'} use:enhance={submit} class="listing-form">
	<h2>{heading}</h2>
	{#if editing}<input type="hidden" name="id" value={listing.id} />{/if}

	<div class="form-grid">
		<label class="wide">
			<span>Address or title *</span>
			<input name="address" required maxlength="200" placeholder="79 McKee Avenue" value={listing?.address ?? ''} use:focusAndSelect />
		</label>
		<label>
			<span>Price / month</span>
			<input name="price" type="number" min="0" step="1" placeholder="3300" value={listing?.price ?? ''} />
		</label>
		<label>
			<span>Unit</span>
			<input name="unit" maxlength="40" placeholder="Main floor" value={listing?.unit ?? ''} />
		</label>
		<label>
			<span>Bedrooms</span>
			<input name="bedrooms" maxlength="10" placeholder="3 or 3+1" value={listing?.bedrooms_raw ?? ''} />
		</label>
		<label>
			<span>Bathrooms</span>
			<input name="bathrooms" type="number" min="0" step="0.5" placeholder="1" value={listing?.bathrooms ?? ''} />
		</label>
		<label>
			<span>Parking spaces</span>
			<input name="parking_spaces" type="number" min="0" step="1" placeholder="2" value={listing?.parking_spaces ?? ''} />
		</label>

		<div class="wide toggles">
			{#each TOGGLES as [name, label]}
				<button
					type="button"
					role="switch"
					class="toggle"
					aria-checked={on[name]}
					onclick={() => (on[name] = !on[name])}
				>
					<span class="track"><span class="thumb"></span></span>
					{label}
				</button>
				<input type="hidden" {name} value={toggleValue(name)} />
			{/each}
		</div>

		<label class="wide">
			<span>Summary</span>
			<textarea name="summary" rows="2" maxlength="500" placeholder="Bright main floor of a detached house, shared laundry, close to the subway…">{listing?.summary ?? ''}</textarea>
		</label>
		<label class="wide">
			<span>Link</span>
			<input name="url" type="url" maxlength="500" placeholder="https://…" value={listing?.url ?? ''} />
		</label>
		<label class="wide">
			<span>Notes</span>
			<input name="notes" maxlength="2000" placeholder="Saw it on Facebook, landlord is Maria…" value={listing?.notes ?? ''} />
		</label>
	</div>

	<div class="form-actions">
		<button type="submit">{submitLabel}</button>
		<button type="button" class="cancel" onclick={() => onCancel?.()}>Cancel</button>
		{#if error}<span class="form-error" role="alert">{error}</span>{/if}
	</div>
</form>
