// Network configuration types
export interface NetworkConfig {
  name: string;
  chainId: number;
  rpcHttp: string;
  rpcWs?: string;
  eid: number;
  endpointV2: string;
  dvn: string;
  executor: string;
  lzExecutor: string;
  oft: string;
  priceFeed: string;
  receiveUln: string;
  sendUln: string;
  treasury: string;
  explorerTxBase?: string;
}

export interface NetworksConfig {
  [key: string]: NetworkConfig;
}

export interface SupportedPair { src: string; dst: string }

const parseNum = (v?: string): number | undefined => {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// Static env reads so Next can inline values in client bundles
const buildHii = (): NetworkConfig | null => {
  const name = process.env.NEXT_PUBLIC_HII_NAME;
  const chainId = parseNum(process.env.NEXT_PUBLIC_HII_CHAIN_ID);
  const rpcHttp = process.env.NEXT_PUBLIC_HII_RPC_HTTP;
  const rpcWs = process.env.NEXT_PUBLIC_HII_RPC_WS;
  const eid = parseNum(process.env.NEXT_PUBLIC_HII_EID);
  const endpointV2 = process.env.NEXT_PUBLIC_HII_ENDPOINT_V2;
  const dvn = process.env.NEXT_PUBLIC_HII_DVN;
  const executor = process.env.NEXT_PUBLIC_HII_EXECUTOR;
  const lzExecutor = process.env.NEXT_PUBLIC_HII_LZ_EXECUTOR;
  const oft = process.env.NEXT_PUBLIC_HII_OFT;
  const priceFeed = process.env.NEXT_PUBLIC_HII_PRICE_FEED;
  const receiveUln = process.env.NEXT_PUBLIC_HII_RECEIVE_ULN;
  const sendUln = process.env.NEXT_PUBLIC_HII_SEND_ULN;
  const treasury = process.env.NEXT_PUBLIC_HII_TREASURY;
  const explorerTxBase = process.env.NEXT_PUBLIC_HII_EXPLORER_TX_BASE;

  if (!name || !chainId || !rpcHttp || !eid || !endpointV2 || !dvn || !executor || !lzExecutor || !oft || !priceFeed || !receiveUln || !sendUln || !treasury) return null;
  return { name, chainId, rpcHttp, rpcWs, eid, endpointV2, dvn, executor, lzExecutor, oft, priceFeed, receiveUln, sendUln, treasury, explorerTxBase };
};

const buildSepolia = (): NetworkConfig | null => {
  const name = process.env.NEXT_PUBLIC_SEPOLIA_NAME;
  const chainId = parseNum(process.env.NEXT_PUBLIC_SEPOLIA_CHAIN_ID);
  const rpcHttp = process.env.NEXT_PUBLIC_SEPOLIA_RPC_HTTP;
  const rpcWs = process.env.NEXT_PUBLIC_SEPOLIA_RPC_WS;
  const eid = parseNum(process.env.NEXT_PUBLIC_SEPOLIA_EID);
  const endpointV2 = process.env.NEXT_PUBLIC_SEPOLIA_ENDPOINT_V2;
  const dvn = process.env.NEXT_PUBLIC_SEPOLIA_DVN;
  const executor = process.env.NEXT_PUBLIC_SEPOLIA_EXECUTOR;
  const lzExecutor = process.env.NEXT_PUBLIC_SEPOLIA_LZ_EXECUTOR;
  const oft = process.env.NEXT_PUBLIC_SEPOLIA_OFT;
  const priceFeed = process.env.NEXT_PUBLIC_SEPOLIA_PRICE_FEED;
  const receiveUln = process.env.NEXT_PUBLIC_SEPOLIA_RECEIVE_ULN;
  const sendUln = process.env.NEXT_PUBLIC_SEPOLIA_SEND_ULN;
  const treasury = process.env.NEXT_PUBLIC_SEPOLIA_TREASURY;
  const explorerTxBase = process.env.NEXT_PUBLIC_SEPOLIA_EXPLORER_TX_BASE;

  if (!name || !chainId || !rpcHttp || !eid || !endpointV2 || !dvn || !executor || !lzExecutor || !oft || !priceFeed || !receiveUln || !sendUln || !treasury) return null;
  return { name, chainId, rpcHttp, rpcWs, eid, endpointV2, dvn, executor, lzExecutor, oft, priceFeed, receiveUln, sendUln, treasury, explorerTxBase };
};

// Parse the network configuration from environment variable
export const getNetworksConfig = (): NetworksConfig => {
  // Prefer per-variable envs; fallback to JSON for backward compatibility
  const networks: NetworksConfig = {};
  const hii = buildHii();
  const sepolia = buildSepolia();
  if (hii) networks['hii'] = hii;
  if (sepolia) networks['sepolia'] = sepolia;

  if (Object.keys(networks).length > 0) return networks;

  // Fallback: parse JSON blob if present
  const configStr = process.env.NEXT_PUBLIC_NETWORKS_CONFIG;
  if (configStr) {
    try {
      return JSON.parse(configStr);
    } catch (error) {
      console.error('Failed to parse NEXT_PUBLIC_NETWORKS_CONFIG:', error);
    }
  }
  throw new Error('No network configuration found in environment variables');
};

// Get network keys for dropdown options
export const getNetworkKeys = (): string[] => {
  return Object.keys(getNetworksConfig());
};

// Get a specific network configuration
export const getNetworkConfig = (networkKey: string): NetworkConfig => {
  const networksConfig = getNetworksConfig();
  const config = networksConfig[networkKey];
  
  if (!config) {
    throw new Error(`Network configuration for ${networkKey} not found`);
  }
  
  return config;
};

// Supported network pairs (src->dst), e.g., "hii:sepolia,hii:other"
export const getSupportedPairs = (): SupportedPair[] => {
  const pairsStr = process.env.NEXT_PUBLIC_SUPPORTED_PAIRS;
  if (!pairsStr) return [{ src: 'hii', dst: 'sepolia' }];
  return pairsStr.split(',').map((p) => {
    const [src, dst] = p.split(':').map((s) => s.trim());
    return { src, dst } as SupportedPair;
  }).filter((p) => p.src && p.dst);
};

// Token configuration
export interface TokenConfig {
  id: string; // stable id
  symbol: string;
  name: string;
  addresses: { [networkKey: string]: string }; // OFT or adapter addresses per network
  nativeAdapter?: boolean; // when true, treat address as Native OFT Adapter and send native value
}

export const getTokensConfig = (): TokenConfig[] => {
  // Optional JSON env override for tokens
  const json = process.env.NEXT_PUBLIC_TOKENS_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) return parsed as TokenConfig[];
    } catch (e) {
      console.warn('[config] Failed to parse NEXT_PUBLIC_TOKENS_JSON, falling back to default', e);
    }
  }
  // Fallback: build a single token from network configs' OFT addresses
  const networks = getNetworksConfig();
  const addresses: Record<string, string> = {};
  for (const key of Object.keys(networks)) {
    const oft = networks[key].oft;
    if (oft) addresses[key] = oft;
  }
  const defaults: TokenConfig[] = [{ id: 'default', symbol: 'OFT', name: 'OFT Token', addresses }];
  // Optionally include explicit native/wrapped tokens based on env toggle
  const enableExtras = process.env.NEXT_PUBLIC_ENABLE_TOKEN_EXTRAS === 'true';
  if (!enableExtras) {
    return defaults;
  }
  // Build explicit tokens for both flows: native→wrapped and wrapped→native
  const extras: TokenConfig[] = [];
  const hiiNativeAdapter = process.env.NEXT_PUBLIC_HII_NATIVE_ADAPTER;
  if (hiiNativeAdapter) {
    // Native HNC is sendable only from Hii (source-side native adapter)
    const addressesHnc: Record<string, string> = { hii: hiiNativeAdapter };
    extras.push({
      id: 'hnc_native',
      symbol: 'HNC',
      name: 'Native HNC',
      nativeAdapter: true,
      addresses: addressesHnc,
    });
  }
  const sepoliaNativeAdapter = process.env.NEXT_PUBLIC_SEPOLIA_NATIVE_ADAPTER;
  if (sepoliaNativeAdapter) {
    // Native ETH is sendable only from Sepolia (source-side native adapter)
    const addressesEth: Record<string, string> = { sepolia: sepoliaNativeAdapter };
    extras.push({
      id: 'eth_native',
      symbol: 'ETH',
      name: 'Native ETH',
      nativeAdapter: true,
      addresses: addressesEth,
    });
  }
  // Wrapped→native flows (send wrapped ERC-20 and receive native if destination adapter exists)
  // Explicit "wrap of the other side" tokens must use exact contract envs
  const hiiWeth = process.env.NEXT_PUBLIC_HII_WETH_OFT;
  if (hiiWeth) {
    extras.push({ id: 'weth_wrapped', symbol: process.env.NEXT_PUBLIC_SEPOLIA_WRAPPED_SYMBOL || 'WETH', name: process.env.NEXT_PUBLIC_SEPOLIA_WRAPPED_NAME || 'Wrapped ETH', addresses: { hii: hiiWeth } });
  }
  const sepoliaWhnc = process.env.NEXT_PUBLIC_SEPOLIA_WHNC_OFT;
  if (sepoliaWhnc) {
    extras.push({ id: 'whnc_wrapped', symbol: process.env.NEXT_PUBLIC_HII_WRAPPED_SYMBOL || 'WHNC', name: process.env.NEXT_PUBLIC_HII_WRAPPED_NAME || 'Wrapped HNC', addresses: { sepolia: sepoliaWhnc } });
  }
  return [...defaults, ...extras];
};