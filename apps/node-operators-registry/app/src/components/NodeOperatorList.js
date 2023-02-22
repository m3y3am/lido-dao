import { useAppState } from '@aragon/api-react'
import { Accordion, GU, IdentityBadge } from '@aragon/ui'
import React from 'react'
import styled from 'styled-components'

const AccordionContent = styled.div`
  padding: ${GU * 2}px;
`

const ContentLine = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: ${GU * 2}px 0;
`

const ContentLineValue = styled.div`
  text-align: right;
  margin-left: ${GU * 4}px;
`

export const NodeOperatorList = () => {
  let { nodeOperators } = useAppState()

  nodeOperators = nodeOperators || []

  return (
    <Accordion
      mode="table"
      items={nodeOperators.map(
        ({
          name,
          rewardAddress,
          stakingLimit,
          stoppedValidators,
          totalSigningKeys,
          usedSigningKeys,
        }) => [
          name,
          <AccordionContent key={name}>
            <ContentLine>
              Rewards address:{' '}
              <ContentLineValue>
                <IdentityBadge key={name} entity={rewardAddress} />
              </ContentLineValue>
            </ContentLine>
            <ContentLine>
              Staking limit: <ContentLineValue>{stakingLimit}</ContentLineValue>
            </ContentLine>
            <ContentLine>
              Stopped validators:{' '}
              <ContentLineValue>{stoppedValidators}</ContentLineValue>
            </ContentLine>
            <ContentLine>
              Signing keys, total:{' '}
              <ContentLineValue>{totalSigningKeys}</ContentLineValue>
            </ContentLine>
            <ContentLine>
              Used signing keys:{' '}
              <ContentLineValue>{usedSigningKeys}</ContentLineValue>
            </ContentLine>
          </AccordionContent>,
        ]
      )}
    />
  )
}
