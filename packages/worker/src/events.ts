export type AgentName = 'price' | 'risk' | 'strategy' | 'coordinator' | 'execution' | 'bot' | 'macro';

export type BaseEvent = { id: string; ts: number; source: AgentName };

export type PriceUpdate = BaseEvent & {
  type: 'PRICE_UPDATE'; source: 'price';
  payload: { tick: number; sqrtPriceX96: string; price: number };
};
export type VolatilitySpike = BaseEvent & {
  type: 'VOLATILITY_SPIKE'; source: 'price';
  payload: { stdDev: number; window: number; reasoning?: string };
};
export type OutOfRange = BaseEvent & {
  type: 'OUT_OF_RANGE'; source: 'price';
  payload: { tick: number; tickLower: number; tickUpper: number; side: 'below' | 'above' };
};

export type PriceVerdict = 'trending_up' | 'trending_down' | 'mean_reverting' | 'choppy' | 'spike' | 'stable';
export type VolatilityLevel = 'low' | 'medium' | 'high';
export type PricePattern = BaseEvent & {
  type: 'PRICE_PATTERN'; source: 'price';
  payload: { pattern: PriceVerdict; volatility: VolatilityLevel; reasoning: string };
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

export type RiskVerdict = 'healthy' | 'concerning' | 'dangerous';
export type RiskHint = 'hold' | 'consider_exit' | 'consider_harvest';
export type RiskAnalysis = BaseEvent & {
  type: 'RISK_ANALYSIS'; source: 'risk';
  payload: { verdict: RiskVerdict; reasoning: string; hint?: RiskHint; ilPct: number; feesEarnedUsd: number };
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

export type CoordinatorVerdict = 'approve' | 'escalate' | 'block';
export type CoordinatorReview = BaseEvent & {
  type: 'COORDINATOR_REVIEW'; source: 'coordinator';
  payload: { action: CoordinatorVerdict; reasoning: string; correlatesTo: string };
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

export type MarketVibe = 'bullish' | 'bearish' | 'neutral' | 'uncertain';
export type MarketContext = BaseEvent & {
  type: 'MARKET_CONTEXT'; source: 'macro';
  payload: { vibe: MarketVibe; reasoning: string };
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
  | PriceUpdate | VolatilitySpike | OutOfRange | PricePattern
  | ILThresholdBreach | PositionHealthy | FeeHarvestReady | RiskAnalysis
  | StrategyRecommendation
  | Approved | Escalate | CoordinatorReview
  | HumanDecision
  | MarketContext
  | TxSubmitted | TxConfirmed | TxFailed;

export type HydraEventType = HydraEvent['type'];
