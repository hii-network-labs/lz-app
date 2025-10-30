# Developer Guide

This document helps new contributors and integrators understand the application’s flow, configuration, supported network pairs, transaction workflows, and status tracking.

## Overview

The app enables cross-chain OFT transfers using LayerZero. It consists of a client UI (Next.js), configuration and contract helpers, and serverless API routes for fee estimation and status tracking.

Key directories:
- `src/app/page.tsx` – Main client UI and send flow.
- `src/lib/config.ts` – Network, tokens, and supported pairs configuration from environment variables.
- `src/lib/contracts.ts` – Provider creation and OFT contract helpers.
- `src/lib/options.ts` – TLV utilities to build LayerZero executor options.
- `src/app/api/*` – Serverless routes for fees and status.

## Configuration

Networks and tokens are configured via public environment variables so the client bundle can inline them at build time.

- Public env vars (examples):
  - `NEXT_PUBLIC_HII_*`, `NEXT_PUBLIC_SEPOLIA_*` – Names, chain IDs, RPC HTTP URLs, EndpointV2 addresses, DVN, executors, OFT addresses, etc.
  - `NEXT_PUBLIC_SUPPORTED_PAIRS` – Comma-separated pairs like `hii:sepolia`.
  - `NEXT_PUBLIC_TOKENS_JSON` – Optional JSON array of tokens with per-network OFT addresses.
- Server-only env vars (used by serverless proxy):
  - `STATUS_API_BASE` – Aggregator API base URL.
  - `STATUS_API_USERNAME`, `STATUS_API_PASSWORD` – Basic auth credentials.

Helpers:
- `getNetworksConfig()` reads network configs from `NEXT_PUBLIC_*` envs.
- `getNetworkConfig(key)` returns a single network config.
- `getSupportedPairs()` reads `NEXT_PUBLIC_SUPPORTED_PAIRS`.
- `getTokensConfig()` reads `NEXT_PUBLIC_TOKENS_JSON` or builds a default token from network OFT addresses.

Diagnostics:
- `GET /api/env-check` returns whether required envs are present (without exposing their actual values).

## Supported Pairs

Supported pairs are defined by `NEXT_PUBLIC_SUPPORTED_PAIRS`. The UI enforces:
- Source networks shown only if present in `getNetworkKeys()` and supported by the selected token.
- Destination networks filtered to those allowed for the chosen source and token.

Example: `NEXT_PUBLIC_SUPPORTED_PAIRS=hii:sepolia`

## Send Flow

The user journey in `src/app/page.tsx`:
1. Connect wallet: MetaMask injects `window.ethereum`; account and chainId stored in state.
2. Choose Source and Destination networks: filtered based on supported pairs and token coverage.
3. Select token: only tokens with OFT addresses on the selected networks are displayed.
4. Enter amount: optional “Max” button uses the fetched balance on the source network.
5. Estimate fee:
   - `POST /api/estimate-fee` resolves decimals from the OFT’s underlying token, builds send parameters, combines enforced options with a local executor option, and returns `nativeFee` formatted.
6. Send transaction:
   - Build `SendParam` with `buildSendParam()` and combined options.
   - Use `getSignedOftContractAt(src, oftAddress, signer)` to call OFT `send`.
   - `isSending` is set to `true` and remains loading until the executed/delivered stage is reached or an error occurs.
   - `txHash` is stored and used for status polling.

Notes:
- We removed the “Sender” field as it’s the user’s wallet address.
- The source transaction and receipt may still be fetched for timestamps and explorer links.

## Status Tracking

Two complementary status mechanisms run in parallel once `txHash` is available:

- Aggregator proxy: `POST /api/agg-status` with `{ txHash }`
  - Proxies to an upstream aggregator, adding Basic auth on the server.
  - Returns steps like `sent`, `dvn_verifying`, `committed`, `executed`, including `txHash`, `chainId`, and `guid` when available.
  - If upstream returns `401`/`403`, the proxy passes the status and includes hints to fix credentials.

- On-chain worker-like status: `POST /api/lz-status-onchain`
  - Reads source receipt and derives `origin.nonce` from `PacketSent` in `EndpointV2` logs.
  - Scans destination `EndpointV2` logs for `PacketVerified` and `PacketDelivered` and correlates by `srcEid` and `origin.nonce`.
  - Optionally inspects DVN logs for verification signals.
  - Produces a stage: `inflight`, `verified`, or `executed`.

UI behavior:
- The “Send Cross-Chain” button remains in loading state until the executed/delivered step is detected from either the aggregator or on-chain status.
- Errors during sending or polling stop loading and display an error.

## API Routes Summary

- `POST /api/estimate-fee` – Quotes the OFT send fee using the source OFT contract at the selected token address.
- `POST /api/agg-status` – Server-side proxy to the aggregator; uses `STATUS_API_*` envs and passes upstream status codes.
- `POST /api/lz-status-onchain` – Queries source and destination chain logs via `ethers` providers using public RPC URLs.
- `GET /api/env-check` – Diagnostics for env presence (safe to expose).
- `POST /api/lz-status` – Queries LayerZero Scan API (testnet/mainnet) for pathway details, used as a complementary data source.

## Environment Setup (Local and Vercel)

Local `.env.local` example:
- `NEXT_PUBLIC_HII_RPC_HTTP=http://115.75.100.60:8546` (ensure RPC is accessible from browser; avoid localhost-only RPCs in production)
- `NEXT_PUBLIC_SEPOLIA_RPC_HTTP=<HTTPS RPC URL>`
- `NEXT_PUBLIC_SUPPORTED_PAIRS=hii:sepolia`
- `STATUS_API_BASE=https://lz-txtracker.teknix.dev`
- `STATUS_API_USERNAME` and `STATUS_API_PASSWORD`

Vercel:
- Set all `NEXT_PUBLIC_*` network and token variables in Project → Settings → Environment Variables (these are inlined at build time).
- Set server-only `STATUS_API_*` for the aggregator proxy credentials.
- After deployment, visit `/api/env-check` to confirm `networks` and `aggregator` env presence.

## Extending the App

- Add new networks: provide `NEXT_PUBLIC_<NETWORK>_*` variables and include them in `NEXT_PUBLIC_SUPPORTED_PAIRS`.
- Add tokens: supply `NEXT_PUBLIC_TOKENS_JSON` with per-network OFT addresses.
- Tune executor options: adjust `buildLzReceiveOptions()` or compose more TLVs via `options.ts`.
- UI tweaks: modify `src/app/page.tsx` to add more context to status UI or adjust polling intervals.

## Error Handling & Troubleshooting

- Sending errors: decoded via `decodeOftError()` where possible; UI surfaces a human-readable message.
- Aggregator 401/403: verify `STATUS_API_USERNAME/PASSWORD` on Vercel.
- Infinite loading:
  - Ensure public RPC URLs (`NEXT_PUBLIC_*_RPC_HTTP`) are valid and accessible from the browser.
  - Confirm aggregator base env and credentials.
  - Use `/api/env-check` to validate configuration.

## Security Notes

- Do not include `NEXT_PUBLIC_` for secrets. Use server-only env vars for credentials.
- The aggregator proxy ensures credentials remain server-side and never shipped to the client.