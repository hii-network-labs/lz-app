import { NextRequest } from 'next/server';

const MAINNET_BASE = 'https://scan.layerzero-api.com/v1';
const TESTNET_BASE = 'https://scan-testnet.layerzero-api.com/v1';

type ScanMessage = {
  pathway?: {
    srcEid?: number;
    dstEid?: number;
    nonce?: number;
  };
  source?: {
    status?: string;
    tx?: { txHash?: string };
  };
  destination?: {
    status?: string;
    tx?: { txHash?: string };
    payloadStoredTx?: string;
  };
  verification?: {
    dvn?: { status?: string };
    sealer?: { status?: string };
  };
  guid?: string;
  status?: { name?: string; message?: string };
};

async function fetchByTx(base: string, txHash: string): Promise<ScanMessage[] | null> {
  try {
    // The official docs list "Get messages by transaction hash"; the route is /messages/tx/{hash}
    const res = await fetch(`${base}/messages/tx/${txHash}`);
    if (!res.ok) return null;
    const json = await res.json();
    const data = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    return data.length ? data : null;
  } catch (e) {
    return null;
  }
}

function deriveWorkerStage(msg: ScanMessage) {
  const dvn = msg.verification?.dvn?.status?.toLowerCase?.();
  const sealer = msg.verification?.sealer?.status?.toLowerCase?.();
  const dest = msg.destination?.status?.toLowerCase?.();
  const destTx = msg.destination?.tx?.txHash;
  const srcTx = msg.source?.tx?.txHash;

  // Heuristic mapping to user-friendly stages similar to LayerZero Scan "Worker Status"
  if (srcTx && !dvn && !sealer && !dest && !destTx) return 'sent';
  if (dvn && !sealer) return 'dvn_verifying';
  // "Committed" corresponds to sealer committing the verified message to the channel
  if (sealer && !destTx) return 'committed';
  // When destination has a tx but status not explicitly delivered, execution is underway
  if (destTx && dest && !dest.includes('delivered')) return 'executing';
  // Delivered/executed
  if (destTx && (dest?.includes('delivered') || dest?.includes('success'))) return 'executed';
  // Payload stored indicates execution failure; expose as needs retry
  if (msg.destination?.payloadStoredTx) return 'payload_stored';
  // Fallback to high-level status name
  const name = msg.status?.name?.toLowerCase?.();
  if (name) return name;
  return 'unknown';
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const txHash: string | undefined = body?.txHash;
    const network: 'mainnet' | 'testnet' | undefined = body?.network;
    if (!txHash || typeof txHash !== 'string') {
      return Response.json({ error: 'txHash is required' }, { status: 400 });
    }

    // Try the indicated network first; otherwise attempt both testnet and mainnet
    const bases: string[] = network === 'mainnet'
      ? [MAINNET_BASE]
      : network === 'testnet'
      ? [TESTNET_BASE]
      : [TESTNET_BASE, MAINNET_BASE];

    let messages: ScanMessage[] | null = null;
    let usedBase: string | null = null;
    for (const base of bases) {
      const data = await fetchByTx(base, txHash);
      if (data && data.length) {
        messages = data;
        usedBase = base;
        break;
      }
    }

    if (!messages) {
      return Response.json({ found: false, messages: [], stage: 'unknown' });
    }

    // Choose the most relevant message (if multiple, pick the one with destination info)
    const primary = messages.find(m => m.destination?.status || m.destination?.tx?.txHash) || messages[0];
    const stage = deriveWorkerStage(primary);

    return Response.json({
      found: true,
      networkBase: usedBase,
      stage,
      guid: primary?.guid,
      pathway: primary?.pathway,
      source: primary?.source,
      destination: primary?.destination,
      verification: primary?.verification,
      raw: messages,
    });
  } catch (e: any) {
    return Response.json({ error: e?.message || 'Failed to fetch status' }, { status: 500 });
  }
}