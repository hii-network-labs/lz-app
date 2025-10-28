"use client";

import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { getNetworkKeys, getNetworkConfig, getSupportedPairs, getTokensConfig } from "@/lib/config";
import { buildSendParam, getSignedOftContractAt, decodeOftError, getProvider, getOftContractAt } from "@/lib/contracts";
import { buildLzReceiveOptions } from "@/lib/options";
import oftAbi from "@/lib/abi/oft.json";

// Define transaction history type
interface TxHistory {
  sourceNetwork: string;
  destNetwork: string;
  amount: string;
  receiver: string;
  txHash: string;
  status: string;
}

export default function Home() {
  // State variables
  const [sourceNetwork, setSourceNetwork] = useState("");
  const [destNetwork, setDestNetwork] = useState("");
  const [amount, setAmount] = useState("");
  const [receiverAddress, setReceiverAddress] = useState("");
  const [tokenId, setTokenId] = useState<string>("");
  const [tokenDecimals, setTokenDecimals] = useState<number>(18);
  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);
  const [balanceFormatted, setBalanceFormatted] = useState<string>("");
  const [txHash, setTxHash] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [account, setAccount] = useState("");
  const [currentChainId, setCurrentChainId] = useState<number | null>(null);
  
  // Supported pairs and restrictions
  const supportedPairs = getSupportedPairs();
  const networkKeys = getNetworkKeys();
  const tokens = getTokensConfig();
  const allowedSources = Array.from(new Set(supportedPairs.map((p) => p.src))).filter((k) => networkKeys.includes(k));
  const allowedDestForSourceBase = sourceNetwork ? supportedPairs.filter((p) => p.src === sourceNetwork).map((p) => p.dst) : [];
  const tokenSupportedNetworks = tokenId ? Object.keys(tokens.find(t => t.id === tokenId)?.addresses || {}) : [];
  const allowedDestForSource = sourceNetwork ? (tokenId ? allowedDestForSourceBase.filter((dst) => tokenSupportedNetworks.includes(dst)) : allowedDestForSourceBase) : [];
  const allowedSourcesFilteredByToken = tokenId ? allowedSources.filter((src) => tokenSupportedNetworks.includes(src)) : allowedSources;
  const isPairSupported = !!(sourceNetwork && destNetwork && supportedPairs.some((p) => p.src === sourceNetwork && p.dst === destNetwork));
  
  // Network options
  // using networkKeys above
  
  // Handlers for wallet events
  const handleAccountsChanged = (accounts: string[]) => {
    const addr = accounts[0] || "";
    setAccount(addr);
    setReceiverAddress(addr);
  };
  
  const handleChainChanged = (chainId: string) => {
    setCurrentChainId(parseInt(chainId, 16));
  };
  
  // Explicit wallet actions
  const connectWallet = async () => {
    if (!window.ethereum) {
      setError("MetaMask is not installed");
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const addr = accounts[0] || "";
      setAccount(addr);
      setReceiverAddress(addr);
      const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
      setCurrentChainId(parseInt(chainIdHex, 16));
    } catch (err: any) {
      console.error("Error connecting wallet", err);
      setError(err.message || "Failed to connect wallet");
    }
  };
  
  const changeAccount = async () => {
    if (!window.ethereum) {
      setError("MetaMask is not installed");
      return;
    }
    try {
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      handleAccountsChanged(accounts);
    } catch (err: any) {
      console.error("Error changing account", err);
      setError(err.message || "Failed to change account");
    }
  };
  
  const disconnectWallet = () => {
    try {
      if (window.ethereum) {
        window.ethereum.removeListener("accountsChanged", handleAccountsChanged as any);
        window.ethereum.removeListener("chainChanged", handleChainChanged as any);
      }
    } catch {}
    setAccount("");
    setReceiverAddress("");
    setCurrentChainId(null);
    setTxHash("");
    setStatus("");
    setError("");
  };
  
  // Initialize wallet connection
  useEffect(() => {
    const init = async () => {
      if (!window.ethereum) {
        setError("MetaMask is not installed");
        return;
      }
      try {
        const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
        setCurrentChainId(parseInt(chainIdHex, 16));
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        handleAccountsChanged(accounts);
        window.ethereum.on("accountsChanged", handleAccountsChanged as any);
        window.ethereum.on("chainChanged", handleChainChanged as any);
      } catch (err) {
        console.error("Error initializing wallet", err);
      }
    };
    init();
    return () => {
      try {
        if (window.ethereum) {
          window.ethereum.removeListener("accountsChanged", handleAccountsChanged as any);
          window.ethereum.removeListener("chainChanged", handleChainChanged as any);
        }
      } catch {}
    };
  }, []);
  
  // Set default source/destination networks when chainId is known (only if not chosen yet)
  useEffect(() => {
    if (!currentChainId) return;
    const matchingNetwork = networkKeys.find(key => {
      const config = getNetworkConfig(key);
      return config.chainId === currentChainId;
    });
    if (matchingNetwork) {
      // Only set defaults when no selection has been made yet
      setSourceNetwork(prev => prev || matchingNetwork);
      setDestNetwork(prev => {
        if (prev) return prev;
        const firstAllowed = supportedPairs.find((p) => p.src === matchingNetwork)?.dst;
        if (firstAllowed) return firstAllowed;
        const otherNetwork = networkKeys.find(key => key !== matchingNetwork);
        return otherNetwork || "";
      });
    }
  }, [currentChainId]);

  // When token selection changes, adjust destination if it becomes unsupported
  useEffect(() => {
    if (!tokenId || !sourceNetwork) return;
    if (destNetwork && !allowedDestForSource.includes(destNetwork)) {
      const next = allowedDestForSource[0] || "";
      setDestNetwork(next);
    }
  }, [tokenId, sourceNetwork]);

  // Fetch user's token balance on source network for selected token
  useEffect(() => {
    const run = async () => {
      try {
        if (!sourceNetwork || !tokenId || !account) {
          setBalanceWei(null);
          setBalanceFormatted("");
          return;
        }
        const token = tokens.find(t => t.id === tokenId);
        const oftAddress = token?.addresses?.[sourceNetwork];
        if (!oftAddress) {
          setBalanceWei(null);
          setBalanceFormatted("");
          return;
        }
        const oft = getOftContractAt(sourceNetwork, oftAddress);
        const underlying: string = await oft.token();
        const provider = getProvider(sourceNetwork);
        const erc20Abi = [
          {
            inputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
            name: 'balanceOf',
            outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
            stateMutability: 'view',
            type: 'function',
          },
          {
            inputs: [],
            name: 'decimals',
            outputs: [{ internalType: 'uint8', name: '', type: 'uint8' }],
            stateMutability: 'view',
            type: 'function',
          },
        ];
        const erc20 = new ethers.Contract(underlying, erc20Abi, provider);
        const d: number = await erc20.decimals();
        const bal: bigint = await erc20.balanceOf(account);
        const safeDec = (typeof d === 'number' && Number.isFinite(d)) ? d : 18;
        setTokenDecimals(safeDec);
        setBalanceWei(bal);
        setBalanceFormatted(ethers.formatUnits(bal, safeDec));
      } catch (e) {
        console.warn('[lz] balance fetch failed', e);
        setBalanceWei(null);
        setBalanceFormatted("");
      }
    };
    run();
  }, [sourceNetwork, tokenId, account]);
  
  // Switch network function
  const switchNetwork = async () => {
    if (!sourceNetwork) return;
    
    const config = getNetworkConfig(sourceNetwork);
    
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + config.chainId.toString(16) }],
      });
    } catch (error: any) {
      // Chain doesn't exist, add it
      if (error.code === 4902) {
        try {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0x" + config.chainId.toString(16),
                chainName: config.name,
                rpcUrls: [config.rpcHttp],
              },
            ],
          });
        } catch (addError) {
          console.error("Error adding chain", addError);
          setError("Failed to add chain to MetaMask");
        }
      } else {
        console.error("Error switching chain", error);
        setError("Failed to switch network");
      }
    }
  };
  
  // Removed explicit fee estimation per request; fee is quoted inside send
  
  // Send cross-chain function
  const sendCrossChain = async () => {
    if (!sourceNetwork || !destNetwork || !amount || !receiverAddress) {
      setError("Please fill all fields");
      return;
    }
    if (!account) {
      setError("Please connect your wallet");
      return;
    }
    if (!tokenId) {
      setError("Please choose a token");
      return;
    }
    if (!isPairSupported) {
      setError("Unsupported source/destination pair");
      return;
    }
    
    if (!window.ethereum) {
      setError("MetaMask is not installed");
      return;
    }
    
    try {
      setStatus("Sending...");
      setError("");
      
      // Check if on correct network
      const config = getNetworkConfig(sourceNetwork);
      if (currentChainId !== config.chainId) {
        await switchNetwork();
      }
      
      // Get signer
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      
      // Resolve 'max' to full balance
      const resolvedAmount = amount.trim().toLowerCase() === 'max' ? (balanceFormatted || '') : amount;
      if (!resolvedAmount) {
        setError("Balance not loaded; connect wallet and choose token");
        setStatus("Error");
        return;
      }

      // Get contract
      const token = tokens.find(t => t.id === tokenId);
      const oftAddress = token?.addresses?.[sourceNetwork];
      if (!oftAddress) {
        setError("Selected token is not supported on source network");
        return;
      }
      const oft = getSignedOftContractAt(sourceNetwork, oftAddress, signer);
      // Fetch underlying token decimals to normalize amount like the reference script
      let decimals = 18;
      try {
        const underlying: string = await oft.token();
        const erc20Abi = [{
          inputs: [],
          name: "decimals",
          outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
          stateMutability: "view",
          type: "function",
        }];
        const erc20 = new ethers.Contract(underlying, erc20Abi, signer);
        const d: number = await erc20.decimals();
        decimals = d || 18;
        console.log("[lz] underlying token decimals", decimals);
      } catch (decErr) {
        console.warn("[lz] decimals fetch failed, defaulting to 18", decErr);
      }

      // Validate amount against balance
      try {
        const amtLD = ethers.parseUnits(resolvedAmount, decimals ?? 18);
        if (balanceWei != null && amtLD > balanceWei) {
          setError("Amount exceeds balance");
          setStatus("Error");
          return;
        }
        if (amtLD <= 0n) {
          setError("Amount must be greater than zero");
          setStatus("Error");
          return;
        }
      } catch (parseErr) {
        setError("Invalid amount format");
        setStatus("Error");
        return;
      }
      
      // Resolve enforced options and build a valid local options TLV (lzReceive gas)
      const dstConfig = getNetworkConfig(destNetwork);
      let localOptions = "0x";
      let combinedOptions = "0x";
      try {
        const msgType: number = await oft.SEND();
        const enforced: string = await oft.enforcedOptions(dstConfig.eid, msgType);
        console.log("[lz] enforcedOptions", { dstEid: dstConfig.eid, msgType, enforced });
        // Build minimal lzReceive option (200k gas, 0 value) and merge with enforced via combineOptions
        localOptions = buildLzReceiveOptions(200_000, 0);
        combinedOptions = await oft.combineOptions(dstConfig.eid, msgType, localOptions);
        console.log("[lz] combinedOptions", { dstEid: dstConfig.eid, msgType, combinedOptions });
      } catch (optErr) {
        console.warn("[lz] options combine failed", optErr);
      }

      // Build send params
      const sendParam = buildSendParam(sourceNetwork, destNetwork, resolvedAmount, receiverAddress, decimals, combinedOptions || localOptions);
      console.log("[lz] sendParam", sendParam);
      
      // Quote fee
      const fee = await oft.quoteSend(sendParam, false);
      try {
        console.log("[lz] quoted fee", {
          nativeFee: fee?.nativeFee?.toString?.() ?? fee?.nativeFee,
          lzTokenFee: fee?.lzTokenFee?.toString?.() ?? fee?.lzTokenFee,
        });
      } catch {}
      
      // Send transaction
      let tx;
      try {
        tx = await oft.send(
          sendParam,
          { nativeFee: fee.nativeFee, lzTokenFee: fee.lzTokenFee },
          await signer.getAddress(),
          { value: fee.nativeFee }
        );
      } catch (sendErr: any) {
        const msg = sendErr?.info?.error?.data?.message || sendErr?.message || "";
        const isTrieMissing = typeof msg === "string" && msg.includes("missing trie node");
        console.warn("[lz] contract.send failed, fallback to raw sendTransaction", { msg });
        if (!isTrieMissing) throw sendErr;
        // Fallback: raw transaction encode, manual gas limit, legacy type (like Forge --legacy)
        const iface = new ethers.Interface(oftAbi as any);
        const data = iface.encodeFunctionData("send", [
          sendParam,
          { nativeFee: fee.nativeFee, lzTokenFee: fee.lzTokenFee },
          await signer.getAddress(),
        ]);
        // Provide explicit gasPrice (legacy) using fee data
        const feeData = await provider.getFeeData().catch(() => undefined);
        const gasPrice = feeData?.gasPrice ?? feeData?.maxFeePerGas;
        console.log("[lz] fallback raw sendTransaction", { gasLimit: "600000", gasPrice: gasPrice ? gasPrice.toString() : undefined });
        tx = await signer.sendTransaction({
          to: oft.target as string,
          data,
          value: fee.nativeFee,
          gasLimit: 600000n,
          gasPrice,
          type: 0,
        } as any);
      }
      console.log("[lz] tx sent", { hash: tx.hash });

      setTxHash(tx.hash);
      setStatus("Transaction sent");
      // Reset LayerZero worker status until we refetch
      setLzWorkerStatus(null);
      
      // Wait for receipt
      const receipt = await tx.wait();
      console.log("[lz] tx confirmed", { blockNumber: receipt?.blockNumber, status: receipt?.status });
      setStatus("Transaction confirmed");
      
      // Save to history (optional)
      saveToHistory({
        sourceNetwork,
        destNetwork,
        amount,
        receiver: receiverAddress,
        txHash: tx.hash,
        status: "Success",
      });
    } catch (error: any) {
      const decoded = decodeOftError(error) || decodeOftError(error?.data) || decodeOftError(error?.cause);
      console.error("[lz] Error sending cross-chain", { error, decoded });
      const rpcData = error?.data?.data || error?.data;
      const msg = decoded || error?.message || "Failed to send cross-chain transaction";
      setError(`${msg}${rpcData ? ` | data: ${rpcData}` : ""}`);
      setStatus("Error");
    }
  };

  // LayerZero Worker Status state and fetcher
  const [lzWorkerStatus, setLzWorkerStatus] = React.useState<{
    stage: string;
    networkBase?: string | null;
    dvn?: string | null;
    sealer?: string | null;
    dest?: string | null;
    dstTx?: string | null;
  } | null>(null);

  // External aggregator status (steps-based)
  interface AggStep { name: string; done: boolean; txHash?: string; chainId?: number; timestamp?: number }
  interface AggStatus { guid?: string; srcChainId?: number; dstChainId?: number; currentStatus?: string; steps?: AggStep[] }
  const [aggStatus, setAggStatus] = React.useState<AggStatus | null>(null);
  const STATUS_POLL_MS = parseInt(process.env.NEXT_PUBLIC_STATUS_POLL_MS || '5000');

  // Helper: map chainId to explorer base if configured
  const getExplorerByChainId = (chainId?: number): string | undefined => {
    if (!chainId) return undefined;
    try {
      const keys = getNetworkKeys();
      for (const k of keys) {
        const cfg = getNetworkConfig(k);
        if (cfg.chainId === chainId) return cfg.explorerTxBase;
      }
    } catch {}
    return undefined;
  };

  const getNetworkNameByChainId = (chainId?: number): string | undefined => {
    if (!chainId) return undefined;
    try {
      const keys = getNetworkKeys();
      for (const k of keys) {
        const cfg = getNetworkConfig(k);
        if (cfg.chainId === chainId) return cfg.name;
      }
    } catch {}
    return undefined;
  };

  React.useEffect(() => {
    if (!txHash) return;
    let stopped = false;
    const tick = async () => {
      try {
        // External aggregator
        const statusApiBase = process.env.NEXT_PUBLIC_STATUS_API_BASE;
        if (statusApiBase) {
          try {
            const res = await fetch(`${statusApiBase}/api/tx/by-hash/${txHash}`);
            if (res.ok) {
              const json = await res.json();
              setAggStatus(json);
              if (json?.currentStatus === 'executed') {
                stopped = true;
              }
            } else {
              setAggStatus(null);
            }
          } catch {
            setAggStatus(null);
          }
        } else {
          setAggStatus(null);
        }

        // Fallback: on-chain status
        const useOnChain = sourceNetwork === 'hii' || destNetwork === 'hii';
        const isTestnet = sourceNetwork === 'sepolia' || destNetwork === 'sepolia';
        const url = useOnChain ? '/api/lz-status-onchain' : '/api/lz-status';
        const body = useOnChain
          ? { txHash, sourceNetwork, destNetwork, tokenId }
          : { txHash, network: isTestnet ? 'testnet' : undefined };
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res.ok) {
          setLzWorkerStatus({ stage: 'unknown' });
        } else {
          const json = await res.json();
          const dvn = json?.verification?.dvn?.status ?? null;
          const sealer = json?.verification?.sealer?.status ?? null;
          const dest = json?.destination?.status ?? null;
          const dstTx = json?.destination?.tx?.txHash ?? json?.destination?.txHash ?? null;
          setLzWorkerStatus({
            stage: json?.stage || 'unknown',
            networkBase: json?.networkBase || null,
            dvn,
            sealer,
            dest,
            dstTx,
          });
        }
      } catch (e) {
        setLzWorkerStatus({ stage: 'unknown' });
      }
    };
    tick();
    const id = setInterval(() => {
      if (!stopped) tick();
    }, STATUS_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [txHash, sourceNetwork, destNetwork, tokenId]);

  // Save transaction to history
  const saveToHistory = (tx: any) => {
    try {
      const history = JSON.parse(localStorage.getItem("txHistory") || "[]");
      const newHistory = [tx, ...history].slice(0, 5); // Keep only last 5 transactions
      localStorage.setItem("txHistory", JSON.stringify(newHistory));
    } catch (error) {
      console.error("Error saving to history", error);
    }
  };
  
  return (
    <main className="flex min-h-screen flex-col items-center justify-between p-4 md:p-24">
      <div className="z-10 max-w-5xl w-full items-center justify-between font-mono text-sm">
        <h1 className="text-2xl font-bold mb-4 text-center">LayerZero Cross-Chain Token Transfer</h1>
        <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-900/20 p-4">
          <p className="text-sm">
            Supported pairs:
            {supportedPairs.map((p, idx) => {
              const srcName = getNetworkConfig(p.src).name;
              const dstName = getNetworkConfig(p.dst).name;
              return (
                <span key={`${p.src}-${p.dst}-${idx}`}> {srcName} → {dstName}{idx < supportedPairs.length - 1 ? "," : ""}</span>
              );
            })}
          </p>
          {!isPairSupported && (sourceNetwork || destNetwork) && (
            <p className="mt-1 text-xs text-blue-700 dark:text-blue-300">Selected pair is not supported. Choose a supported combination.</p>
          )}
        </div>
        
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md mb-6">
          <div className="mb-4">
            <p className="text-sm text-gray-500 mb-1">Connected Account</p>
            <p className="font-mono text-sm truncate">{account || "Not connected"}</p>
            <div className="mt-2 flex gap-2">
              {!account ? (
                <button
                  className="bg-blue-500 hover:bg-blue-600 text-white py-1 px-3 rounded text-sm"
                  onClick={connectWallet}
                >
                  Connect Wallet
                </button>
              ) : (
                <>
                  <button
                    className="bg-indigo-500 hover:bg-indigo-600 text-white py-1 px-3 rounded text-sm"
                    onClick={changeAccount}
                  >
                    Change Account
                  </button>
                  <button
                    className="bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded text-sm"
                    onClick={disconnectWallet}
                  >
                    Disconnect
                  </button>
                </>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-1">Source Network</label>
              <select
                className="w-full p-2 border rounded"
                value={sourceNetwork}
                onChange={(e) => {
                  const src = e.target.value;
                  setSourceNetwork(src);
                  const firstAllowed = supportedPairs.find((p) => p.src === src)?.dst;
                  if (firstAllowed) setDestNetwork(firstAllowed);
                }}
              >
                <option value="">Select Source Network</option>
                {allowedSourcesFilteredByToken.map((key) => (
                  <option key={key} value={key}>
                    {getNetworkConfig(key).name}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Destination Network</label>
              <select
                className="w-full p-2 border rounded"
                value={destNetwork}
                onChange={(e) => setDestNetwork(e.target.value)}
              >
                <option value="">Select Destination Network</option>
                {(allowedDestForSource.length > 0 ? allowedDestForSource : networkKeys.filter((key) => key !== sourceNetwork)).map((key) => (
                  <option key={key} value={key}>
                    {getNetworkConfig(key).name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Token</label>
            <select
              className="w-full p-2 border rounded"
              value={tokenId}
              onChange={(e) => setTokenId(e.target.value)}
            >
              <option value="">Select Token</option>
              {tokens
                .filter((t) => {
                  // Token must support source and destination if both chosen
                  if (sourceNetwork && destNetwork) {
                    return t.addresses[sourceNetwork] && t.addresses[destNetwork];
                  }
                  // If only source chosen, token must support source
                  if (sourceNetwork && !destNetwork) {
                    return t.addresses[sourceNetwork];
                  }
                  // If only token filtering the networks, show all tokens
                  return true;
                })
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.symbol} ({t.name})
                  </option>
                ))}
            </select>
          </div>
          {!isPairSupported && (
            <div className="p-2 rounded bg-yellow-50 border border-yellow-200 text-yellow-800 text-xs mb-4">
              Unsupported pair. Please choose one of the supported combinations above.
            </div>
          )}
          
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Amount</label>
            <div className="flex gap-2">
              <input
                type="text"
                className="flex-1 p-2 border rounded"
                placeholder="Enter amount or type 'max'"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {account && sourceNetwork && tokenId && (
                <button
                  type="button"
                  className="px-3 py-2 border rounded bg-gray-100 hover:bg-gray-200"
                  onClick={() => { if (balanceFormatted) setAmount(balanceFormatted); }}
                  disabled={!balanceFormatted}
                >
                  Max
                </button>
              )}
            </div>
            {account && sourceNetwork && tokenId && (
              <p className="mt-1 text-xs text-gray-500">
                Balance: {balanceFormatted ? balanceFormatted : 'Loading…'}
              </p>
            )}
          </div>
          
          <div className="mb-6">
            <label className="block text-sm font-medium mb-1">Receiver Address</label>
            <input
              type="text"
              className="w-full p-2 border rounded font-mono text-sm"
              placeholder="0x..."
              value={receiverAddress}
              onChange={(e) => setReceiverAddress(e.target.value)}
            />
          </div>
          
          <div className="flex flex-col md:flex-row gap-2 mb-6">
            <button
              className={`bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded ${!isPairSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={switchNetwork}
              disabled={!isPairSupported}
            >
              Switch to Source Network
            </button>
            <button
              className={`bg-green-500 hover:bg-green-600 text-white py-2 px-4 rounded ${!isPairSupported ? 'opacity-50 cursor-not-allowed' : ''}`}
              onClick={sendCrossChain}
              disabled={!isPairSupported}
            >
              Send Cross-Chain
            </button>
          </div>

          
          {txHash && (
            <div className="mb-4 p-3 bg-gray-100 dark:bg-gray-700 rounded">
              <p className="text-sm font-medium">Transaction Hash</p>
              <p className="font-mono text-sm truncate">{txHash}</p>
              <p className="text-sm mt-1">Status: {status}</p>
              {sourceNetwork && (
                <a
                  href={`${(getNetworkConfig(sourceNetwork).explorerTxBase || (sourceNetwork === 'sepolia' ? 'https://eth-sepolia.blockscout.com/tx/' : 'http://115.75.100.60:8067/tx/'))}${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline text-sm"
                >
                  View on Explorer
                </a>
              )}
              <div className="mt-3">
                <p className="text-sm font-medium">Cross-Chain Worker Status</p>
                <p className="text-sm">{aggStatus?.currentStatus ? aggStatus.currentStatus : (lzWorkerStatus?.stage || 'unknown')}</p>
                {lzWorkerStatus && (
                  <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                    {lzWorkerStatus.dvn && <p>DVN: {lzWorkerStatus.dvn}</p>}
                    {lzWorkerStatus.sealer && <p>Sealer: {lzWorkerStatus.sealer}</p>}
                    {lzWorkerStatus.dest && <p>Destination: {lzWorkerStatus.dest}</p>}
                    {lzWorkerStatus.dstTx && (
                      <p>
                        Destination Tx: <a href={`${(getNetworkConfig(destNetwork || sourceNetwork || '').explorerTxBase || '')}${lzWorkerStatus.dstTx}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{lzWorkerStatus.dstTx}</a>
                      </p>
                    )}
                  </div>
                )}
                {aggStatus?.steps && aggStatus.steps.length > 0 && (
                  <div className="mt-2">
                    <p className="text-sm font-medium">Worker Steps</p>
                    <ul className="mt-1 space-y-1">
                      {(['sent','dvn_verifying','committed','executed'] as const).map((stepName) => {
                        const s = (aggStatus.steps || []).find((x) => x.name === stepName);
                        const base = getExplorerByChainId(s?.chainId);
                        const chainName = getNetworkNameByChainId(s?.chainId) || '';
                        return (
                          <li key={stepName} className="text-xs text-gray-700 dark:text-gray-300 flex items-center gap-2">
                            <span className={`inline-block px-2 py-0.5 rounded ${s?.done ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                              {stepName}{s?.done ? ': SUCCEEDED' : ': PENDING'}
                            </span>
                            {chainName && <span className="inline-flex items-center text-gray-600">🌐 {chainName}</span>}
                            {s?.txHash && (
                              <span>
                                {base ? (
                                  <a href={`${base}${s.txHash}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{s.txHash}</a>
                                ) : (
                                  <span className="font-mono">{s.txHash}</span>
                                )}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {aggStatus.guid && (
                      <p className="mt-2 text-xs">GUID: <span className="font-mono">{aggStatus.guid}</span></p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          
          {error && (
            <div className="p-3 bg-red-100 text-red-700 rounded mb-4">
              <p className="text-sm">{error}</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
