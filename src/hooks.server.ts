import type { Handle } from '@sveltejs/kit';

// Logical component: dev/preview SSR — replace `src/app.html` placeholder (not processed by Vite index transforms for Kit SSR).
const BUILD_YEAR_MARKER = '%BUILD_YEAR%';

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('text/html') || !response.body) {
    return response;
  }

  const body = await response.text();
  if (!body.includes(BUILD_YEAR_MARKER)) {
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  }

  const year = String(new Date().getFullYear());
  const next = body.split(BUILD_YEAR_MARKER).join(year);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(next, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
};
