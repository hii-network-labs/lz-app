import { Options } from '@layerzerolabs/lz-v2-utilities';

// Build a minimal Executor options TLV for lzReceive gas on destination
// Defaults: 200k gas, 0 msg.value. Adjust if your destination requires more.
export const buildLzReceiveOptions = (gas: number = 200_000, valueWei: number = 0): string => {
  const opts = Options.newOptions().addExecutorLzReceiveOption(gas, valueWei);
  return opts.toHex();
};

// Helper to build composed options if needed later
export const buildComposeOptions = (
  index: number,
  gas: number,
  valueWei: number = 0,
): string => {
  const opts = Options.newOptions().addExecutorComposeOption(index, gas, valueWei);
  return opts.toHex();
};

// Native drop option (send native gas on destination)
export const buildNativeDropOptions = (amountWei: string, recipient: string): string => {
  const opts = Options.newOptions().addExecutorNativeDropOption(amountWei, recipient);
  return opts.toHex();
};