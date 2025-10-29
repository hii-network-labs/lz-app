// Secure server-side proxy for aggregator status API
// Avoids exposing credentials by handling Basic Auth on the server.

type NextRequest = Request & { json: () => Promise<any> };

const resolveBase = (): string | undefined => {
  return process.env.STATUS_API_BASE || process.env.NEXT_PUBLIC_STATUS_API_BASE;
};

export async function GET() {
  return Response.json({ ok: true, message: 'Use POST with { txHash }' });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const txHash: string | undefined = body?.txHash;
    if (!txHash || typeof txHash !== 'string') {
      return Response.json({ error: 'txHash is required' }, { status: 400 });
    }

    const base = resolveBase();
    if (!base) {
      return Response.json({ error: 'STATUS_API_BASE not configured', hint: 'Set STATUS_API_BASE in env, e.g. https://your-aggregator-host/v1' }, { status: 500 });
    }

    const user = process.env.STATUS_API_USERNAME || '';
    const pass = process.env.STATUS_API_PASSWORD || '';
    const auth = user && pass ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') : undefined;

    const upstream = `${base}/api/tx/by-hash/${txHash}`;
    console.log('[agg-status proxy] upstream request', { base, path: upstream, auth });
    const res = await fetch(upstream, {
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        'Accept': 'application/json',
      },
    });
    
    console.log('[agg-status proxy] upstream response', { status: res.status, headers: res.headers });

    if (!res.ok) {
      const text = await res.text();
      const status = res.status;
      // Log minimal diagnostics server-side
      console.log('[agg-status proxy] upstream non-OK', { status, base, path: upstream });
      if (status === 404) {
        return Response.json({ found: false, error: 'Not found', upstreamStatus: status, body: text }, { status });
      }
      if (status === 401 || status === 403) {
        return Response.json({ error: 'Unauthorized', upstreamStatus: status, hint: 'Check STATUS_API_USERNAME/PASSWORD' }, { status });
      }
      return Response.json({ error: 'Upstream error', upstreamStatus: status, body: text }, { status });
    }

    const json = await res.json();
    return Response.json(json);
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}