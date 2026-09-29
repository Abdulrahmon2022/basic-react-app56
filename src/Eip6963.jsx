import { useCallback, useEffect, useState } from "react";

// Only these chains are allowed. Users change chains inside their wallet.
const SUPPORTED_CHAINS = {
  1: "Ethereum Mainnet",
  8453: "Base",
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
  const [connectError, setConnectError] = useState("");

  // Derived on every render, so the error appears/disappears in the same
  // render as the chain change (no extra effect tick).
  const unsupportedChain = Boolean(account) && !isSupported(chainId);
  const unsupportedError = unsupportedChain
    ? `Chain ${chainId} is not supported. Open your wallet and switch to ${Object.values(
        SUPPORTED_CHAINS
      ).join(" or ")}.`
    : "";
  const error = unsupportedError || connectError;

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
      else setAccount(accounts[0]);
    };
    const onChainChanged = (id) => setChainId(normalizeChainId(id));
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
          <h2>Connection Established</h2>

          <p>Account Connected: {account}</p>
          <p>
            Chain connected: {chainId}
            {isSupported(chainId) && ` (${SUPPORTED_CHAINS[chainId]})`}
          </p>

          <button onClick={handleDisconnect}>Disconnect</button>
        </div>
      )}
    </div>
  );
};

export default Eip6963;