/**
 * Runtime proxy for backend-served static files under /uploads/*.
 *
 * The backend mounts /uploads (StaticFiles) for locally-stored media — kiosk
 * selfies (kiosk_photos/<timelog>.jpg), receipt images, document-vault files.
 * Those paths are referenced as `/uploads/...` in the UI, but the web origin
 * only proxies /api/v1/* — so without this handler every such <img> 404s.
 *
 * Mirrors src/app/api/v1/[...path]/route.ts but targets ${BACKEND_URL}/uploads
 * and is read-only (GET/HEAD). BACKEND_URL is read at request time so dev/prod
 * environments aren't baked in.
 */
import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';
const PROXY_TIMEOUT_MS = 15_000;

async function proxyUpload(
  request: NextRequest,
  params: { path: string[] },
): Promise<NextResponse> {
  const path = params.path.map(encodeURIComponent).join('/');
  const targetUrl = `${BACKEND_URL}/uploads/${path}`;

  const forwardHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'host') forwardHeaders.set(key, value);
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  try {
    const backendResponse = await fetch(targetUrl, {
      method: request.method,
      headers: forwardHeaders,
      signal: controller.signal,
    });

    const responseHeaders = new Headers();
    backendResponse.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (['content-encoding', 'transfer-encoding'].includes(lower)) return;
      responseHeaders.append(key, value);
    });

    const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
    const responseBody = NULL_BODY_STATUSES.has(backendResponse.status)
      ? null
      : await backendResponse.arrayBuffer();

    return new NextResponse(responseBody, {
      status: backendResponse.status,
      headers: responseHeaders,
    });
  } catch (error) {
    const isAbort = (error as Error)?.name === 'AbortError';
    console.error(`[Uploads proxy] ${isAbort ? 'Timed out' : 'Failed'} for ${targetUrl}:`, error);
    return NextResponse.json({ detail: 'Upload unavailable.' }, { status: isAbort ? 504 : 503 });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxyUpload(request, await params);
}

export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  return proxyUpload(request, await params);
}
