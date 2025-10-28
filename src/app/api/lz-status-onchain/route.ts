import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import { getNetworkConfig, getTokensConfig } from '@/lib/config';
import { getProvider } from '@/lib/contracts';
import endpointAbi from '@/lib/abi/endpointv2.json';
import dvnAbi from '@/lib/abi/dvn.json';

// Simple GET handler to avoid 404 when visited directly; instructs to use POST
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Use POST with { txHash, sourceNetwork, destNetwork, tokenId } to query on-chain status.'
  });
}

// POST body: { txHash, sourceNetwork, destNetwork, tokenId }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { txHash, sourceNetwork, destNetwork, tokenId, scanWindow, includeDvn } = body || {};
    if (!txHash || !sourceNetwork || !destNetwork || !tokenId) {
      return NextResponse.json({ error: 'Missing txHash, sourceNetwork, destNetwork, or tokenId' }, { status: 400 });
    }

    // Resolve configs and OFT addresses
    const srcConfig = getNetworkConfig(sourceNetwork);
    const dstConfig = getNetworkConfig(destNetwork);
    const tokens = getTokensConfig();
    const token = tokens.find(t => t.id === tokenId);
    const oftSrc = token?.addresses?.[sourceNetwork];
    if (!oftSrc) {
      return NextResponse.json({ error: 'OFT address not found for source network' }, { status: 400 });
    }

    const srcProvider = getProvider(sourceNetwork);
    const dstProvider = getProvider(destNetwork);

    // 1) Fetch source tx receipt to anchor block range
    const srcReceipt = await srcProvider.getTransactionReceipt(txHash).catch(() => null);
    const sentOk = srcReceipt ? ((srcReceipt.status ?? 0) === 1) : false;
    const toBlock = await dstProvider.getBlockNumber();
    // Determine fromBlock: prefer source receipt block for tight filtering; fallback to recent window
    const recentWindow = Number(scanWindow ?? 20000); // adjustable per chain/request
    const fromBlock = srcReceipt && srcReceipt.blockNumber != null
      ? Number(srcReceipt.blockNumber)
      : Math.max(0, Number(toBlock) - recentWindow);

    // 2) Scan destination EndpointV2 logs (using ABI) for PacketDelivered and PacketVerified
    const endpointAddress = dstConfig.endpointV2;
    const endpointIface = new ethers.Interface(endpointAbi as any);
    const deliveredTopic = ethers.id('PacketDelivered((uint32,bytes32,uint64),address)');
    const verifiedTopic = ethers.id('PacketVerified((uint32,bytes32,uint64),address,bytes32)');

    const deliveredLogs = await dstProvider.getLogs({
      address: endpointAddress,
      fromBlock,
      toBlock,
      topics: [deliveredTopic],
    }).catch(() => [] as any[]);

    const verifiedLogs = await dstProvider.getLogs({
      address: endpointAddress,
      fromBlock,
      toBlock,
      topics: [verifiedTopic],
    }).catch(() => [] as any[]);

    // Helper: left-pad address to bytes32
    const pad32 = (addr: string) => '0x' + addr.toLowerCase().slice(2).padStart(64, '0');
    const expectedSender = pad32(oftSrc);
    const expectedSrcEid = srcConfig.eid;

    let matched: { dstTx: string, origin: { srcEid: number, sender: string, nonce: bigint }, receiver?: string } | null = null;
    for (const log of deliveredLogs) {
      try {
        const parsed = endpointIface.parseLog(log);
        if (!parsed || parsed?.name !== 'PacketDelivered') continue;
        const origin = parsed.args?.origin as { srcEid: number, sender: string, nonce: bigint };
        const receiver = parsed.args?.receiver as string | undefined;
        if (!origin) continue;
        const srcEidOk = Number(origin.srcEid) === Number(expectedSrcEid);
        const senderOk = String(origin.sender).toLowerCase() === expectedSender.toLowerCase();
        if (srcEidOk && senderOk) {
          matched = { dstTx: log.transactionHash, origin, receiver };
          break;
        }
      } catch {
        // Ignore decode failures from unrelated events
      }
    }

    // If not yet delivered, see if the packet was verified (gives a more granular status)
    let verified: { dstTx: string, origin: { srcEid: number, sender: string, nonce: bigint } } | null = null;
    if (!matched) {
      for (const log of verifiedLogs) {
        try {
          const parsed = endpointIface.parseLog(log);
          if (!parsed || parsed?.name !== 'PacketVerified') continue;
          const origin = parsed.args?.origin as { srcEid: number, sender: string, nonce: bigint };
          if (!origin) continue;
          const srcEidOk = Number(origin.srcEid) === Number(expectedSrcEid);
          const senderOk = String(origin.sender).toLowerCase() === expectedSender.toLowerCase();
          if (srcEidOk && senderOk) {
            verified = { dstTx: log.transactionHash, origin };
            break;
          }
        } catch {
          // Ignore decode failures from unrelated events
        }
      }
    }

    // Optionally scan DVN events on destination for verification-related signals
    let dvnSummary: { events: Array<{ name: string; txHash: string }>, address?: string } | null = null;
    if (includeDvn && dstConfig.dvn) {
      const dvnAddress = dstConfig.dvn;
      const dvnIface = new ethers.Interface(dvnAbi as any);
      const dvnLogs = await dstProvider.getLogs({
        address: dvnAddress,
        fromBlock,
        toBlock,
      }).catch(() => [] as any[]);
      const events: Array<{ name: string; txHash: string }> = [];
      for (const log of dvnLogs) {
        try {
          const parsed = dvnIface.parseLog(log);
          if (!parsed) continue;
          const name = parsed.name as string;
          if (name === 'VerifierFeePaid' || name === 'VerifySignaturesFailed' || name === 'ExecuteFailed' || name === 'HashAlreadyUsed') {
            events.push({ name, txHash: (log as any).transactionHash });
          }
        } catch {
          // ignore decode error for unrelated events
        }
      }
      dvnSummary = { events, address: dvnAddress };
    }

    // Derive a worker-like stage from observed data
    const stage = matched
      ? 'executed'
      : verified
      ? 'verified'
      : (srcReceipt ? (sentOk ? 'inflight' : 'unknown') : 'inflight');

    // Normalize origin object to avoid BigInt in JSON (nonce -> string)
    const normalizeOrigin = (o: any) => {
      if (!o) return null;
      return {
        srcEid: Number(o.srcEid),
        sender: String(o.sender),
        nonce: (typeof o.nonce === 'bigint') ? o.nonce.toString() : (o.nonce?.toString?.() ?? String(o.nonce)),
      };
    };

    return NextResponse.json({
      stage,
      source: { status: srcReceipt ? (sentOk ? 'Sent' : 'Failed') : 'PendingOrUnknown', txHash },
      destination: {
        status: matched ? 'Delivered' : (verified ? 'Verified' : 'NotFound'),
        txHash: matched?.dstTx || verified?.dstTx || null,
      },
      origin: normalizeOrigin(matched?.origin || verified?.origin || null),
      receiver: matched?.receiver || null,
      verification: dvnSummary ? { dvn: dvnSummary } : null,
      networkBase: `${srcConfig.name}→${dstConfig.name}`,
      window: { fromBlock, toBlock },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}