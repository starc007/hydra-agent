import { concatHex, encodeAbiParameters, type Address, type Hex } from 'viem';

export const ACTIONS = {
  INCREASE_LIQUIDITY: 0x00,
  DECREASE_LIQUIDITY: 0x01,
  MINT_POSITION:      0x02,
  BURN_POSITION:      0x03,
  SETTLE_PAIR:        0x0d,
  TAKE_PAIR:          0x11,
} as const;

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

const POOL_KEY_TUPLE = {
  type: 'tuple',
  components: [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
  ],
} as const;

export function encodeIncreaseLiquidity(p: { tokenId: bigint; liquidity: bigint; amount0Max: bigint; amount1Max: bigint; hookData?: Hex }): Hex {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' }],
    [p.tokenId, p.liquidity, p.amount0Max, p.amount1Max, p.hookData ?? '0x'],
  );
}

export function encodeDecreaseLiquidity(p: { tokenId: bigint; liquidity: bigint; amount0Min: bigint; amount1Min: bigint; hookData?: Hex }): Hex {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' }],
    [p.tokenId, p.liquidity, p.amount0Min, p.amount1Min, p.hookData ?? '0x'],
  );
}

export function encodeMintPosition(p: {
  poolKey: PoolKey;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
  owner: Address;
  hookData?: Hex;
}): Hex {
  return encodeAbiParameters(
    [POOL_KEY_TUPLE, { type: 'int24' }, { type: 'int24' }, { type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'address' }, { type: 'bytes' }],
    [p.poolKey, p.tickLower, p.tickUpper, p.liquidity, p.amount0Max, p.amount1Max, p.owner, p.hookData ?? '0x'],
  );
}

export function encodeBurnPosition(p: { tokenId: bigint; amount0Min: bigint; amount1Min: bigint; hookData?: Hex }): Hex {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint128' }, { type: 'uint128' }, { type: 'bytes' }],
    [p.tokenId, p.amount0Min, p.amount1Min, p.hookData ?? '0x'],
  );
}

export function encodeSettlePair(currency0: Address, currency1: Address): Hex {
  return encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [currency0, currency1]);
}

export function encodeTakePair(currency0: Address, currency1: Address, recipient: Address): Hex {
  return encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }], [currency0, currency1, recipient]);
}

/** Build the unlockData for PositionManager.modifyLiquidities. */
export function encodeUnlockData(actionCodes: number[], params: Hex[]): Hex {
  if (actionCodes.length !== params.length) {
    throw new Error('actions/params length mismatch');
  }
  const actionsHex = concatHex(actionCodes.map((c) => `0x${c.toString(16).padStart(2, '0')}` as Hex));
  return encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actionsHex, params]);
}
