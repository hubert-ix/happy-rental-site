import { sendEmail } from './gmail.js';

const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function digestHtml(listings, dashboardUrl) {
	const rows = listings
		.map(
			(l) => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #eee;vertical-align:top">
          <div style="font-size:16px;font-weight:600">
            ${l.url ? `<a href="${esc(l.url)}">${esc(l.address || l.url)}</a>` : esc(l.address)}
            ${l.unit ? ` <span style="color:#666">(${esc(l.unit)})</span>` : ''}
          </div>
          <div style="margin:4px 0">
            <b>${l.price ? '$' + l.price.toLocaleString('en-CA') : 'price ?'}</b>
            · ${l.bedrooms_raw ?? l.bedrooms ?? '?'} bed · score ${l.score}
          </div>
          <div style="color:#444;font-size:13px">${esc(l.score_notes.join('  '))}</div>
          ${l.summary ? `<div style="color:#666;font-size:13px;margin-top:4px">${esc(l.summary)}</div>` : ''}
        </td>
      </tr>`
		)
		.join('');
	return `<div style="font-family:system-ui,sans-serif;max-width:640px">
    <h2 style="margin:0 0 8px">🏠 ${listings.length} new rental match${listings.length === 1 ? '' : 'es'}</h2>
    <table style="border-collapse:collapse;width:100%">${rows}</table>
    ${dashboardUrl ? `<p><a href="${esc(dashboardUrl)}">Open dashboard</a></p>` : ''}
  </div>`;
}

export async function notifyMatches(env, listings, dashboardUrl) {
	if (!listings.length) return;
	const top = listings[0];

	if (env.NOTIFY_EMAIL) {
		await sendEmail(env, {
			to: env.NOTIFY_EMAIL,
			subject: `🏠 ${listings.length} new match${listings.length === 1 ? '' : 'es'}: ${top.address ?? 'rental'} $${top.price ?? '?'}`,
			html: digestHtml(listings, dashboardUrl)
		});
	}

	if (env.NTFY_TOPIC) {
		await fetch(`https://ntfy.sh/${encodeURIComponent(env.NTFY_TOPIC)}`, {
			method: 'POST',
			headers: {
				Title: `${listings.length} new rental match${listings.length === 1 ? '' : 'es'}`,
				Tags: 'house',
				...(top.url ? { Click: top.url } : {})
			},
			body: listings
				.slice(0, 5)
				.map((l) => `${l.address ?? '?'} · $${l.price ?? '?'} · score ${l.score}`)
				.join('\n')
		});
	}
}
