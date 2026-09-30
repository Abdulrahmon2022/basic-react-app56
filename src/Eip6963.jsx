import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, formatEther } from "ethers";

// Only these chains are allowed. Users can switch to either from the app.
const SUPPORTED_CHAINS = {
  1: {
    name: "Ethereum Mainnet",
    chainId: "0x1",
    chainName: "Ethereum Mainnet",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://ethereum-rpc.publicnode.com"],
    blockExplorerUrls: ["https://etherscan.io"],
  },
  8453: {
    name: "Base",
    chainId: "0x2105",
    chainName: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrls: ["https://basescan.org"],
  },
};

const isSupported = (id) =>
  Object.prototype.hasOwnProperty.call(SUPPORTED_CHAINS, id);

// Wallets are inconsistent: chainChanged may give a hex string ("0x2105"),
// a decimal string ("8453"), or a number. Normalize to a number.
const normalizeChainId = (value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    return value.startsWith("0x") ? parseInt(value, 16) : parseInt(value, 10);
  }
  return 0;
};

const Eip6963 = () => {
  const [providers, setProviders] = useState([]);
  const [activeProvider, setActiveProvider] = useState(null);
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(0);
  const [targetChainId, setTargetChainId] = useState(1);
  const [balance, setBalance] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [connectError, setConnectError] = useState("");

  // Derived on every render, so the error appears/disappears in the same
  // render as the chain change (no extra effect tick).
  const unsupportedChain = Boolean(account) && !isSupported(chainId);
  const unsupportedError = unsupportedChain
    ? `Chain ${chainId} is not supported. Open your wallet and switch to ${Object.values(
        SUPPORTED_CHAINS
      )
        .map((chain) => chain.name)
        .join(" or ")}.`
    : "";
  const error = connectError || unsupportedError;

  // Discover wallets (EIP-6963), dedupe by uuid, and clean up the listener.
  useEffect(() => {
    const onAnnounce = (event) => {
      setProviders((prev) =>
        prev.some((p) => p.info.uuid === event.detail.info.uuid)
          ? prev
          : [...prev, event.detail]
      );
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    return () =>
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  const resetState = useCallback(() => {
    setActiveProvider(null);
    setAccount("");
    setChainId(0);
    setBalance("");
    setConnectError("");
  }, []);

  // Keep the UI in sync with the wallet while connected.
  useEffect(() => {
    if (!activeProvider) return;

    let cancelled = false;

    const syncChain = async () => {
      try {
        const id = await activeProvider.request({ method: "eth_chainId" });
        if (!cancelled) setChainId(normalizeChainId(id));
      } catch (err) {
        console.warn("Could not read chain id:", err);
      }
    };

    const onAccountsChanged = (accounts) => {
      if (!accounts.length) resetState();
      else {
        setAccount(accounts[0]);
        setBalance("");
      }
    };
    const onChainChanged = (chainIdHex) => {
      setChainId(normalizeChainId(chainIdHex));
      setBalance("");
      setConnectError("");
    };
    const onDisconnect = () => resetState();

    activeProvider.on?.("accountsChanged", onAccountsChanged);
    activeProvider.on?.("chainChanged", onChainChanged);
    activeProvider.on?.("disconnect", onDisconnect);

    // Catch any change that happened before the listeners were attached.
    syncChain();

    // Fallback for wallets that don't reliably emit chainChanged:
    // re-check when the tab regains focus and on a short interval.
    const onVisible = () => {
      if (document.visibilityState === "visible") syncChain();
    };
    window.addEventListener("focus", syncChain);
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(syncChain, 1500);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", syncChain);
      document.removeEventListener("visibilitychange", onVisible);
      activeProvider.removeListener?.("accountsChanged", onAccountsChanged);
      activeProvider.removeListener?.("chainChanged", onChainChanged);
      activeProvider.removeListener?.("disconnect", onDisconnect);
    };
  }, [activeProvider, resetState]);

  const handleConnectWallet = async (provider) => {
    setConnectError("");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const id = await provider.request({ method: "eth_chainId" });

      setChainId(normalizeChainId(id));
      setAccount(accounts[0]);
      setBalance("");
      setActiveProvider(provider);
    } catch (err) {
      console.error(err);
      setConnectError(
        err?.code === 4001
          ? "Connection request was rejected."
          : "Failed to connect wallet."
      );
    }
  };

  const handleRefresh = async () => {
    if (!activeProvider || !isSupported(chainId)) return;

    setIsRefreshing(true);
    setConnectError("");
    try {
      const [accounts, id] = await Promise.all([
        activeProvider.request({ method: "eth_accounts" }),
        activeProvider.request({ method: "eth_chainId" }),
      ]);

      if (!accounts.length) {
        resetState();
        return;
      }

      const walletProvider = new BrowserProvider(activeProvider);
      const latestBalance = await walletProvider.getBalance(accounts[0]);

      setAccount(accounts[0]);
      setChainId(normalizeChainId(id));
      setBalance(formatEther(latestBalance));
    } catch (err) {
      console.error("Could not refresh wallet data:", err);
      setConnectError("Failed to refresh wallet data.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSwitchChain = async () => {
    if (!activeProvider) return;

    const targetChain = SUPPORTED_CHAINS[targetChainId];
    setConnectError("");
    try {
      await activeProvider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetChain.chainId }],
      });
    } catch (err) {
      if (err?.code === 4902) {
        try {
          await activeProvider.request({
            method: "wallet_addEthereumChain",
            params: [targetChain],
          });
          await activeProvider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: targetChain.chainId }],
          });
        } catch (addError) {
          console.error("Could not add the selected network:", addError);
          setConnectError(
            addError?.code === 4001
              ? "Adding the network was rejected."
              : "Could not add the selected network to your wallet."
          );
          return;
        }
      } else {
        console.error("Could not switch networks:", err);
        setConnectError(
          err?.code === 4001
            ? "Network switch was rejected."
            : "Could not switch networks."
        );
      }
    }
  };

  const handleDisconnect = async () => {
    // EIP-1193 has no standard "disconnect" method. Where supported
    // (e.g. MetaMask), revoke the site's permission so it truly disconnects.
    try {
      await activeProvider?.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch (err) {
      // Wallet doesn't support revoking; clearing local state is the fallback.
      console.warn("wallet_revokePermissions not supported:", err);
    }
    resetState();
  };

  return (
    <div>
      {!account &&
        providers.map((provider) => (
          <div
            key={provider.info.uuid}
            style={{ display: "flex", gap: "10px", alignItems: "center" }}
          >
            <img
              src={provider.info.icon}
              alt={provider.info.name}
              width={50}
              height={50}
            />
            <p>{provider.info.name}</p>
            <button onClick={() => handleConnectWallet(provider.provider)}>
              connect {provider.info.name}
            </button>
          </div>
        ))}

      {error && (
        <div role="alert" style={{ color: "crimson", margin: "12px 0" }}>
          {error}
        </div>
      )}

      {account && (
        <div>
          <h2>Connection Established!</h2>

          <p>Account Connected: {account}</p>
          <p>
            Chain connected: {chainId}
            {isSupported(chainId) && ` (${SUPPORTED_CHAINS[chainId].name})`}
          </p>
          <p>Balance: {balance ? `${balance} ETH` : "Not loaded"}</p>

          {unsupportedChain && (
            <div>
              <label htmlFor="target-chain">Switch to: </label>
              <select
                id="target-chain"
                value={targetChainId}
                onChange={(event) => setTargetChainId(Number(event.target.value))}
              >
                {Object.entries(SUPPORTED_CHAINS).map(([id, chain]) => (
                  <option key={id} value={id}>
                    {chain.name}
                  </option>
                ))}
              </select>
              <button onClick={handleSwitchChain}>Switch network</button>
            </div>
          )}

          <button
            onClick={handleRefresh}
            disabled={isRefreshing || unsupportedChain}
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
          <button onClick={handleDisconnect}>Disconnect</button>
        </div>
      )}
    </div>
  );
};

export default Eip6963;