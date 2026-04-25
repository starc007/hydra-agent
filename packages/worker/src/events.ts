export type AgentName = 'price' | 'risk' | 'strategy' | 'coordinator' | 'execution' | 'bot';

export type BaseEvent = { id: string; ts: number; source: AgentName };

export type PriceUpdate = BaseEvent & {
  type: 'PRICE_UPDATE'; source: 'price';
  payload: { tick: number; sqrtPriceX96: string; price: number };
};
export type VolatilitySpike = BaseEvent & {
  type: 'VOLATILITY_SPIKE'; source: 'price';
  payload: { stdDev: number; window: number };
};
export type OutOfRange = BaseEvent & {
  type: 'OUT_OF_RANGE'; source: 'price';
  payload: { tick: number; tickLower: number; tickUpper: number; side: 'below' | 'above' };
};

export type ILThresholdBreach = BaseEvent & {
  type: 'IL_THRESHOLD_BREACH'; source: 'risk';
  payload: { ilPct: number; thresholdPct: number };
};
export type PositionHealthy = BaseEvent & {
  type: 'POSITION_HEALTHY'; source: 'risk';
  payload: { ilPct: number; feesEarnedUsd: number };
};
export type FeeHarvestReady = BaseEvent & {
  type: 'FEE_HARVEST_READY'; source: 'risk';
  payload: { feesEarnedUsd: number };
};

export type StrategyAction = 'HOLD' | 'REBALANCE' | 'HARVEST' | 'EXIT';
export type StrategyRecommendation = BaseEvent & {
  type: 'STRATEGY_RECOMMENDATION'; source: 'strategy';
  payload: {
    action: StrategyAction;
    confidence: number;
    rationale: string;
    suggestedRange?: { tickLower: number; tickUpper: number };
  };
};

export type Approved = BaseEvent & {
  type: 'APPROVED'; source: 'coordinator';
  payload: { action: StrategyAction; reason: string; correlatesTo?: string };
};
export type Escalate = BaseEvent & {
  type: 'ESCALATE'; source: 'coordinator';
  payload: {
    reason: string;
    /** ID of the STRATEGY_RECOMMENDATION this escalation was raised for. Used as the key in
     * Coordinator.pending and as the correlatesTo on the resulting HUMAN_DECISION. */
    correlatesTo: string;
    recommendation: StrategyRecommendation['payload'];
  };
};
export type HumanDecision = BaseEvent & {
  type: 'HUMAN_DECISION'; source: 'bot';
  payload: { decision: 'approve' | 'override'; correlatesTo: string };
};

export type TxSubmitted = BaseEvent & {
  type: 'TX_SUBMITTED'; source: 'execution';
  payload: { hash: `0x${string}`; action: StrategyAction };
};
export type TxConfirmed = BaseEvent & {
  type: 'TX_CONFIRMED'; source: 'execution';
  payload: { hash: `0x${string}`; gasUsed: string; blockNumber: number };
};
export type TxFailed = BaseEvent & {
  type: 'TX_FAILED'; source: 'execution';
  payload: { hash?: `0x${string}`; error: string };
};

export type HydraEvent =
  | PriceUpdate | VolatilitySpike | OutOfRange
  | ILThresholdBreach | PositionHealthy | FeeHarvestReady
  | StrategyRecommendation
  | Approved | Escalate
  | HumanDecision
  | TxSubmitted | TxConfirmed | TxFailed;

export type HydraEventType = HydraEvent['type'];
