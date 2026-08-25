import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AddonContext, UnlistenFn } from "@wealthfolio/addon-sdk";
import { buildExposureModel } from "@/domain/exposure";
import { getSnapshotStatus } from "@/domain/etf";
import { normalizeHolding, buildPortfolioModel } from "@/domain/portfolio";
import { EtfCache } from "@/storage/etfCache";
import {
  loadAddonSettings,
  reconcileAccountSelection,
  saveAddonSettings,
  setSelectedAccounts,
} from "@/storage/settings";
import { FxService, TWELVE_DATA_SECRET } from "@/services/fx/fxService";
import { createProviders, resolveEtfHoldings } from "@/services/etf/providers";
import { getActiveAccounts, loadHoldingRows, loadPortfolioBaseCurrency } from "@/services/wealthfolio/client";
import type {
  AddonSettings,
  EtfDataRow,
  EtfHoldingsSnapshot,
  FxQuote,
  NormalizedHolding,
  PortfolioAccount,
  PortfolioModel,
  ExposureModel,
  AssetType,
} from "@/types/domain";

interface RuntimeState {
  loading: boolean;
  error: string | null;
  baseCurrency: string | null;
  activeAccounts: PortfolioAccount[];
  selectedAccounts: PortfolioAccount[];
  settings: AddonSettings;
  holdings: NormalizedHolding[];
  portfolio: PortfolioModel;
  exposure: ExposureModel;
  fxQuote: FxQuote | null;
  snapshots: Map<string, EtfHoldingsSnapshot>;
  etfData: EtfDataRow[];
  newlyIncludedAccounts: PortfolioAccount[];
  hasTwelveDataKey: boolean;
  hasAlphaVantageKey: boolean;
  lastLoadedAt: string | null;
}

const emptySettings: AddonSettings = {
  schemaVersion: 1,
  selectionInitialized: false,
  selectedAccountIds: [],
  acknowledgedAccountIds: [],
  liveFxPolling: true,
  providerModes: {},
  pinnedProviders: {},
  typeOverrides: {},
  aliases: {},
};

const emptyPortfolio = buildPortfolioModel([], []);
const emptyExposure = buildExposureModel({ holdings: [], snapshots: new Map(), totalAud: null });

function initialState(): RuntimeState {
  return {
    loading: true,
    error: null,
    baseCurrency: null,
    activeAccounts: [],
    selectedAccounts: [],
    settings: emptySettings,
    holdings: [],
    portfolio: emptyPortfolio,
    exposure: emptyExposure,
    fxQuote: null,
    snapshots: new Map(),
    etfData: [],
    newlyIncludedAccounts: [],
    hasTwelveDataKey: false,
    hasAlphaVantageKey: false,
    lastLoadedAt: null,
  };
}

export function usePortfolioData(ctx: AddonContext): RuntimeState & {
  refresh: (options?: { forceFx?: boolean }) => Promise<void>;
  refreshEtf: (etfKey: string) => Promise<void>;
  saveSnapshot: (snapshot: EtfHoldingsSnapshot, expectedVersion?: number) => Promise<void>;
  disableSnapshot: (etfKey: string) => Promise<void>;
  saveAccountSelection: (accountIds: string[]) => Promise<void>;
  saveSecret: (secretKey: string, value: string) => Promise<void>;
  deleteSecret: (secretKey: string) => Promise<void>;
  setLiveFxPolling: (enabled: boolean) => Promise<void>;
  setTypeOverride: (key: string, type: AssetType) => Promise<void>;
  setProviderMode: (key: string, mode: "auto" | "pinned") => Promise<void>;
  setPinnedProvider: (key: string, provider: string) => Promise<void>;
} {
  const [state, setState] = useState<RuntimeState>(initialState);
  const [refreshToken, setRefreshToken] = useState(0);
  const mounted = useRef(true);

  const refresh = useCallback(async (options: { forceFx?: boolean } = {}) => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [activeAccounts, loadedSettings, baseCurrency, hasTwelveDataKey, hasAlphaVantageKey] = await Promise.all([
        getActiveAccounts(ctx),
        loadAddonSettings(ctx),
        loadPortfolioBaseCurrency(ctx),
        ctx.api.secrets.get(TWELVE_DATA_SECRET).then((value) => Boolean(value)),
        ctx.api.secrets.get("alphaVantage.apiKey").then((value) => Boolean(value)),
      ]);
      const selection = reconcileAccountSelection(loadedSettings, activeAccounts);
      if (JSON.stringify(selection.settings) !== JSON.stringify(loadedSettings)) {
        await saveAddonSettings(ctx, selection.settings);
      }
      const fxQuote = await new FxService(ctx).getQuote({ force: options.forceFx });
      const holdingRows = await loadHoldingRows(ctx, activeAccounts, selection.settings.selectedAccountIds);
      const holdings = holdingRows.map((row) => {
        const overrideKey = row.profile?.instrumentKey || row.profile?.id || row.holding.instrument?.id;
        return normalizeHolding(row.holding, row.account, row.profile, fxQuote, overrideKey ? selection.settings.typeOverrides[overrideKey] : undefined);
      });
      const portfolio = buildPortfolioModel(holdings, selection.settings.selectedAccountIds);
      const records = await new EtfCache(ctx).list();
      const snapshots = new Map(records.map((record) => [record.etfKey, record.snapshot]));
      const exposure = buildExposureModel({
        holdings,
        snapshots,
        totalAud: portfolio.totalAud,
        aliases: selection.settings.aliases,
      });
      const etfData = portfolio.etfs.map((asset) => {
        const snapshot = snapshots.get(asset.etfKey) ?? null;
        const record = records.find((candidate) => candidate.etfKey === asset.etfKey);
        return {
          asset,
          snapshot,
          version: record?.version,
          status: getSnapshotStatus(snapshot),
          resolvedWeight: snapshot?.weightSum ?? 0,
          failureReason: snapshot?.failureReason,
        };
      });
      if (mounted.current) {
        setState({
          loading: false,
          error: null,
          baseCurrency,
          activeAccounts,
          selectedAccounts: selection.selectedAccounts,
          settings: selection.settings,
          holdings,
          portfolio,
          exposure,
          fxQuote,
          snapshots,
          etfData,
          newlyIncludedAccounts: selection.newlyIncludedAccounts,
          hasTwelveDataKey,
          hasAlphaVantageKey,
          lastLoadedAt: new Date().toISOString(),
        });
      }
    } catch (error) {
      if (mounted.current) {
        setState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? error.message : "Unable to read Wealthfolio data",
        }));
      }
    }
  }, [ctx]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh, refreshToken]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];
    async function subscribe(): Promise<void> {
      const listeners = await Promise.all([
        ctx.api.events.portfolio.onUpdateComplete(() => void refresh()),
        ctx.api.events.market.onSyncComplete(() => void refresh()),
      ]);
      if (disposed) listeners.forEach((unlisten) => unlisten());
      else unlisteners.push(...listeners);
    }
    void subscribe();
    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [ctx, refresh]);

  useEffect(() => {
    if (!state.settings.liveFxPolling) return undefined;
    const check = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(check, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
    };
  }, [refresh, state.settings.liveFxPolling]);

  const saveSnapshot = useCallback(async (snapshot: EtfHoldingsSnapshot, expectedVersion?: number) => {
    await new EtfCache(ctx).save(snapshot, { expectedVersion });
    setRefreshToken((value) => value + 1);
  }, [ctx]);

  const disableSnapshot = useCallback(async (etfKey: string) => {
    await new EtfCache(ctx).disable(etfKey);
    setRefreshToken((value) => value + 1);
  }, [ctx]);

  const refreshEtf = useCallback(async (etfKey: string) => {
    const asset = state.portfolio.etfs.find((etf) => etf.etfKey === etfKey);
    if (!asset) return;
    const current = await new EtfCache(ctx).get(etfKey);
    const [alphaVantageApiKey] = await Promise.all([ctx.api.secrets.get("alphaVantage.apiKey")]);
    const providers = createProviders(ctx, { alphaVantageApiKey });
    const result = await resolveEtfHoldings(asset, providers, {
      mode: state.settings.providerModes[etfKey] ?? "auto",
      pinnedProvider: state.settings.pinnedProviders[etfKey],
      cached: current?.snapshot,
    });
    if (!result.snapshot) throw new Error(result.failureReason ?? "No ETF provider could resolve this fund");
    await new EtfCache(ctx).save({ ...result.snapshot, failureReason: result.failureReason }, { expectedVersion: current?.version });
    setRefreshToken((value) => value + 1);
  }, [ctx, state.portfolio.etfs, state.settings.pinnedProviders, state.settings.providerModes]);

  const saveAccountSelection = useCallback(async (accountIds: string[]) => {
    const settings = setSelectedAccounts(state.settings, accountIds);
    await saveAddonSettings(ctx, settings);
    setRefreshToken((value) => value + 1);
  }, [ctx, state.settings]);

  const saveSecret = useCallback(async (secretKey: string, value: string) => {
    if (value.trim()) await ctx.api.secrets.set(secretKey, value.trim());
    else await ctx.api.secrets.delete(secretKey);
    setRefreshToken((current) => current + 1);
  }, [ctx]);

  const deleteSecret = useCallback(async (secretKey: string) => {
    await ctx.api.secrets.delete(secretKey);
    setRefreshToken((current) => current + 1);
  }, [ctx]);

  const setLiveFxPolling = useCallback(async (enabled: boolean) => {
    const settings = { ...state.settings, liveFxPolling: enabled };
    await saveAddonSettings(ctx, settings);
    setState((current) => ({ ...current, settings }));
  }, [ctx, state.settings]);

  const setTypeOverride = useCallback(async (key: string, type: AssetType) => {
    const settings = { ...state.settings, typeOverrides: { ...state.settings.typeOverrides, [key]: type } };
    await saveAddonSettings(ctx, settings);
    setRefreshToken((value) => value + 1);
  }, [ctx, state.settings]);

  const setProviderMode = useCallback(async (key: string, mode: "auto" | "pinned") => {
    const settings = { ...state.settings, providerModes: { ...state.settings.providerModes, [key]: mode } };
    await saveAddonSettings(ctx, settings);
    setState((current) => ({ ...current, settings }));
  }, [ctx, state.settings]);

  const setPinnedProvider = useCallback(async (key: string, provider: string) => {
    const settings = { ...state.settings, pinnedProviders: { ...state.settings.pinnedProviders, [key]: provider } };
    await saveAddonSettings(ctx, settings);
    setState((current) => ({ ...current, settings }));
  }, [ctx, state.settings]);

  return useMemo(() => ({
    ...state,
    refresh,
    refreshEtf,
    saveSnapshot,
    disableSnapshot,
    saveAccountSelection,
    saveSecret,
    deleteSecret,
    setLiveFxPolling,
    setTypeOverride,
    setProviderMode,
    setPinnedProvider,
  }), [
    state,
    refresh,
    refreshEtf,
    saveSnapshot,
    disableSnapshot,
    saveAccountSelection,
    saveSecret,
    deleteSecret,
    setLiveFxPolling,
    setTypeOverride,
    setProviderMode,
    setPinnedProvider,
  ]);
}
