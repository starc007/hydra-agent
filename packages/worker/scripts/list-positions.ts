declare const process: { env: Record<string, string | undefined>; argv: string[]; exit: (code: number) => never; cwd: () => string };

import { POSITION_MANAGER_ABI } from '../src/chain/position';
import { ERC20_ABI } from '../src/chain/erc20';
import { loadEnv, makeClients, UNICHAIN_SEPOLIA_ADDRESSES, arg } from './_lib';
import { keccak256, encodeAbiParameters, type Address } from 'viem';

// ERC721 enumeration extension
const ENUMERABLE_ABI = [
  { type: 'function', name: 'balanceOf',          stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }],                                       outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'tokenOfOwnerByIndex', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'index', type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const;

async function main() {
  const { privateKey, rpcUrl } = loadEnv();
  const { account, publicClient } = makeClients(privateKey, rpcUrl);
  const owner = (arg('owner') ?? account.address) as Address;
  const pm = UNICHAIN_SEPOLIA_ADDRESSES.positionManager;

  console.log(`querying positions for owner=${owner} on Unichain Sepolia`);
  console.log(`PositionManager=${pm}\n`);

  const balance = await publicClient.readContract({
    address: pm, abi: ENUMERABLE_ABI, functionName: 'balanceOf', args: [owner],
  }) as bigint;

  if (balance === 0n) {
    console.log('no v4 LP NFTs found for this owner.');
    console.log('mint one via app.uniswap.org/positions/create or `npm run position:create`.');
    return;
  }

  console.log(`found ${balance} position(s).\n`);

  // Header
  const cols = ['tokenId', 'currency0', 'currency1', 'fee', 'spacing', 'tickLower', 'tickUpper', 'liquidity', 'poolId'];
  console.log(cols.map((c) => c.padEnd(c === 'currency0' || c === 'currency1' || c === 'poolId' ? 44 : c === 'tokenId' ? 12 : 10)).join(' '));
  console.log('-'.repeat(180));

  for (let i = 0n; i < balance; i++) {
    const tokenId = await publicClient.readContract({
      address: pm, abi: ENUMERABLE_ABI, functionName: 'tokenOfOwnerByIndex', args: [owner, i],
    }) as bigint;

    const [poolKey, info] = await publicClient.readContract({
      address: pm, abi: POSITION_MANAGER_ABI, functionName: 'getPoolAndPositionInfo', args: [tokenId],
    }) as [{ currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }, bigint];

    const liquidity = await publicClient.readContract({
      address: pm, abi: POSITION_MANAGER_ABI, functionName: 'getPositionLiquidity', args: [tokenId],
    }) as bigint;

    const tickLower = Number(BigInt.asIntN(24, (info >> 8n) & 0xFFFFFFn));
    const tickUpper = Number(BigInt.asIntN(24, (info >> 32n) & 0xFFFFFFn));
    const poolId = keccak256(
      encodeAbiParameters(
        [{
          type: 'tuple',
          components: [
            { name: 'currency0',   type: 'address' },
            { name: 'currency1',   type: 'address' },
            { name: 'fee',         type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'hooks',       type: 'address' },
          ],
        }],
        [poolKey],
      ),
    );

    // Optional: try to read symbols (best-effort, skip on revert)
    let sym0: string = poolKey.currency0;
    let sym1: string = poolKey.currency1;
    try {
      if (poolKey.currency0 !== '0x0000000000000000000000000000000000000000') {
        sym0 = await publicClient.readContract({ address: poolKey.currency0, abi: ERC20_ABI, functionName: 'symbol' }) as string;
      } else { sym0 = 'ETH'; }
    } catch { /* keep address */ }
    try {
      if (poolKey.currency1 !== '0x0000000000000000000000000000000000000000') {
        sym1 = await publicClient.readContract({ address: poolKey.currency1, abi: ERC20_ABI, functionName: 'symbol' }) as string;
      }
    } catch { /* keep address */ }

    console.log(
      [
        tokenId.toString().padEnd(12),
        sym0.toString().padEnd(44),
        sym1.toString().padEnd(44),
        poolKey.fee.toString().padEnd(10),
        poolKey.tickSpacing.toString().padEnd(10),
        tickLower.toString().padEnd(10),
        tickUpper.toString().padEnd(10),
        liquidity.toString().padEnd(10),
        poolId,
      ].join(' '),
    );
  }

  console.log('\npaste any tokenId into wrangler.toml as TOKEN_ID; the rest is read on boot.');
}

main().catch((err) => { console.error(err); process.exit(1); });
