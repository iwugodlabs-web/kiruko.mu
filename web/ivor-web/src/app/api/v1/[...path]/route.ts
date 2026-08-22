/**
 * Runtime API proxy route handler.
 *
 * All requests to /api/v1/* are proxied to BACKEND_URL at REQUEST TIME,
 * which means BACKEND_URL is read from the runtime environment — no
 * build-time baking required (unlike next.config.ts rewrites).
 */
import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

async function proxyRequest(
  request: NextRequest,
  params: { path: string[] }
): Promise<NextResponse> {
  const path = params.path.join('/');
  const search = request.nextUrl.search;
  const targetUrl = `${BACKEND_URL}/api/v1/${path}${search}`;

  // Forward request headers, but drop 'host' (it must match the backend)
  const forwardHeaders = new Headers();
  request.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'host') {
      forwardHeaders.set(key, value);
    }
  });

  // Plan P0-4: cap proxy waits so a wedged backend cannot pin Next.js
  // workers indefinitely. 15s comfortably covers slow payroll / Document AI
  // calls without flirting with Vercel's 60s platform timeout.
  const PROXY_TIMEOUT_MS = 15_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  const requestInit: RequestInit = {
    method: request.method,
    headers: forwardHeaders,
    signal: controller.signal,
  };

  // Forward body for methods that have one
  if (!['GET', 'HEAD'].includes(request.method)) {
    requestInit.body = await request.arrayBuffer();
    // Ensure content-length isn't stale
    forwardHeaders.delete('content-length');
  }

  try {
    const backendResponse = await fetch(targetUrl, requestInit);

    // Build response headers, forwarding Set-Cookie properly
    const responseHeaders = new Headers();
    backendResponse.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      // Skip hop-by-hop headers that should not be forwarded
      if (['content-encoding', 'transfer-encoding'].includes(lower)) return;
      // append (not set) to preserve multiple Set-Cookie headers
      responseHeaders.append(key, value);
    });

    // Per the Fetch spec, 204/205/304 (and 1xx) responses must have a null
    // body — passing even an empty ArrayBuffer makes the Response constructor
    // throw. Hits us on DELETE endpoints that return 204 No Content.
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
    if (isAbort) {
      console.error(`[Proxy] Timed out after ${PROXY_TIMEOUT_MS}ms calling ${targetUrl}`);
      return NextResponse.json(
        { detail: 'Backend did not respond in time. Please retry.' },
        { status: 504 },
      );
    }
    console.error(`[Proxy] Failed to reach backend at ${targetUrl}:`, error);
    return NextResponse.json(
      { detail: 'Backend service unavailable. Please try again later.' },
      { status: 503 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, await params);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, await params);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, await params);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, await params);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  return proxyRequest(request, await params);
}
