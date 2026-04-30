import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function usePricingFlowState(proveedor: string) {
    const { data, error, mutate } = useSWR(
        proveedor ? `/api/precios/flow-state?proveedor=${encodeURIComponent(proveedor)}` : null,
        fetcher,
        { refreshInterval: 30000 } // 30s cache/poll
    );

    return {
        flowState: data,
        isLoading: !error && !data,
        isError: error,
        mutate
    };
}
