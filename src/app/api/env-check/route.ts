import { NextResponse } from 'next/server';
import { getNetworksConfig } from '@/lib/config';

// Diagnostics route: reports presence of required env configuration without exposing secrets
export async function GET() {
  let networks: Record<string, any> | null = null;
  let networksError: string | null = null;
  try {
    const cfgs = getNetworksConfig();
    networks = {};
    for (const key of Object.keys(cfgs)) {
      const c = cfgs[key];
      networks[key] = {
        name: c.name,
        chainId: c.chainId,
        rpcHttpPresent: !!c.rpcHttp,
        endpointV2Present: !!c.endpointV2,
        oftPresent: !!c.oft,
        explorerTxBasePresent: !!c.explorerTxBase,
      };
    }
  } catch (e: any) {
    networksError = e?.message || 'Failed to read NEXT_PUBLIC network config';
  }

  const aggregator = {
    basePresent: !!process.env.STATUS_API_BASE || !!process.env.NEXT_PUBLIC_STATUS_API_BASE,
    usernamePresent: !!process.env.STATUS_API_USERNAME,
    passwordPresent: !!process.env.STATUS_API_PASSWORD,
  };

  return NextResponse.json({ ok: true, networks, networksError, aggregator });
}