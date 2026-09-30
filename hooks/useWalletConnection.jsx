import { useState, useEffect, useCallback, useMemo } from "react";
import { ethers, BrowserProvider, JsonRpcProvider } from "ethers";

export const useWalletConnection = () => {
    const [account, setAccount] = useState("");
    const [signer, setSigner] = useState(null);
    const [balance, setBalance] = useState(null);
    const [chainId, setChainId] = useState(null);
    const [provider, setProvider] = useState(null);

    const connectWallet = () => {};

    const disconnectWallet = () => {};

    const handleAccountsChanged = () => {};

    const handleChainChanged = () => {};

    const getBalance = () => {};

    useEffect(() => {
        const init = async () => {
            let browserProvider;

            window.dispatchEvent(new Event(EIP6953RequestProvider));

            window.addEventListener(EIP6953AnnounceProvider, (event) => {
                if (event.detail.info.rdns == "io.metamask") {
                    browserProvider = new BrowserProvider(event.detail.provider);
                    console.log(browserProvider);
                    setProvider(browserProvider)
                }
            });

            if (!browserProvider) return;
            
        }
    })





    return {

    };


}