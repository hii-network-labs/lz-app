import { ethers } from 'ethers';
import { getNetworkConfig } from './config';
import oftAbi from './abi/oft.json';

// Get provider for a specific network
export const getProvider = (networkKey: string): ethers.JsonRpcProvider => {
  const config = getNetworkConfig(networkKey);
  return new ethers.JsonRpcProvider(config.rpcHttp);
};

// Get OFT contract instance (read-only)
export const getOftContract = (networkKey: string): ethers.Contract => {
  const config = getNetworkConfig(networkKey);
  const provider = getProvider(networkKey);
  return new ethers.Contract(config.oft, oftAbi, provider);
};

// Get OFT contract instance with signer
export const getSignedOftContract = (networkKey: string, signer: ethers.Signer): ethers.Contract => {
  const config = getNetworkConfig(networkKey);
  return new ethers.Contract(config.oft, oftAbi, signer);
};

// Get OFT contract by explicit address (read-only)
export const getOftContractAt = (networkKey: string, oftAddress: string): ethers.Contract => {
  const provider = getProvider(networkKey);
  return new ethers.Contract(oftAddress, oftAbi, provider);
};

// Get OFT contract by explicit address with signer
export const getSignedOftContractAt = (networkKey: string, oftAddress: string, signer: ethers.Signer): ethers.Contract => {
  return new ethers.Contract(oftAddress, oftAbi, signer);
};

// No options field in SendParam per ABI; extraOptions is bytes

// Convert address to bytes32 format
export const addressToBytes32 = (address: string): string => {
  return '0x' + address.slice(2).padStart(64, '0');
};

// Build SendParam object for OFT send (match ABI exactly)
export interface SendParam {
  dstEid: number;
  to: string; // bytes32
  amountLD: bigint;
  minAmountLD: bigint;
  extraOptions: string;
  composeMsg: string;
  oftCmd: string;
}

export const buildSendParam = (
  srcNetworkKey: string,
  dstNetworkKey: string,
  amount: string,
  receiverAddress: string,
  decimals?: number,
  extraOptionsOverride?: string
): SendParam => {
  const dstConfig = getNetworkConfig(dstNetworkKey);
  const receiverAddressBytes32 = addressToBytes32(receiverAddress);
  
  const parsedAmount = ethers.parseUnits(amount, decimals ?? 18);
  // Mirror Forge script tolerance: allow ~1% slippage
  const minAmountLD = (parsedAmount * 9900n) / 10000n;
  
  return {
    dstEid: dstConfig.eid,
    to: receiverAddressBytes32,
    amountLD: parsedAmount,
    minAmountLD,
    extraOptions: extraOptionsOverride ?? "0x",
    composeMsg: "0x",
    oftCmd: "0x"
  };
};

// Ethers Interface for error decoding
const oftInterface = new ethers.Interface(oftAbi as any);

// Attempt to decode revert data into a human-readable contract error
export const decodeOftError = (err: any): string | null => {
  const data: string | undefined =
    (err && typeof err.data === 'string' && err.data) ||
    (err && err.data && typeof err.data.data === 'string' && err.data.data) ||
    (err && err.info && err.info.error && typeof err.info.error.data === 'string' && err.info.error.data) ||
    (typeof err === 'string' ? err : undefined);
  if (!data || !data.startsWith('0x')) return null;
  try {
    const parsed = oftInterface.parseError(data);
    const name = parsed?.name ?? 'UnknownError';
    const argsObj = parsed?.args ? Object.fromEntries(parsed.args.entries()) : undefined;
    return `${name}${argsObj ? ' ' + JSON.stringify(argsObj) : ''}`;
  } catch {
    // Fallback for common known error selectors
    const selector = data.slice(0, 10).toLowerCase();
    const known: Record<string, string> = {
      // Likely InvalidOptions(bytes) selector observed in logs
      '0x6592671c': 'InvalidOptions(bytes)',
    };
    return known[selector] || null;
  }
};