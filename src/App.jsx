import { useEffect, useRef, useState } from "react";
import Eip6963 from "./Eip6963";

// Pick MetaMask if several wallets are injected
function getProvider() {
  const eth = window.ethereum;
  if (!eth) return null;
  if (eth.providers?.length) {
    return eth.providers.find((p) => p.isMetaMask) || eth.providers[0];
  }
  return eth;
}

// Works for both "0x89" and 137
const toChainId = (value) => Number(value);

function App() {
  const [connected, setConnected] = useState(false);
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState(null);

  // Lets the wallet listeners know whether the user has clicked Connect
  const connectedRef = useRef(false);

  const disconnect = () => {
    connectedRef.current = false;
    setConnected(false);
    setAccount("");
    setChainId(null);
  };

  useEffect(() => {
    const provider = getProvider();
    if (!provider) {
      console.error("No wallet found. Install MetaMask.");
      return;
    }

    const refreshChainId = async () => {
      const id = await provider.request({ method: "eth_chainId" });
      setChainId(toChainId(id));
    };

    const handleAccountsChanged = (accounts) => {
      if (!connectedRef.current) return; // ignore until the user connects
      if (accounts.length === 0) {
        disconnect();
        return;
      }
      setAccount(accounts[0]);
      refreshChainId().catch(console.error);
    };

    const handleChainChanged = (id) => {
      if (!connectedRef.current) return;
      setChainId(toChainId(id));
    };

    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("chainChanged", handleChainChanged);

    // Fallback: re-read the chain every second, only while connected
    const interval = setInterval(() => {
      if (connectedRef.current) refreshChainId().catch(() => {});
    }, 1000);

    return () => {
      clearInterval(interval);
      provider.removeListener("accountsChanged", handleAccountsChanged);
      provider.removeListener("chainChanged", handleChainChanged);
    };
  }, []);

  async function connectWallet() {
    const provider = getProvider();
    if (!provider) return;
    try {
      const accounts = await provider.request({
        method: "eth_requestAccounts",
      });
      if (accounts.length === 0) return;
      const id = await provider.request({ method: "eth_chainId" });

      connectedRef.current = true;
      setConnected(true);
      setAccount(accounts[0]);
      setChainId(toChainId(id));
    } catch (err) {
      console.error("User rejected the request", err);
    }
  }

  return (
    <div>
      <Eip6963 />

      <h1 style={{ margin: "20px" }}>EIP 1193</h1>

      {!connected && <button onClick={connectWallet}>Connect Wallet</button>}

      {connected && (
        <>
          <p>Account: {account}</p>
          {chainId !== null && <p>Chain ID: {chainId}</p>}
        </>
      )}
    </div>
  );
}

export default App;