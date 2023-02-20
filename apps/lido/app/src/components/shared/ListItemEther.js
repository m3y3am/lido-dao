import React from 'react'
import { ListItem } from './ListItem'
import { Ether } from './Ether'
import { LoadableElement } from './LoadableElement'

export const ListItemEther = ({ label, value }) => {
  return (
    <ListItem label={label}>
      <LoadableElement value={value}>
        <Ether ether={value} />
      </LoadableElement>
    </ListItem>
  )
}
