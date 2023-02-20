import React from 'react'
import { formatEth } from '../../utils'
import { constants } from 'ethers'

export const Ether = ({ ether }) => {
  try {
    ether = formatEth(ether)
  } catch (error) {
    console.warn(error)
    return <span>N/A</span>
  }

  return (
    <span>
      {constants.EtherSymbol}
      {ether}
    </span>
  )
}
