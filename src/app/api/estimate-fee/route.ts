// Using Response from Web API instead of NextResponse
import { ethers } from 'ethers';
import { getNetworkConfig, getTokensConfig } from '@/lib/config';
import { buildSendParam, getProvider, getOftContractAt } from '@/lib/contracts';
import { buildLzReceiveOptions } from '@/lib/options';

// Define NextRequest type locally if needed
type NextRequest = Request & {
  json: () => Promise<any>;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { src, dst, amount, tokenId } = body;

    if (!src || !dst || !amount || !tokenId) {
      return Response.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Resolve selected token's OFT address on source network
    const tokens = getTokensConfig();
    const token = tokens.find(t => t.id === tokenId);
    const oftAddress = token?.addresses?.[src];
    if (!oftAddress) {
      return Response.json(
        { error: 'Selected token not supported on source network' },
        { status: 400 }
      );
    }
    // Get OFT contract for source network at the selected token address
    const oftContract = getOftContractAt(src, oftAddress);
    
    // Resolve decimals from underlying token for accurate quoting
    let decimals = 18;
    try {
      const underlying: string = await oftContract.token();
      const provider = getProvider(src);
      const erc20Abi = [{
        inputs: [],
        name: 'decimals',
        outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
        stateMutability: 'view',
        type: 'function',
      }];
      const erc20 = new ethers.Contract(underlying, erc20Abi, provider);
      const d: number = await erc20.decimals();
      decimals = d || 18;
      console.log('[lz][api] underlying token decimals', decimals);
    } catch (decErr) {
      console.warn('[lz][api] decimals fetch failed, defaulting to 18', decErr);
    }

    // Resolve options (lzReceive gas) and combine with enforced
    const dstConfig = getNetworkConfig(dst);
    let combinedOptions = '0x';
    try {
      const msgType: number = await oftContract.SEND();
      const enforced: string = await oftContract.enforcedOptions(dstConfig.eid, msgType);
      console.log('[lz][api] enforcedOptions', { dstEid: dstConfig.eid, msgType, enforced });
      const localOptions = buildLzReceiveOptions(200_000, 0);
      combinedOptions = await oftContract.combineOptions(dstConfig.eid, msgType, localOptions);
      console.log('[lz][api] combinedOptions', { dstEid: dstConfig.eid, msgType, combinedOptions });
    } catch (optErr) {
      console.warn('[lz][api] options combine failed', optErr);
    }

    // Build send parameters with combined options
    const sendParam = buildSendParam(
      src,
      dst,
      amount,
      '0x0000000000000000000000000000000000000000', // Dummy address for fee estimation
      decimals,
      combinedOptions
    );
    console.log('[lz][api] estimate-fee sendParam', sendParam);

    // Quote the fee
    const fee = await oftContract.quoteSend(sendParam, false);
    console.log('[lz][api] estimate-fee quoted fee', {
      nativeFee: fee?.nativeFee?.toString?.() ?? fee?.nativeFee,
      lzTokenFee: fee?.lzTokenFee?.toString?.() ?? fee?.lzTokenFee,
    });
    
    // Format fee to ETH
    const feeInEth = ethers.formatEther(fee.nativeFee);

    return Response.json({ fee: feeInEth });
  } catch (error: any) {
    console.error('Error estimating fee:', error);
    return Response.json(
      { error: error.message || 'Failed to estimate fee' },
      { status: 500 }
    );
  }
}