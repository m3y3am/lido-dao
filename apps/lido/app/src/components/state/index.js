import { useAppState } from '@aragon/api-react'
import React from 'react'
import {
  BoxUnpadded,
  ListItem,
  ListItemAddress,
  ListItemBasisPoints,
  ListItemBoolean,
  ListItemEther,
  ListItemUnformattedValue,
} from '../shared'
import { Fee } from './Fee'
import { Status } from './Status'
import { WithdrawalCredentials } from './WithdrawalCredentials'

export const State = () => {
  const {
    canDeposit,
    bufferedEther,
    depositableEther,
    totalPooledEther,
    totalELRewardsCollected,
    beaconStat,
    feeDistribution,
    treasury,
    legacyOracle,
    recoveryVault,
    lidoLocator,
  } = useAppState()

  return (
    <>
      <BoxUnpadded heading="State">
        <Status />
        <ListItemBoolean label="Deposits enabled" value={canDeposit} />
        <ListItemEther label="Ether buffered" value={bufferedEther} />
        <ListItemEther label="Ether depositable" value={depositableEther} />
        <ListItemEther label="Ether pooled, total" value={totalPooledEther} />
        <ListItemEther
          label="EL rewards collected, total"
          value={totalELRewardsCollected}
        />
      </BoxUnpadded>
      <BoxUnpadded heading="Consensus layer">
        <ListItemEther
          label="Cumulative validator balance"
          value={beaconStat?.beaconBalance}
        />
        <ListItemUnformattedValue
          label="Deposited validators"
          value={beaconStat?.depositedValidators}
        />
        <ListItemUnformattedValue
          label="Validators, total"
          value={beaconStat?.beaconValidators}
        />
      </BoxUnpadded>
      <BoxUnpadded heading="Configuration">
        <Fee />
        <ListItem label="Protocol fee distribution" noBorder />
        <ListItemBasisPoints
          label="Treasury"
          value={feeDistribution?.treasuryFeeBasisPoints}
          nested
        />
        <ListItemBasisPoints
          label="Insurance"
          value={feeDistribution?.insuranceFeeBasisPoints}
          nested
        />
        <ListItemBasisPoints
          label="Operators"
          value={feeDistribution?.operatorsFeeBasisPoints}
          nested
        />
        <WithdrawalCredentials />
      </BoxUnpadded>
      <BoxUnpadded heading="Locations">
        <ListItemAddress label="Treasury" value={treasury} />
        <ListItemAddress label="Oracle (legacy)" value={legacyOracle} />
        <ListItemAddress label="Recovery vault" value={recoveryVault} />
        <ListItemAddress label="Locator" value={lidoLocator} />
      </BoxUnpadded>
    </>
  )
}
