/**
 * Port of Uniswap v3 LiquidityAmounts.sol. Pure BigInt math; exact-match against Solidity.
 */

const Q96 = 1n << 96n;

function order(a: bigint, b: bigint): [bigint, bigint] {
  return a > b ? [b, a] : [a, b];
}

function mulDiv(a: bigint, b: bigint, denominator: bigint): bigint {
  // BigInt has arbitrary precision, so the Solidity mulDiv overflow safeguard is unnecessary.
  return (a * b) / denominator;
}

const UINT128_MAX = (1n << 128n) - 1n;
function toUint128(x: bigint): bigint {
  if (x > UINT128_MAX) throw new Error('liquidity exceeds uint128');
  return x;
}

export function getLiquidityForAmount0(sqrtA: bigint, sqrtB: bigint, amount0: bigint): bigint {
  const [a, b] = order(sqrtA, sqrtB);
  const intermediate = mulDiv(a, b, Q96);
  return toUint128(mulDiv(amount0, intermediate, b - a));
}

export function getLiquidityForAmount1(sqrtA: bigint, sqrtB: bigint, amount1: bigint): bigint {
  const [a, b] = order(sqrtA, sqrtB);
  return toUint128(mulDiv(amount1, Q96, b - a));
}

export function getLiquidityForAmounts(
  sqrtPriceX96: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  amount0: bigint,
  amount1: bigint,
): bigint {
  const [a, b] = order(sqrtA, sqrtB);
  if (sqrtPriceX96 <= a) {
    return getLiquidityForAmount0(a, b, amount0);
  } else if (sqrtPriceX96 < b) {
    const l0 = getLiquidityForAmount0(sqrtPriceX96, b, amount0);
    const l1 = getLiquidityForAmount1(a, sqrtPriceX96, amount1);
    return l0 < l1 ? l0 : l1;
  }
  return getLiquidityForAmount1(a, b, amount1);
}

export function getAmount0ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [a, b] = order(sqrtA, sqrtB);
  // amount0 = mulDiv(L << 96, b - a, b) / a
  return mulDiv(liquidity << 96n, b - a, b) / a;
}

export function getAmount1ForLiquidity(sqrtA: bigint, sqrtB: bigint, liquidity: bigint): bigint {
  const [a, b] = order(sqrtA, sqrtB);
  return mulDiv(liquidity, b - a, Q96);
}

export function getAmountsForLiquidity(
  sqrtPriceX96: bigint,
  sqrtA: bigint,
  sqrtB: bigint,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  const [a, b] = order(sqrtA, sqrtB);
  if (sqrtPriceX96 <= a) {
    return { amount0: getAmount0ForLiquidity(a, b, liquidity), amount1: 0n };
  } else if (sqrtPriceX96 < b) {
    return {
      amount0: getAmount0ForLiquidity(sqrtPriceX96, b, liquidity),
      amount1: getAmount1ForLiquidity(a, sqrtPriceX96, liquidity),
    };
  }
  return { amount0: 0n, amount1: getAmount1ForLiquidity(a, b, liquidity) };
}
