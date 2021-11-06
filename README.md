# dao-staking
Fork of HEX https://etherscan.io/address/0x2b591e99afe9f32eaa6214f7b7629768c40eeb39#code with these changes:
- removed HEX claiming with BTC
- renamed "hearts" and "HEX" to something more generic
- using uint128 instead of uint72 (since our token has 18 decimals and HEX 8 decimals)
- added function that funds staking token as reward (in HEX there's fixed minted inflation)
- transferring the staking token instead of burning and minting
- emitting events with unpacked parameters
- saving daily rewards also as sums instead of only derivatives (as gas optimization)
- added burn fee (50% go to stakers, 30% to origin wallet and 20% burned)
- distributing allocated unclaimable reward of late unstakers
- bonus for staking more amount starts from BPB_FROM_AMOUNT instead of 0
- changed staking constants
- added hard lock